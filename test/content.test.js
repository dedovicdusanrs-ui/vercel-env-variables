const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const contentPath = path.join(__dirname, "..", "scripts", "content.js");
const contentSource = fs.readFileSync(contentPath, "utf8");

const PROJECT_NAME_SELECTOR =
  "body > div.bg-background-200.min-h-vh.relative > header > nav > ul > li:nth-child(2) > div > a > p";
const TARGET_SELECTOR =
  "#environment-variables-fieldset > span:nth-child(5)";

class FakeStyle {
  constructor() {
    this.cssText = "";
    this.properties = {};
  }

  setProperty(name, value) {
    this.properties[name] = value;
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.className = "";
    this.style = new FakeStyle();
    this.innerHTML = "";
    this.textContent = "";
    this.eventListeners = {};
    this.clicked = false;
    this.href = "";
    this.download = "";
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
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
    } else {
      this.children.splice(index, 0, node);
    }

    return node;
  }

  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index !== -1) {
      this.children.splice(index, 1);
      node.parentNode = null;
    }

    return node;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(type, handler) {
    this.eventListeners[type] ??= [];
    this.eventListeners[type].push(handler);
  }

  click() {
    this.clicked = true;
    for (const handler of this.eventListeners.click ?? []) {
      handler();
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

function createDocument({ projectName, hasTarget = true } = {}) {
  const selectors = {};
  const document = {
    body: new FakeElement("body"),
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    querySelector(selector) {
      return selectors[selector] ?? null;
    },
  };

  if (projectName) {
    const projectElement = new FakeElement("p");
    projectElement.textContent = projectName;
    selectors[PROJECT_NAME_SELECTOR] = projectElement;
  }

  if (hasTarget) {
    const parent = new FakeElement("div");
    const target = new FakeElement("span");
    parent.appendChild(target);
    document.body.appendChild(parent);
    document.targetParent = parent;
    document.targetElement = target;
    selectors[TARGET_SELECTOR] = target;
  }

  return document;
}

function jsonResponse(body, { ok = true, status = 200, statusText = "OK" } = {}) {
  return {
    ok,
    status,
    statusText,
    async json() {
      return body;
    },
  };
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
  await Promise.resolve();
}

function loadContentScript(options = {}) {
  const document = createDocument({
    projectName: options.projectName,
    hasTarget: options.hasTarget,
  });
  const logs = { error: [], log: [] };
  const alerts = [];
  const clipboardWrites = [];
  const fetchCalls = [];
  const sendMessageCalls = [];
  const createObjectURLCalls = [];
  const revokeObjectURLCalls = [];
  const timeoutCalls = [];
  let mutationObserverCallback;

  const fetchQueue = [...(options.fetchResponses ?? [])];
  const fetch = async (url, fetchOptions) => {
    fetchCalls.push([url, fetchOptions]);
    const nextResponse = fetchQueue.shift();

    if (!nextResponse) {
      throw new Error(`Unexpected fetch call for ${url}`);
    }

    return typeof nextResponse === "function"
      ? nextResponse(url, fetchOptions)
      : nextResponse;
  };

  const context = vm.createContext({
    Blob: class Blob {
      constructor(parts, config) {
        this.parts = parts;
        this.type = config.type;
      }
    },
    MutationObserver: class MutationObserver {
      constructor(callback) {
        mutationObserverCallback = callback;
      }

      observe(target, config) {
        this.target = target;
        this.config = config;
      }
    },
    alert: (message) => alerts.push(message),
    chrome: {
      runtime: {
        sendMessage(message, callback) {
          sendMessageCalls.push(message);

          if (options.sendMessage) {
            options.sendMessage(message, callback);
            return;
          }

          callback(options.authorization ?? "authorization-token");
        },
      },
    },
    console: {
      error: (...args) => logs.error.push(args),
      log: (...args) => logs.log.push(args),
    },
    document,
    fetch,
    location: {
      href:
        options.href ??
        "https://vercel.com/example/settings/environment-variables",
    },
    navigator: {
      clipboard: {
        writeText(text) {
          clipboardWrites.push(text);

          if (options.clipboardError) {
            return Promise.reject(options.clipboardError);
          }

          return Promise.resolve();
        },
      },
    },
    setTimeout(callback, delay) {
      timeoutCalls.push({ callback, delay });

      if (options.runTimeoutsImmediately) {
        callback();
      }

      return timeoutCalls.length;
    },
    window: {
      URL: {
        createObjectURL(blob) {
          createObjectURLCalls.push(blob);
          return "blob:generated-url";
        },
        revokeObjectURL(url) {
          revokeObjectURLCalls.push(url);
        },
      },
    },
  });

  vm.runInContext(contentSource, context, { filename: contentPath });

  return {
    alerts,
    clipboardWrites,
    context,
    createObjectURLCalls,
    document,
    fetchCalls,
    logs,
    mutationObserverCallback,
    revokeObjectURLCalls,
    sendMessageCalls,
    timeoutCalls,
  };
}

test("fetchEnv returns decrypted environment variables and reuses the auth cookie header", async () => {
  const { context, fetchCalls } = loadContentScript({
    hasTarget: false,
    projectName: "demo-project",
    fetchResponses: [
      jsonResponse({
        env: [
          { id: "env_1", key: "API_KEY", value: "encrypted-1" },
          { id: "env_2", key: "APP_URL", value: "encrypted-2" },
        ],
      }),
      jsonResponse({ key: "API_KEY", value: "secret" }),
      jsonResponse({ key: "APP_URL", value: "https://example.com" }),
    ],
  });

  const result = await context.fetchEnv("cookie-value", "demo-project");

  assert.deepStrictEqual(normalize(result), {
    env: [
      { key: "API_KEY", value: "secret" },
      { key: "APP_URL", value: "https://example.com" },
    ],
  });
  assert.deepStrictEqual(fetchCalls.map(([url]) => url), [
    "https://vercel.com/api/v9/projects/demo-project",
    "https://vercel.com/api/v1/projects/demo-project/env/env_1",
    "https://vercel.com/api/v1/projects/demo-project/env/env_2",
  ]);
  assert.equal(fetchCalls[0][1].headers.Cookie, "authorization=cookie-value;");
});

test("fetchEnv returns an empty env array when the project has no environment variables", async () => {
  const { context, fetchCalls } = loadContentScript({
    hasTarget: false,
    projectName: "demo-project",
    fetchResponses: [jsonResponse({})],
  });

  const result = await context.fetchEnv("cookie-value", "demo-project");

  assert.deepStrictEqual(normalize(result), { env: [] });
  assert.equal(fetchCalls.length, 1);
});

test("fetchEnv surfaces project request failures", async () => {
  const { context, logs } = loadContentScript({
    hasTarget: false,
    projectName: "demo-project",
    fetchResponses: [
      jsonResponse({}, { ok: false, status: 401, statusText: "Unauthorized" }),
    ],
  });

  const result = await context.fetchEnv("cookie-value", "demo-project");

  assert.deepStrictEqual(normalize(result), {
    error: "Error: 401 - Unauthorized",
  });
  assert.equal(logs.error[1][0], "Failed to fetch project data:");
});

test("fetchEnv surfaces individual environment request failures", async () => {
  const { context } = loadContentScript({
    hasTarget: false,
    projectName: "demo-project",
    fetchResponses: [
      jsonResponse({
        env: [{ id: "env_1", key: "API_KEY", value: "encrypted-1" }],
      }),
      jsonResponse({}, { ok: false, status: 404, statusText: "Not Found" }),
    ],
  });

  const result = await context.fetchEnv("cookie-value", "demo-project");

  assert.deepStrictEqual(normalize(result), {
    error: "Error: 404 - Not Found",
  });
});

test("copyAllEnv copies env values and shows a success alert", async () => {
  const { alerts, clipboardWrites, context } = loadContentScript({
    hasTarget: false,
    projectName: "demo-project",
  });

  context.copyAllEnv([
    { key: "API_KEY", value: "secret" },
    { key: "APP_URL", value: "https://example.com" },
  ]);
  await flushPromises();
  await flushPromises();

  assert.deepStrictEqual(clipboardWrites, [
    "API_KEY=secret\nAPP_URL=https://example.com",
  ]);
  assert.deepStrictEqual(alerts, ["All ENV variables copied to clipboard!"]);
});

test("copyAllEnv logs clipboard write failures", async () => {
  const clipboardError = new Error("Clipboard unavailable");
  const { context, logs } = loadContentScript({
    hasTarget: false,
    projectName: "demo-project",
    clipboardError,
  });

  context.copyAllEnv([{ key: "API_KEY", value: "secret" }]);
  await flushPromises();

  assert.deepStrictEqual(logs.error.at(-1), [
    "Failed to copy ENV variables:",
    clipboardError,
  ]);
});

test("downloadEnvFile creates, clicks, and cleans up a temporary download link", () => {
  const {
    context,
    createObjectURLCalls,
    document,
    revokeObjectURLCalls,
  } = loadContentScript({
    hasTarget: false,
    projectName: "demo-project",
  });

  context.downloadEnvFile(".env", [{ key: "API_KEY", value: "secret" }]);

  assert.equal(createObjectURLCalls.length, 1);
  assert.deepStrictEqual(normalize(createObjectURLCalls[0].parts), ["API_KEY=secret"]);
  assert.equal(createObjectURLCalls[0].type, "text/plain");
  assert.deepStrictEqual(revokeObjectURLCalls, ["blob:generated-url"]);
  assert.equal(document.body.children.length, 0);
});

test("createUI renders loading, error, and success states", () => {
  const { context } = loadContentScript({
    hasTarget: false,
    projectName: "demo-project",
  });

  const loadingUi = context.createUI(true);
  assert.match(loadingUi.children[1].children[0].innerHTML, /Loading environment variables/);

  const errorUi = context.createUI(false, { error: "No access" });
  assert.equal(errorUi.children[1].children[0].textContent, "Error: No access");

  const successUi = context.createUI(false, {
    env: [{ key: "API_KEY", value: "secret" }],
  });
  const buttons = successUi.children[1].children[0].children;
  assert.equal(buttons.length, 2);
  assert.match(buttons[0].innerHTML, /Copy/);
  assert.match(buttons[1].innerHTML, /\.env/);
});

test("initializeUI logs when the target element cannot be found", () => {
  const { logs } = loadContentScript({
    hasTarget: false,
    projectName: "demo-project",
  });

  assert.deepStrictEqual(logs.error[0], ["Target element not found!"]);
});

test("initializeUI inserts an error card when the project name is missing", () => {
  const { document, logs } = loadContentScript({
    hasTarget: true,
  });

  assert.deepStrictEqual(logs.error[0], ["Project name not found!"]);
  assert.equal(
    document.targetParent.children[1].children[1].children[0].textContent,
    "Error: Project name not found. Please refresh the page."
  );
});

test("initializeUI fetches env data and replaces the loading state with actions", async () => {
  const { document, fetchCalls, sendMessageCalls } = loadContentScript({
    hasTarget: true,
    projectName: "demo-project",
    fetchResponses: [
      jsonResponse({
        env: [{ id: "env_1", key: "API_KEY", value: "encrypted-1" }],
      }),
      jsonResponse({ key: "API_KEY", value: "secret" }),
    ],
  });

  await flushPromises();

  assert.deepStrictEqual(normalize(sendMessageCalls), [{ text: "getAuthorization" }]);
  assert.equal(fetchCalls.length, 2);
  assert.equal(document.targetParent.children.length, 2);
  assert.match(
    document.targetParent.children[1].children[1].children[0].children[0].innerHTML,
    /Copy/
  );
});

test("mutation observer re-initializes the UI only after the URL changes", async () => {
  const {
    context,
    mutationObserverCallback,
    sendMessageCalls,
    timeoutCalls,
  } = loadContentScript({
    hasTarget: true,
    projectName: "demo-project",
    fetchResponses: [jsonResponse({}), jsonResponse({})],
  });

  await flushPromises();
  mutationObserverCallback();
  assert.equal(timeoutCalls.length, 0);

  context.location.href = "https://vercel.com/example/settings/general";
  mutationObserverCallback();
  assert.equal(timeoutCalls[0].delay, 1000);

  timeoutCalls[0].callback();
  await flushPromises();

  assert.equal(sendMessageCalls.length, 2);
});
