const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const backgroundPath = path.join(__dirname, "..", "background.js");
const backgroundSource = fs.readFileSync(backgroundPath, "utf8");

function loadBackgroundScript({ cookie = { value: "token" }, lastError = null } = {}) {
  const logs = { error: [], log: [] };
  let messageListener;

  const chrome = {
    cookies: {
      get(details, callback) {
        chrome.cookies.lastRequest = details;
        callback(cookie);
      },
    },
    runtime: {
      lastError,
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
    },
  };

  const context = vm.createContext({
    chrome,
    console: {
      error: (...args) => logs.error.push(args),
      log: (...args) => logs.log.push(args),
    },
  });

  vm.runInContext(backgroundSource, context, { filename: backgroundPath });

  return { chrome, logs, messageListener };
}

test("background script stores the authorization cookie and returns it in messages", () => {
  const { chrome, logs, messageListener } = loadBackgroundScript({
    cookie: { value: "secret-token" },
  });

  let response;
  messageListener({}, {}, (value) => {
    response = value;
  });

  assert.deepStrictEqual(chrome.cookies.lastRequest, {
    url: "https://vercel.com",
    name: "authorization",
  });
  assert.equal(response, "secret-token");
  assert.deepStrictEqual(logs.log[0], [
    "Authorization Cookie:",
    { value: "secret-token" },
  ]);
});

test("background script keeps the default authorization when cookie lookup fails", () => {
  const lookupError = { message: "Permission denied" };
  const { logs, messageListener } = loadBackgroundScript({
    cookie: { value: "secret-token" },
    lastError: lookupError,
  });

  let response;
  messageListener({}, {}, (value) => {
    response = value;
  });

  assert.equal(response, "EMPTY");
  assert.deepStrictEqual(logs.error[0], [lookupError]);
});
