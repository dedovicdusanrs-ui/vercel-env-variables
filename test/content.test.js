const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const contentPath = path.join(__dirname, "..", "scripts", "content.js");
const contentSource = fs.readFileSync(contentPath, "utf8");
const projectNameSelector =
  "body > div.bg-background-200.min-h-vh.relative > header > nav > ul > li:nth-child(2) > div > a > p";
const targetSelector = "#environment-variables-fieldset > span:nth-child(5)";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.attributes = {};
    this.listeners = {};
    this.innerHTML = "";
    this.textContent = "";
    this.style = {
      cssText: "",
      properties: {},
      setProperty: (name, value) => {
        this.style.properties[name] = value;
      },
    };
    this.clickCount = 0;
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

  insertBefore(node, referenceNode) {
    node.parentNode = this;

    if (!referenceNode) {
      this.children.push(node);
      return node;
    }

    const index = this.children.indexOf(referenceNode);
    if (index === -1) {
      this.children.push(node);
      return node;
    }

    this.children.splice(index, 0, node);
    return node;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  click() {
    this.clickCount += 1;
    if (this.listeners.click) {
      this.listeners.click();
    }
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  get nextSibling() {
    if (!this.parentNode) {
      return null;
    }

    const index = this.parentNode.children.indexOf(this);
    return this.parentNode.children[index + 1] ?? null;
  }
}

function createResponse(body, { ok = true, status = 200, statusText = "OK" } = {}) {
  return {
    ok,
    status,
    statusText,
    async json() {
      return body;
    },
  };
}

function walkTree(node, predicate, results = []) {
  if (predicate(node)) {
    results.push(node);
  }

  for (const child of node.children ?? []) {
    walkTree(child, predicate, results);
  }

  return results;
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function loadContentScript({
  projectName = "demo-project",
  hasTarget = true,
  fetchImpl = async () => createResponse({ env: [] }),
  sendMessageImpl = (_message, callback) => callback("auth-token"),
  clipboardWriteText = () => Promise.resolve(),
  alertImpl = () => {},
  locationHref = "https://vercel.com/demo/settings/environment-variables",
} = {}) {
  const errors = [];
  const logs = [];
  const fetchCalls = [];
  const sendMessageCalls = [];
  const alerts = [];
  const clipboardWrites = [];
  const createObjectUrlCalls = [];
  const revokeObjectUrlCalls = [];
  const createdElements = [];
  const observerInstances = [];
  const timeouts = [];

  const body = new FakeElement("body");
  const targetParent = new FakeElement("div");
  body.appendChild(targetParent);

  const targetElement = hasTarget ? new FakeElement("span") : null;
  if (targetElement) {
    targetParent.appendChild(targetElement);
  }

  const projectNameElement =
    projectName === null ? null : { textContent: projectName };

  const selectors = new Map([
    [projectNameSelector, projectNameElement],
    [targetSelector, targetElement],
  ]);

  const document = {
    body,
    createElement(tagName) {
      const element = new FakeElement(tagName);
      createdElements.push(element);
      return element;
    },
    querySelector(selector) {
      return selectors.get(selector) ?? null;
    },
  };

  const sandbox = {
    Blob,
    Promise,
    alert(message) {
      alerts.push(message);
      return alertImpl(message);
    },
    chrome: {
      runtime: {
        sendMessage(message, callback) {
          sendMessageCalls.push(message);
          return sendMessageImpl(message, callback);
        },
      },
    },
    console: {
      error(...args) {
        errors.push(args);
      },
      log(...args) {
        logs.push(args);
      },
    },
    document,
    fetch(url, options) {
      fetchCalls.push({ url, options });
      return fetchImpl(url, options);
    },
    location: {
      href: locationHref,
    },
    MutationObserver: class MutationObserver {
      constructor(callback) {
        this.callback = callback;
        observerInstances.push(this);
      }

      observe(target, options) {
        this.target = target;
        this.options = options;
      }
    },
    navigator: {
      clipboard: {
        writeText(text) {
          clipboardWrites.push(text);
          return clipboardWriteText(text);
        },
      },
    },
    setTimeout(fn, delay) {
      timeouts.push({ fn, delay });
      return timeouts.length;
    },
    window: {
      URL: {
        createObjectURL(blob) {
          createObjectUrlCalls.push(blob);
          return `blob:${createObjectUrlCalls.length}`;
        },
        revokeObjectURL(url) {
          revokeObjectUrlCalls.push(url);
        },
      },
    },
  };

  vm.runInNewContext(contentSource, sandbox, { filename: contentPath });

  return {
    alerts,
    clipboardWrites,
    createObjectUrlCalls,
    createdElements,
    document,
    errors,
    fetchCalls,
    logs,
    observerInstances,
    revokeObjectUrlCalls,
    sandbox,
    sendMessageCalls,
    targetElement,
    targetParent,
    timeouts,
  };
}

test("fetchEnv returns decrypted environment variables and reuses auth headers", async () => {
  async function fetchImpl(url) {
    if (url.endsWith("/projects/demo-project")) {
      return createResponse({
        env: [
          { id: "env_1", key: "API_KEY", value: "encrypted-1" },
          { id: "env_2", key: "SECRET", value: "encrypted-2" },
        ],
      });
    }

    if (url.endsWith("/env/env_1")) {
      return createResponse({ key: "API_KEY", value: "abc123" });
    }

    return createResponse({ key: "SECRET", value: "shh" });
  }

  const runtime = loadContentScript({ hasTarget: false, fetchImpl });
  runtime.errors.length = 0;

  const result = await runtime.sandbox.fetchEnv("cookie-value", "demo-project");

  assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), {
    env: [
      { key: "API_KEY", value: "abc123" },
      { key: "SECRET", value: "shh" },
    ],
  });
  assert.deepStrictEqual(
    runtime.fetchCalls.map(({ url }) => url),
    [
      "https://vercel.com/api/v9/projects/demo-project",
      "https://vercel.com/api/v1/projects/demo-project/env/env_1",
      "https://vercel.com/api/v1/projects/demo-project/env/env_2",
    ]
  );
  assert.equal(runtime.fetchCalls[0].options.method, "GET");
  assert.equal(
    runtime.fetchCalls[0].options.headers.Cookie,
    "authorization=cookie-value;"
  );
});

