const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const backgroundPath = path.join(
  __dirname,
  "..",
  "background.js"
);
const backgroundSource = fs.readFileSync(backgroundPath, "utf8");

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadBackgroundScript({
  cookie,
  lastError = null,
} = {}) {
  let cookieCallback;
  let messageListener;
  const errors = [];
  const logs = [];

  const chrome = {
    cookies: {
      get(options, callback) {
        chrome.cookies.lastOptions = options;
        cookieCallback = callback;
      },
    },
    runtime: {
      get lastError() {
        return lastError;
      },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
    },
  };

  const context = {
    chrome,
    console: {
      error: (...args) => errors.push(args),
      log: (...args) => logs.push(args),
    },
  };

  vm.createContext(context);
  vm.runInContext(backgroundSource, context, { filename: backgroundPath });

  if (cookieCallback) {
    cookieCallback(cookie);
  }

  return {
    chrome,
    errors,
    logs,
    sendMessage() {
      let response;
      messageListener({}, {}, (value) => {
        response = value;
      });
      return response;
    },
  };
}

test("background responds with the authorization cookie after it is loaded", () => {
  const runtime = loadBackgroundScript({
    cookie: { value: "auth-token" },
  });

  assert.deepEqual(normalize(runtime.chrome.cookies.lastOptions), {
    url: "https://vercel.com",
    name: "authorization",
  });
  assert.equal(runtime.sendMessage(), "auth-token");
  assert.deepEqual(runtime.logs[0], [
    "Authorization Cookie:",
    { value: "auth-token" },
  ]);
});

test("background keeps the default authorization when cookie lookup fails", () => {
  const runtime = loadBackgroundScript({
    cookie: { value: "ignored" },
    lastError: { message: "lookup failed" },
  });

  assert.equal(runtime.sendMessage(), "EMPTY");
  assert.deepEqual(runtime.errors[0], [{ message: "lookup failed" }]);
});

test("background reports when the authorization cookie is missing", () => {
  const runtime = loadBackgroundScript();

  assert.equal(runtime.sendMessage(), "EMPTY");
  assert.deepEqual(runtime.errors[0], ["Authorization cookie not found"]);
});
