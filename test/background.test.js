'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = fs.readFileSync(
  path.join(__dirname, '..', 'background.js'),
  'utf8'
);

/**
 * Loads background.js in a fresh VM context.
 *
 * Returns helpers to:
 *   - triggerCookie(cookie)  – invoke the stored cookies.get callback
 *   - sendMessage(msg, cb)   – invoke the stored onMessage listener
 *   - errors / logs          – captured console output
 *   - capturedGetOpts        – options passed to chrome.cookies.get
 */
function loadBg({ lastError = null } = {}) {
  let getCb;
  let capturedGetOpts;
  let msgListener;
  const errors = [];
  const logs = [];

  const ctx = {
    chrome: {
      cookies: {
        get(opts, cb) {
          capturedGetOpts = opts;
          getCb = cb;
        },
      },
      runtime: {
        get lastError() { return lastError; },
        onMessage: {
          addListener(fn) { msgListener = fn; },
        },
      },
    },
    console: {
      log(...a) { logs.push(a); },
      error(...a) { errors.push(a); },
    },
  };

  vm.runInNewContext(SCRIPT, ctx);

  return {
    get capturedGetOpts() { return capturedGetOpts; },
    get errors() { return errors; },
    get logs() { return logs; },
    triggerCookie(cookie) { if (getCb) getCb(cookie); },
    sendMessage(msg, cb) { if (msgListener) msgListener(msg, {}, cb); },
  };
}

describe('background.js', () => {
  it('calls chrome.cookies.get with the correct url and name', () => {
    const bg = loadBg();
    assert.equal(bg.capturedGetOpts.url, 'https://vercel.com');
    assert.equal(bg.capturedGetOpts.name, 'authorization');
  });

  it('responds with "EMPTY" before the cookie callback fires', () => {
    const bg = loadBg();
    const responses = [];
    bg.sendMessage({}, (r) => responses.push(r));
    assert.equal(responses[0], 'EMPTY');
  });

  it('responds with the cookie value after the cookie callback fires', () => {
    const bg = loadBg();
    bg.triggerCookie({ value: 'session-abc' });
    const responses = [];
    bg.sendMessage({}, (r) => responses.push(r));
    assert.equal(responses[0], 'session-abc');
  });

  it('does not update authorization and logs an error when lastError is set', () => {
    const bg = loadBg({ lastError: { message: 'Permission denied' } });
    bg.triggerCookie({ value: 'should-not-be-used' });
    const responses = [];
    bg.sendMessage({}, (r) => responses.push(r));
    assert.equal(responses[0], 'EMPTY');
    assert.ok(bg.errors.length > 0);
  });

  it('responds to any message with the current authorization value', () => {
    const bg = loadBg();
    bg.triggerCookie({ value: 'my-token' });
    const responses = [];
    bg.sendMessage({ text: 'getAuthorization' }, (r) => responses.push(r));
    bg.sendMessage({ text: 'somethingElse' }, (r) => responses.push(r));
    assert.equal(responses.length, 2);
    assert.ok(responses.every((r) => r === 'my-token'));
  });
});
