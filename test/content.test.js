'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
// Plain (non-strict) deepEqual is used when comparing objects returned from
// the VM context, whose prototypes differ from the outer context's prototypes.
const { deepEqual } = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'content.js'),
  'utf8'
);

/**
 * How long to wait (ms) for promise microtasks to settle in tests that
 * exercise clipboard / alert callbacks.  20 ms is plenty for a resolved
 * Promise chain; bump it if tests become flaky in slow CI environments.
 */
const ASYNC_SETTLE_MS = 20;

/** Creates a lightweight mock DOM element with event listener support. */
function el(tag) {
  const listeners = {};
  const node = {
    tagName: tag,
    className: '',
    innerHTML: '',
    textContent: '',
    href: '',
    download: '',
    style: { cssText: '', setProperty() {} },
    setAttribute() {},
    getAttribute: () => null,
    appendChild(c) { return c; },
    removeChild() {},
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    /** Simulate a native click / dispatch stored click listeners. */
    click() { (listeners.click || []).forEach((fn) => fn()); },
    /** Fire all listeners registered for the given event type. */
    fire(type) { (listeners[type] || []).forEach((fn) => fn()); },
    remove() {},
  };
  return node;
}

/**
 * Builds a VM sandbox context with browser-like globals mocked.
 *
 * The returned object exposes:
 *   _created   – every element produced by document.createElement()
 *   _bodyOps   – { appended, removed } tracking document.body operations
 *
 * Pass overrides to customise individual mocks per test.
 *
 * A fresh sandbox is created on every call, so state never leaks between
 * tests as long as each test invokes `run()` (or `sandbox()`) independently.
 */
function sandbox(overrides = {}) {
  const created = [];
  const bodyOps = { appended: [], removed: [] };

  const doc = overrides.document || {
    querySelector: () => null,
    createElement(tag) {
      const node = el(tag);
      created.push(node);
      return node;
    },
    body: {
      appendChild(c) { bodyOps.appended.push(c); },
      removeChild(c) { bodyOps.removed.push(c); },
    },
  };

  // Allow callers to override URL; keep window.URL in sync.
  const urlApi = overrides.URL || {
    createObjectURL: () => 'blob:mock',
    revokeObjectURL() {},
  };

  const ctx = {
    fetch: overrides.fetch ||
      (() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
    alert: overrides.alert || (() => {}),
    navigator: overrides.navigator ||
      { clipboard: { writeText: () => Promise.resolve() } },
    document: doc,
    chrome: overrides.chrome || {
      runtime: {
        sendMessage(m, cb) { if (cb) cb('mock-auth'); },
        lastError: null,
      },
    },
    URL: urlApi,
    window: { URL: urlApi },
    Blob: overrides.Blob ||
      function Blob(content, opts) { this.content = content; this.opts = opts; },
    MutationObserver: overrides.MutationObserver ||
      function MutationObserver() { this.observe = () => {}; },
    location: overrides.location || { href: 'https://vercel.com/test' },
    console: overrides.console ||
      { log() {}, error() {}, warn() {} },
    setTimeout,
  };

  ctx._created = created;
  ctx._bodyOps = bodyOps;
  return ctx;
}

/** Run the content script inside a fresh sandbox and return the context. */
function run(overrides = {}) {
  const ctx = sandbox(overrides);
  vm.runInNewContext(SCRIPT, ctx);
  return ctx;
}

// ─── fetchEnv ────────────────────────────────────────────────────────────────

describe('fetchEnv', () => {
  it('returns decrypted env vars on success', async () => {
    const mockFetch = (url) =>
      url.includes('/env/')
        ? Promise.resolve({ ok: true, json: () => Promise.resolve({ key: 'DB', value: 'postgres' }) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve({ env: [{ id: '1', key: 'DB', value: 'enc' }] }) });

    const ctx = run({ fetch: mockFetch });
    const result = await ctx.fetchEnv('cookie', 'myapp');
    deepEqual(result, { env: [{ key: 'DB', value: 'postgres' }] });
  });

  it('returns an empty env array when the project has no env field', async () => {
    const ctx = run({
      fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    });
    deepEqual(await ctx.fetchEnv('tok', 'proj'), { env: [] });
  });

  it('returns an error object when the project API returns a non-2xx status', async () => {
    const ctx = run({
      fetch: () =>
        Promise.resolve({ ok: false, status: 401, statusText: 'Unauthorized' }),
    });
    const result = await ctx.fetchEnv('bad', 'proj');
    assert.ok('error' in result, 'result should have an error key');
    assert.match(result.error, /401/);
  });

  it('returns an error object when the env-detail API returns a non-2xx status', async () => {
    let call = 0;
    const ctx = run({
      fetch: () => {
        call++;
        if (call === 1) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ env: [{ id: '1', key: 'K', value: 'e' }] }),
          });
        }
        return Promise.resolve({ ok: false, status: 403, statusText: 'Forbidden' });
      },
    });
    const result = await ctx.fetchEnv('tok', 'proj');
    assert.ok('error' in result);
  });

  it('returns an error object on a network failure', async () => {
    const ctx = run({ fetch: () => Promise.reject(new Error('timeout')) });
    deepEqual(await ctx.fetchEnv('tok', 'proj'), { error: 'timeout' });
  });

  it('includes the authorization cookie in the request headers', async () => {
    let headers;
    const ctx = run({
      fetch: (url, opts) => {
        headers = opts.headers;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      },
    });
    await ctx.fetchEnv('super-secret', 'proj');
    assert.ok(headers.Cookie.includes('super-secret'));
  });

  it('makes a separate request for each env var to decrypt its value', async () => {
    const envList = [
      { id: 'a', key: 'K1', value: 'e1' },
      { id: 'b', key: 'K2', value: 'e2' },
    ];
    let envIdx = 0;
    const ctx = run({
      fetch: (url) => {
        if (!url.includes('/env/'))
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ env: envList }),
          });
        const i = ++envIdx;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ key: `K${i}`, value: `v${i}` }),
        });
      },
    });
    const result = await ctx.fetchEnv('tok', 'proj');
    assert.equal(result.env.length, 2);
    deepEqual(result.env[0], { key: 'K1', value: 'v1' });
    deepEqual(result.env[1], { key: 'K2', value: 'v2' });
  });

  it('uses the GET method for all requests', async () => {
    const methods = [];
    const ctx = run({
      fetch: (url, opts) => {
        methods.push(opts.method);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ env: [] }),
        });
      },
    });
    await ctx.fetchEnv('tok', 'proj');
    assert.ok(methods.length > 0);
    assert.ok(methods.every((m) => m === 'GET'));
  });
});

