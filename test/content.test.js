const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const contentPath = path.join(
  __dirname,
  "..",
  "scripts",
  "content.js"
);
const contentSource = fs.readFileSync(contentPath, "utf8");

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function createStyle() {
  return {
    cssText: "",
    values: {},
    setProperty(name, value) {
      this.values[name] = value;
    },
  };
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.eventListeners = {};
    this.parentNode = null;
    this.className = "";
    this.style = createStyle();
    this._textContent = "";
    this._innerHTML = "";
    this.clicked = false;
    this.href = "";
    this.download = "";
  }

  set textContent(value) {
    this._textContent = String(value);
  }

  get textContent() {
    if (this._textContent) {
      return this._textContent;
    }

    return this.children.map((child) => child.textContent).join("");
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }

    return child;
  }

  insertBefore(child, referenceNode) {
    child.parentNode = this;
    const index = this.children.indexOf(referenceNode);
    if (index === -1) {
      this.children.push(child);
    } else {
      this.children.splice(index, 0, child);
    }

    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  addEventListener(type, handler) {
    this.eventListeners[type] ??= [];
    this.eventListeners[type].push(handler);
  }

  dispatchEvent(event) {
    for (const handler of this.eventListeners[event.type] ?? []) {
      handler(event);
    }
  }

  click() {
    this.clicked = true;
    this.dispatchEvent({ type: "click", target: this });
  }
}

function findByTagName(node, tagName) {
  const matches = [];

  if (node.tagName === tagName.toUpperCase()) {
    matches.push(node);
  }

  for (const child of node.children) {
    matches.push(...findByTagName(child, tagName));
  }

  return matches;
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function loadContentScript({
  fetchImpl = async () => {
    throw new Error("Unexpected fetch call");
  },
  clipboardWrite = () => Promise.resolve(),
} = {}) {
  const errors = [];
  const logs = [];
  const alerts = [];
  const createObjectURLCalls = [];
  const revokedUrls = [];

  const body = new FakeElement("body");
  const document = {
    body,
    querySelector() {
      return null;
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };

  const context = {
    fetch: fetchImpl,
    navigator: {
      clipboard: {
        writeText: clipboardWrite,
      },
    },
    chrome: {
      runtime: {
        sendMessage() {},
      },
    },
    console: {
      error: (...args) => errors.push(args),
      log: (...args) => logs.push(args),
    },
    alert: (message) => alerts.push(message),
    document,
    window: {
      URL: {
        createObjectURL(blob) {
          createObjectURLCalls.push(blob);
          return "blob:test-url";
        },
        revokeObjectURL(url) {
          revokedUrls.push(url);
        },
      },
    },
    Blob: class FakeBlob {
      constructor(parts, options) {
        this.parts = parts;
        this.options = options;
      }
    },
    MutationObserver: class FakeMutationObserver {
      constructor(callback) {
        this.callback = callback;
      }

      observe() {}
    },
    location: { href: "https://vercel.com/example" },
    setTimeout() {},
  };

  vm.createContext(context);
  vm.runInContext(contentSource, context, { filename: contentPath });

  return {
    context,
    document,
    body,
    alerts,
    errors,
    logs,
    createObjectURLCalls,
    revokedUrls,
  };
}

test("fetchEnv loads project env data and individual env values", async () => {
  const fetchCalls = [];
  const runtime = loadContentScript({
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });

      if (url.endsWith("/api/v9/projects/my-project")) {
        return {
          ok: true,
          json: async () => ({
            env: [
              { id: "env-1", key: "API_KEY", value: "encrypted-1" },
              { id: "env-2", key: "TOKEN", value: "encrypted-2" },
            ],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          key: url.endsWith("/env/env-1") ? "API_KEY" : "TOKEN",
          value: url.endsWith("/env/env-1") ? "plain-1" : "plain-2",
        }),
      };
    },
  });

  const result = await runtime.context.fetchEnv("auth-token", "my-project");

  assert.deepEqual(normalize(result), {
    env: [
      { key: "API_KEY", value: "plain-1" },
      { key: "TOKEN", value: "plain-2" },
    ],
  });
  assert.equal(fetchCalls.length, 3);
  assert.equal(
    fetchCalls[0].url,
    "https://vercel.com/api/v9/projects/my-project"
  );
  assert.deepEqual(normalize(fetchCalls[0].options), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Cookie: "authorization=auth-token;",
    },
  });
});

