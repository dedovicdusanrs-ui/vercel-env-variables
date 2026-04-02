const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const contentScript = fs.readFileSync(
  path.join(__dirname, "..", "scripts", "content.js"),
  "utf8"
);

const PROJECT_SELECTOR =
  "body > div.bg-background-200.min-h-vh.relative > header > nav > ul > li:nth-child(2) > div > a > p";
const TARGET_SELECTOR = "#environment-variables-fieldset > span:nth-child(5)";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.className = "";
    this.innerHTML = "";
    this.textContent = "";
    this.clicked = false;
    this.removed = false;
    this.style = {
      cssText: "",
      setProperty(name, value) {
        this[name] = value;
      },
    };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(node, referenceNode) {
    node.parentNode = this;
    const index = this.children.indexOf(referenceNode);
    if (index === -1) {
      this.children.push(node);
    } else {
      this.children.splice(index + 1, 0, node);
    }
    return node;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    this.removed = true;
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, handler) {
    this[`on${type}`] = handler;
  }

  click() {
    this.clicked = true;
    if (this.onclick) {
      this.onclick();
    }
  }
}

function findElements(root, predicate, matches = []) {
  if (predicate(root)) {
    matches.push(root);
  }

  for (const child of root.children || []) {
    findElements(child, predicate, matches);
  }

  return matches;
}

function createContentHarness(options = {}) {
  const logs = [];
  const fetchCalls = [];
  const clipboardWrites = [];
  const alerts = [];
  const objectUrls = [];
  const revokedUrls = [];
  const body = new FakeElement("body");
  const fieldsetParent = new FakeElement("div");
  const targetElement = options.targetElement ?? new FakeElement("span");
  fieldsetParent.appendChild(targetElement);
  body.appendChild(fieldsetParent);

  const document = {
    body,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    querySelector(selector) {
      if (selector === TARGET_SELECTOR) {
        return options.includeTarget === false ? null : targetElement;
      }

      if (selector === PROJECT_SELECTOR) {
        return options.projectName
          ? { textContent: options.projectName }
          : null;
      }

      return null;
    },
  };

  const sandbox = {
    Blob: class FakeBlob {
      constructor(parts, config) {
        this.parts = parts;
        this.type = config.type;
      }
    },
    MutationObserver: function MutationObserver() {
      this.observe = () => {};
    },
    alert(message) {
      alerts.push(message);
    },
    chrome: {
      runtime: {
        sendMessage(_message, callback) {
          if (options.sendMessageResponse !== undefined) {
            callback(options.sendMessageResponse);
          }
        },
      },
    },
    console: {
      log(...args) {
        logs.push({ type: "log", args });
      },
      error(...args) {
        logs.push({ type: "error", args });
      },
    },
    document,
    fetch: async (url, requestOptions) => {
      fetchCalls.push({ url, options: requestOptions });
      if (options.fetchImpl) {
        return options.fetchImpl(url, requestOptions);
      }

      return {
        ok: true,
        json: async () => ({ env: [] }),
      };
    },
    location: { href: "https://vercel.com/project" },
    navigator: {
      clipboard: {
        writeText(text) {
          clipboardWrites.push(text);
          return options.clipboardImpl
            ? options.clipboardImpl(text)
            : Promise.resolve();
        },
      },
    },
    setTimeout(callback) {
      if (options.disableTimeouts) {
        return 0;
      }

      callback();
      return 0;
    },
    window: {
      URL: {
        createObjectURL(blob) {
          objectUrls.push(blob);
          return "blob:test";
        },
        revokeObjectURL(url) {
          revokedUrls.push(url);
        },
      },
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(contentScript, sandbox);

  return {
    alerts,
    clipboardWrites,
    fetchCalls,
    logs,
    objectUrls,
    revokedUrls,
    sandbox,
    targetElement,
    fieldsetParent,
  };
}

test("fetchEnv returns decrypted environment variables and reuses the cookie header", async () => {
  const harness = createContentHarness({
    fetchImpl: async (url) => {
      if (url.endsWith("/my-project")) {
        return {
          ok: true,
          json: async () => ({
            env: [
              { id: "env_1", key: "TOKEN", value: "encrypted-a" },
              { id: "env_2", key: "URL", value: "encrypted-b" },
            ],
          }),
        };
      }

      if (url.endsWith("/env/env_1")) {
        return {
          ok: true,
          json: async () => ({ key: "TOKEN", value: "plain-a" }),
        };
      }

      return {
        ok: true,
        json: async () => ({ key: "URL", value: "plain-b" }),
      };
    },
  });

  const result = await harness.sandbox.fetchEnv("auth-cookie", "my-project");

  assert.deepEqual(result, {
    env: [
      { key: "TOKEN", value: "plain-a" },
      { key: "URL", value: "plain-b" },
    ],
  });
  assert.equal(harness.fetchCalls.length, 3);
  assert.match(
    harness.fetchCalls[0].url,
    /https:\/\/vercel\.com\/api\/v9\/projects\/my-project$/
  );
  assert.equal(
    harness.fetchCalls[0].options.headers.Cookie,
    "authorization=auth-cookie;"
  );
  assert.equal(
    harness.fetchCalls[2].options.headers.Cookie,
    "authorization=auth-cookie;"
  );
});

test("fetchEnv returns an error when the project request fails", async () => {
  const harness = createContentHarness({
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    }),
  });

  const result = await harness.sandbox.fetchEnv("bad-cookie", "my-project");

  assert.deepEqual(result, { error: "Error: 401 - Unauthorized" });
  assert.equal(harness.logs.at(-1).type, "error");
});