// ─── copyAllEnv ──────────────────────────────────────────────────────────────

describe('copyAllEnv', () => {
  it('writes KEY=VALUE pairs joined by newlines to the clipboard', async () => {
    let written;
    const ctx = run({
      navigator: {
        clipboard: { writeText(t) { written = t; return Promise.resolve(); } },
      },
    });
    ctx.copyAllEnv([{ key: 'FOO', value: 'bar' }, { key: 'BAZ', value: 'qux' }]);
    await new Promise((r) => setTimeout(r, ASYNC_SETTLE_MS));
    assert.equal(written, 'FOO=bar\nBAZ=qux');
  });

  it('shows an alert after a successful clipboard write', async () => {
    let alerted;
    const ctx = run({
      navigator: { clipboard: { writeText: () => Promise.resolve() } },
      alert(m) { alerted = m; },
    });
    ctx.copyAllEnv([{ key: 'A', value: '1' }]);
    await new Promise((r) => setTimeout(r, ASYNC_SETTLE_MS));
    assert.ok(typeof alerted === 'string' && alerted.length > 0);
  });

  it('logs an error to the console when the clipboard write fails', async () => {
    const errors = [];
    const ctx = run({
      navigator: {
        clipboard: { writeText: () => Promise.reject(new Error('denied')) },
      },
      console: { log() {}, error(...a) { errors.push(a); } },
    });
    ctx.copyAllEnv([{ key: 'A', value: '1' }]);
    await new Promise((r) => setTimeout(r, ASYNC_SETTLE_MS));
    assert.ok(errors.length > 0);
  });

  it('writes an empty string to the clipboard for an empty array', async () => {
    let written;
    const ctx = run({
      navigator: {
        clipboard: { writeText(t) { written = t; return Promise.resolve(); } },
      },
      alert: () => {},
    });
    ctx.copyAllEnv([]);
    await new Promise((r) => setTimeout(r, ASYNC_SETTLE_MS));
    assert.equal(written, '');
  });

  it('writes a single entry without a trailing newline', async () => {
    let written;
    const ctx = run({
      navigator: {
        clipboard: { writeText(t) { written = t; return Promise.resolve(); } },
      },
      alert: () => {},
    });
    ctx.copyAllEnv([{ key: 'ONLY', value: 'one' }]);
    await new Promise((r) => setTimeout(r, ASYNC_SETTLE_MS));
    assert.equal(written, 'ONLY=one');
  });
});

// ─── downloadEnvFile ─────────────────────────────────────────────────────────