test("fetchEnv returns an empty env list when the project has no environment variables", async () => {
  const runtime = loadContentScript({
    hasTarget: false,
    fetchImpl: async () => createResponse({}),
  });
  runtime.errors.length = 0;

  const result = await runtime.sandbox.fetchEnv("cookie-value", "demo-project");

  assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), { env: [] });
  assert.equal(runtime.fetchCalls.length, 1);
});

test("fetchEnv returns a readable error when the project request fails", async () => {
  const runtime = loadContentScript({
    hasTarget: false,
    fetchImpl: async () =>
      createResponse({}, { ok: false, status: 401, statusText: "Unauthorized" }),
  });
  runtime.errors.length = 0;

  const result = await runtime.sandbox.fetchEnv("cookie-value", "demo-project");

  assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), {
    error: "Error: 401 - Unauthorized",
  });
  assert.equal(runtime.errors.length, 1);
});

test("fetchEnv surfaces errors from individual environment variable lookups", async () => {
  const runtime = loadContentScript({
    hasTarget: false,
    fetchImpl: async (url) => {
      if (url.endsWith("/projects/demo-project")) {
        return createResponse({
          env: [{ id: "env_1", key: "API_KEY", value: "encrypted-1" }],
        });
      }

      return createResponse({}, { ok: false, status: 500, statusText: "Server Error" });
    },
  });
  runtime.errors.length = 0;

  const result = await runtime.sandbox.fetchEnv("cookie-value", "demo-project");

  assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), {
    error: "Error: 500 - Server Error",
  });
});

test("copyAllEnv copies joined values and alerts on success", async () => {
  const runtime = loadContentScript({ hasTarget: false });
  runtime.errors.length = 0;

  runtime.sandbox.copyAllEnv([
    { key: "API_KEY", value: "abc123" },
    { key: "SECRET", value: "shh" },
  ]);
  await flushPromises();

  assert.deepStrictEqual(runtime.clipboardWrites, ["API_KEY=abc123\nSECRET=shh"]);
  assert.deepStrictEqual(runtime.alerts, ["All ENV variables copied to clipboard!"]);
});

