const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const backgroundScript = fs.readFileSync(
  path.join(__dirname, "..", "background.js"),
  "utf8"
);

function loadBackgroundScript({
  cookie = { value: "token-123" },
  runtimeLastError = null,
} = {}) {
  let messageListener;
  const errors = [];

  const chrome = {
    runtime: {
      lastError: runtimeLastError,
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
    },
    cookies: {
      get(_details, callback) {
        callback(cookie);
      },
    },
  };

  const sandbox = {
    chrome,
    console: {
      log() {},
      error(...args) {
        errors.push(args);
      },
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(backgroundScript, sandbox);

  return {
    errors,
    sendMessage() {
      let response;
      messageListener({}, {}, (value) => {
        response = value;
      });
      return response;
    },
  };
}

test("background returns the authorization cookie value", () => {
  const script = loadBackgroundScript({ cookie: { value: "secret-token" } });

  assert.equal(script.sendMessage(), "secret-token");
  assert.equal(script.errors.length, 0);
});

test("background keeps default authorization value when cookie access fails", () => {
  const runtimeError = new Error("permission denied");
  const script = loadBackgroundScript({ runtimeLastError: runtimeError });

  assert.equal(script.sendMessage(), "EMPTY");
  assert.deepEqual(script.errors[0], [runtimeError]);
});

test("background handles a missing authorization cookie", () => {
  const script = loadBackgroundScript({ cookie: null });

  assert.equal(script.sendMessage(), "EMPTY");
  assert.deepEqual(script.errors[0], ["Authorization cookie not found."]);
});
