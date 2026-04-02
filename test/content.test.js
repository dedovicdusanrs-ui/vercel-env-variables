const test = require("node:test");
const assert = require("node:assert/strict");

global.document = {
  querySelector: () => null,
};
global.navigator = {
  clipboard: {
    writeText: () => Promise.resolve(),
  },
};
global.alert = () => {};
global.MutationObserver = class {
  observe() {}
  disconnect() {}
};

const {
  buildEnvContent,
  buildProjectApiUrl,
  buildProjectEnvApiUrl,
  getErrorMessage,
} = require("../scripts/content.js");

test("buildProjectApiUrl encodes project names", () => {
  assert.equal(
    buildProjectApiUrl("project name/with slash"),
    "https://vercel.com/api/v9/projects/project%20name%2Fwith%20slash"
  );
});

test("buildProjectEnvApiUrl reuses encoded project name", () => {
  assert.equal(
    buildProjectEnvApiUrl("project name/with slash", "env_123"),
    "https://vercel.com/api/v1/projects/project%20name%2Fwith%20slash/env/env_123"
  );
});

test("buildEnvContent serializes all variables", () => {
  assert.equal(
    buildEnvContent([
      { key: "FIRST_KEY", value: "value-one" },
      { key: "SECOND_KEY", value: "value-two" },
    ]),
    "FIRST_KEY=value-one\nSECOND_KEY=value-two"
  );
});

test("getErrorMessage handles unknown throw values", () => {
  assert.equal(getErrorMessage("boom"), "Unknown error");
  assert.equal(getErrorMessage(new Error("boom")), "boom");
});