test("fetchEnv returns a detailed error when the project request fails", async () => {
  const runtime = loadContentScript({
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    }),
  });

  const result = await runtime.context.fetchEnv("auth-token", "my-project");

  assert.deepEqual(normalize(result), {
    error: "Error: 401 - Unauthorized",
  });
  assert.equal(runtime.errors[1][0], "Failed to fetch project data:");
});

test("fetchEnv returns the env detail request error message", async () => {
  let requestCount = 0;
  const runtime = loadContentScript({
    fetchImpl: async () => {
      requestCount += 1;

      if (requestCount === 1) {
        return {
          ok: true,
          json: async () => ({
            env: [{ id: "env-1", key: "API_KEY", value: "encrypted-1" }],
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

  const result = await runtime.context.fetchEnv("auth-token", "my-project");

  assert.deepEqual(normalize(result), {
    error: "Error: 500 - Server Error",
  });
});

test("copyAllEnv writes joined env values to the clipboard and alerts on success", async () => {
  let clipboardValue;
  const runtime = loadContentScript({
    clipboardWrite: (value) => {
      clipboardValue = value;
      return Promise.resolve();
    },
  });

  runtime.context.copyAllEnv([
    { key: "API_KEY", value: "plain-1" },
    { key: "TOKEN", value: "plain-2" },
  ]);
  await flushPromises();

  assert.equal(clipboardValue, "API_KEY=plain-1\nTOKEN=plain-2");
  assert.deepEqual(runtime.alerts, [
    "All ENV variables copied to clipboard!",
  ]);
});

test("copyAllEnv logs clipboard failures", async () => {
  const runtime = loadContentScript({
    clipboardWrite: () => Promise.reject(new Error("clipboard denied")),
  });

  runtime.context.copyAllEnv([{ key: "API_KEY", value: "plain-1" }]);
  await flushPromises();

  assert.equal(
    runtime.errors[runtime.errors.length - 1][0],
    "Failed to copy ENV variables:"
  );
});

test("downloadEnvFile creates, clicks, and removes a temporary download link", () => {
  const runtime = loadContentScript();

  runtime.context.downloadEnvFile(".env.production", [
    { key: "API_KEY", value: "plain-1" },
    { key: "TOKEN", value: "plain-2" },
  ]);

  assert.equal(runtime.createObjectURLCalls.length, 1);
  assert.deepEqual(normalize(runtime.createObjectURLCalls[0].parts), [
    "API_KEY=plain-1\nTOKEN=plain-2",
  ]);
  assert.deepEqual(normalize(runtime.createObjectURLCalls[0].options), {
    type: "text/plain",
  });
  assert.equal(runtime.body.children.length, 0);
  assert.deepEqual(runtime.revokedUrls, ["blob:test-url"]);
});

test("createUI renders loading, error, and success states", () => {
  const runtime = loadContentScript();

  const loadingUI = runtime.context.createUI(true);
  assert.match(
    loadingUI.children[1].children[0].innerHTML,
    /Loading environment variables.../
  );
  assert.match(loadingUI.children[1].children[0].innerHTML, /spinner/);

  const errorUI = runtime.context.createUI(false, {
    error: "Project name not found",
  });
  assert.equal(
    errorUI.children[1].children[0].textContent,
    "Error: Project name not found"
  );

  let copiedEnv;
  let downloadedArgs;
  runtime.context.copyAllEnv = (env) => {
    copiedEnv = env;
  };
  runtime.context.downloadEnvFile = (filename, env) => {
    downloadedArgs = { filename, env };
  };

  const successUI = runtime.context.createUI(false, {
    env: [{ key: "API_KEY", value: "plain-1" }],
  });
  const buttons = findByTagName(successUI, "button");

  assert.equal(buttons.length, 2);
  assert.match(buttons[0].innerHTML, />Copy</);
  assert.match(buttons[1].innerHTML, />\.env</);

  buttons[0].click();
  buttons[1].click();

  assert.deepEqual(normalize(copiedEnv), [
    { key: "API_KEY", value: "plain-1" },
  ]);
  assert.deepEqual(normalize(downloadedArgs), {
    filename: ".env",
    env: [{ key: "API_KEY", value: "plain-1" }],
  });
});