test("fetchEnv returns the nested request status when an env lookup fails", async () => {
  const harness = createContentHarness({
    fetchImpl: async (url) => {
      if (url.endsWith("/my-project")) {
        return {
          ok: true,
          json: async () => ({
            env: [{ id: "env_1", key: "TOKEN", value: "encrypted-a" }],
          }),
        };
      }

      return {
        ok: false,
        status: 500,
        statusText: "Server Error",
      };
    },
  });

  const result = await harness.sandbox.fetchEnv("auth-cookie", "my-project");

  assert.deepEqual(result, { error: "Error: 500 - Server Error" });
});

test("copyAllEnv writes the formatted env content to the clipboard", async () => {
  const harness = createContentHarness();

  harness.sandbox.copyAllEnv([
    { key: "TOKEN", value: "plain-a" },
    { key: "URL", value: "https://example.com" },
  ]);

  await Promise.resolve();

  assert.deepEqual(harness.clipboardWrites, [
    "TOKEN=plain-a\nURL=https://example.com",
  ]);
  assert.deepEqual(harness.alerts, ["All ENV variables copied to clipboard!"]);
});

test("copyAllEnv logs clipboard failures", async () => {
  const harness = createContentHarness({
    clipboardImpl: () => Promise.reject(new Error("clipboard denied")),
  });

  harness.sandbox.copyAllEnv([{ key: "TOKEN", value: "plain-a" }]);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(harness.logs.at(-1).type, "error");
  assert.match(harness.logs.at(-1).args[0], /Failed to copy ENV variables/);
});

test("downloadEnvFile creates a downloadable blob and cleans it up", () => {
  const harness = createContentHarness();

  harness.sandbox.downloadEnvFile(".env.local", [
    { key: "TOKEN", value: "plain-a" },
    { key: "URL", value: "plain-b" },
  ]);

  const link = findElements(
    harness.fieldsetParent,
    (element) => element.tagName === "A"
  )[0];

  assert.equal(harness.objectUrls.length, 1);
  assert.deepEqual(harness.objectUrls[0].parts, ["TOKEN=plain-a\nURL=plain-b"]);
  assert.equal(link.download, ".env.local");
  assert.equal(link.clicked, true);
  assert.deepEqual(harness.revokedUrls, ["blob:test"]);
  assert.equal(findElements(harness.fieldsetParent, (element) => element.tagName === "A").length, 0);
});

test("initializeUI logs an error when the target element is missing", () => {
  const harness = createContentHarness({ includeTarget: false });

  assert.deepEqual(harness.logs[0], {
    type: "error",
    args: ["Target element not found!"],
  });
});

test("initializeUI renders an error state when the project name is unavailable", () => {
  const harness = createContentHarness({ projectName: null });

  const insertedCard = harness.fieldsetParent.children[1];
  const errorNodes = findElements(
    insertedCard,
    (element) => element.textContent === "Error: Project name not found. Please refresh the page."
  );

  assert.equal(errorNodes.length, 1);
});

test("createUI renders loading, error, and success states", async () => {
  const harness = createContentHarness();

  const loadingCard = harness.sandbox.createUI(true);
  const errorCard = harness.sandbox.createUI(false, { error: "No access" });
  const successCard = harness.sandbox.createUI(false, {
    env: [{ key: "TOKEN", value: "plain-a" }],
  });

  assert.equal(
    findElements(
      loadingCard,
      (element) => element.innerHTML.includes("Loading environment variables")
    ).length,
    1
  );
  assert.equal(
    findElements(
      errorCard,
      (element) => element.textContent === "Error: No access"
    ).length,
    1
  );

  const buttons = findElements(
    successCard,
    (element) => element.tagName === "BUTTON"
  );
  assert.equal(buttons.length, 2);

  buttons[0].click();
  await Promise.resolve();
  assert.deepEqual(harness.clipboardWrites, ["TOKEN=plain-a"]);

  buttons[1].click();
  assert.equal(harness.objectUrls.length, 1);
});