test("copyAllEnv logs clipboard failures", async () => {
  const runtime = loadContentScript({
    hasTarget: false,
    clipboardWriteText: () => Promise.reject(new Error("Clipboard blocked")),
  });
  runtime.errors.length = 0;

  runtime.sandbox.copyAllEnv([{ key: "API_KEY", value: "abc123" }]);
  await flushPromises();

  assert.equal(runtime.alerts.length, 0);
  assert.equal(runtime.errors.length, 1);
  assert.equal(runtime.errors[0][0], "Failed to copy ENV variables:");
});

test("downloadEnvFile creates, clicks, and removes a temporary link", () => {
  const runtime = loadContentScript({ hasTarget: false });
  runtime.errors.length = 0;
  const initialBodyChildren = runtime.document.body.children.length;

  runtime.sandbox.downloadEnvFile(".env.local", [
    { key: "API_KEY", value: "abc123" },
    { key: "SECRET", value: "shh" },
  ]);

  const link = runtime.createdElements.find((element) => element.tagName === "a");
  assert.ok(link);
  assert.equal(link.href, "blob:1");
  assert.equal(link.download, ".env.local");
  assert.equal(link.clickCount, 1);
  assert.equal(runtime.document.body.children.length, initialBodyChildren);
  assert.equal(runtime.createObjectUrlCalls.length, 1);
  assert.deepStrictEqual(runtime.revokeObjectUrlCalls, ["blob:1"]);
});

test("createUI renders loading, error, and success states", () => {
  const runtime = loadContentScript({ hasTarget: false });
  runtime.errors.length = 0;

  const loadingUi = runtime.sandbox.createUI();
  const errorUi = runtime.sandbox.createUI(false, { error: "Project name not found." });
  const resultUi = runtime.sandbox.createUI(false, {
    env: [{ key: "API_KEY", value: "abc123" }],
  });

  assert.ok(loadingUi.children[1].children[0].innerHTML.includes("Loading environment variables..."));
  assert.equal(errorUi.children[1].children[0].textContent, "Error: Project name not found.");

  const buttons = walkTree(resultUi, (node) => node.tagName === "button");
  assert.equal(buttons.length, 2);
  assert.ok(buttons[0].innerHTML.includes("Copy"));
  assert.ok(buttons[1].innerHTML.includes(".env"));
});

test("initializeUI logs when the target element is missing", () => {
  const runtime = loadContentScript({ hasTarget: false });

  assert.equal(runtime.sendMessageCalls.length, 0);
  assert.deepStrictEqual(runtime.errors, [["Target element not found!"]]);
});

test("initializeUI inserts an error card when the project name is unavailable", () => {
  const runtime = loadContentScript({
    hasTarget: true,
    projectName: null,
  });

  assert.equal(runtime.sendMessageCalls.length, 0);
  assert.equal(runtime.targetParent.children.length, 2);

  const insertedUi = runtime.targetParent.children[1];
  assert.equal(insertedUi.children[1].children[0].textContent, "Error: Project name not found. Please refresh the page.");
});

test("initializeUI inserts the result UI after requesting authorization and fetching env vars", async () => {
  const runtime = loadContentScript({
    hasTarget: true,
    fetchImpl: async (url) => {
      if (url.endsWith("/projects/demo-project")) {
        return createResponse({ env: [] });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    },
  });

  await flushPromises();

  assert.deepStrictEqual(JSON.parse(JSON.stringify(runtime.sendMessageCalls)), [
    { text: "getAuthorization" },
  ]);
  assert.equal(runtime.fetchCalls.length, 1);
  assert.equal(runtime.targetParent.children.length, 2);

  const insertedUi = runtime.targetParent.children[1];
  const buttons = walkTree(insertedUi, (node) => node.tagName === "button");
  assert.equal(buttons.length, 2);
});

test("url changes schedule another UI initialization through the mutation observer", () => {
  const runtime = loadContentScript({
    hasTarget: true,
    fetchImpl: async () => createResponse({ env: [] }),
  });

  assert.equal(runtime.observerInstances.length, 1);
  assert.equal(runtime.observerInstances[0].target, runtime.document);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(runtime.observerInstances[0].options)), {
    subtree: true,
    childList: true,
  });

  runtime.sandbox.location.href = "https://vercel.com/demo/settings/environment-variables?tab=preview";
  runtime.observerInstances[0].callback();

  assert.equal(runtime.timeouts.length, 1);
  assert.equal(runtime.timeouts[0].delay, 1000);
});
