const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const backgroundPath = path.join(__dirname, "..", "background.js");
const backgroundSource = fs.readFileSync(backgroundPath, "utf8");

function loadBackground({
  cookie = { value: "auth-token" },
  lastError = null,
} = {}) {
  const cookieRequests = [];
  const listeners = [];
  const errors = [];

  const sandbox = {
    chrome: {
      cookies: {
        get(options, callback) {
          cookieRequests.push(options);
          callback(cookie);
        },
      },
      runtime: {
        lastError,
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          },
        },
      },
    },
    console: {
      error(...args) {
        errors.push(args);
      },
      log() {},
    },
  };

  vm.runInNewContext(backgroundSource, sandbox, { filename: backgroundPath });

  return { cookieRequests, listeners, errors };
}

test("background.js reads the authorization cookie and returns it in messages", () => {
  const { cookieRequests, listeners } = loadBackground({
    cookie: { value: "vercel-auth" },
  });

  assert.deepStrictEqual(JSON.parse(JSON.stringify(cookieRequests)), [
    { url: "https://vercel.com", name: "authorization" },
  ]);
  assert.equal(listeners.length, 1);

  let response;
  listeners[0]({}, {}, (value) => {
    response = value;
  });

  assert.equal(response, "vercel-auth");
});

test("background.js logs cookie lookup errors and keeps the fallback authorization value", () => {
  const runtimeError = { message: "Cookie lookup failed" };
  const { listeners, errors } = loadBackground({
    cookie: { value: "ignored" },
    lastError: runtimeError,
  });

  let response;
  listeners[0]({}, {}, (value) => {
    response = value;
  });

  assert.equal(response, "EMPTY");
  assert.deepStrictEqual(errors, [[runtimeError]]);
});