describe('downloadEnvFile', () => {
  it('creates a Blob with the correct KEY=VALUE content', () => {
    let blobContent;
    const ctx = run({
      Blob: function Blob(c) { blobContent = c; },
    });
    ctx.downloadEnvFile('.env', [{ key: 'A', value: '1' }, { key: 'B', value: '2' }]);
    assert.equal(blobContent[0], 'A=1\nB=2');
  });

  it('sets the correct download filename on the anchor element', () => {
    const ctx = run();
    ctx.downloadEnvFile('custom.env', [{ key: 'X', value: 'y' }]);
    const link = ctx._created.find((n) => n.tagName === 'a');
    assert.ok(link, 'an anchor element should be created');
    assert.equal(link.download, 'custom.env');
  });

  it('revokes the object URL after the download', () => {
    const revoked = [];
    const ctx = run({
      URL: {
        createObjectURL: () => 'blob:test-url',
        revokeObjectURL(u) { revoked.push(u); },
      },
    });
    ctx.downloadEnvFile('.env', [{ key: 'K', value: 'v' }]);
    assert.deepEqual(revoked, ['blob:test-url']);
  });

  it('appends the anchor to document.body and then removes it', () => {
    const ctx = run();
    ctx.downloadEnvFile('.env', [{ key: 'K', value: 'v' }]);
    assert.equal(ctx._bodyOps.appended.length, 1);
    assert.equal(ctx._bodyOps.removed.length, 1);
  });

  it('produces an empty string content for an empty env array', () => {
    let blobContent;
    const ctx = run({ Blob: function Blob(c) { blobContent = c; } });
    ctx.downloadEnvFile('.env', []);
    assert.equal(blobContent[0], '');
  });
});

// ─── createUI ────────────────────────────────────────────────────────────────

describe('createUI', () => {
  it('returns a DOM element in the loading state', () => {
    const ctx = run();
    const ui = ctx.createUI(true);
    assert.ok(ui != null);
    assert.ok(typeof ui.appendChild === 'function');
  });

  it('returns a DOM element in the error state', () => {
    const ctx = run();
    assert.ok(ctx.createUI(false, { error: 'oops' }) != null);
  });

  it('returns a DOM element in the success state', () => {
    const ctx = run();
    assert.ok(ctx.createUI(false, { env: [{ key: 'A', value: '1' }] }) != null);
  });

  it('defaults to the loading state when called without arguments', () => {
    const ctx = run();
    assert.ok(ctx.createUI() != null);
  });

  it('sets the error message as the text content of the error element', () => {
    const texts = [];
    const ctx = run({
      document: {
        querySelector: () => null,
        createElement(tag) {
          const node = el(tag);
          // Intercept textContent assignments to capture what gets rendered.
          Object.defineProperty(node, 'textContent', {
            get() { return node._tc || ''; },
            set(v) { node._tc = v; texts.push(v); },
          });
          return node;
        },
        body: { appendChild() {}, removeChild() {} },
      },
    });
    ctx.createUI(false, { error: 'Unauthorized access' });
    assert.ok(
      texts.some((t) => t.includes('Unauthorized access')),
      'error text should appear in some element'
    );
  });

  it('the copy button click triggers copyAllEnv with the env data', async () => {
    let written;
    const env = [{ key: 'MY_KEY', value: 'my_val' }];
    const ctx = run({
      navigator: {
        clipboard: { writeText(t) { written = t; return Promise.resolve(); } },
      },
      alert: () => {},
    });
    ctx.createUI(false, { env });
    const buttons = ctx._created.filter((n) => n.tagName === 'button');
    assert.ok(buttons.length >= 1, 'at least one button should be created');
    buttons[0].fire('click');
    await new Promise((r) => setTimeout(r, ASYNC_SETTLE_MS));
    assert.equal(written, 'MY_KEY=my_val');
  });

  it('the download button click triggers downloadEnvFile with the env data', () => {
    let blobContent;
    const env = [{ key: 'DL_KEY', value: 'dl_val' }];
    const ctx = run({
      Blob: function Blob(c) { blobContent = c; },
    });
    ctx.createUI(false, { env });
    const buttons = ctx._created.filter((n) => n.tagName === 'button');
    assert.ok(buttons.length >= 2, 'at least two buttons should be created');
    buttons[1].fire('click');
    assert.ok(blobContent, 'Blob should have been constructed');
    assert.equal(blobContent[0], 'DL_KEY=dl_val');
  });

  it('creates buttons only in the success state, not the loading or error states', () => {
    const ctxLoading = run();
    ctxLoading.createUI(true);
    assert.equal(
      ctxLoading._created.filter((n) => n.tagName === 'button').length,
      0,
      'loading state should have no buttons'
    );

    const ctxError = run();
    ctxError.createUI(false, { error: 'fail' });
    assert.equal(
      ctxError._created.filter((n) => n.tagName === 'button').length,
      0,
      'error state should have no buttons'
    );
  });
});
