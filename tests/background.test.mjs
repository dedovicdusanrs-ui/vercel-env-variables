import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

describe("background.js", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function createChromeMock({ cookie, lastError = null } = {}) {
    const listeners = [];
    return {
      chromeApi: {
        cookies: {
          get: vi.fn((_details, callback) => callback(cookie)),
        },
        runtime: {
          lastError,
          onMessage: {
            addListener: vi.fn((listener) => listeners.push(listener)),
          },
        },
      },
      listeners,
    };
  }

  it("loads the authorization cookie and serves it through the message listener", () => {
    const logger = { error: vi.fn(), log: vi.fn() };
    const { chromeApi, listeners } = createChromeMock({
      cookie: { value: "auth-token" },
    });
    const background = require("../background.js");

    background.initializeBackground(chromeApi, logger);

    expect(chromeApi.cookies.get).toHaveBeenCalledWith(
      { url: "https://vercel.com", name: "authorization" },
      expect.any(Function)
    );
    expect(background.getAuthorization()).toBe("auth-token");
    expect(chromeApi.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);

    const sendResponse = vi.fn();
    listeners[0]({}, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith("auth-token");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("keeps the fallback authorization value when reading the cookie fails", () => {
    const logger = { error: vi.fn(), log: vi.fn() };
    const { chromeApi } = createChromeMock({
      cookie: undefined,
      lastError: { message: "No cookie" },
    });
    const background = require("../background.js");

    background.setAuthorization("EMPTY");
    background.loadAuthorizationCookie(chromeApi, logger);

    expect(background.getAuthorization()).toBe("EMPTY");
    expect(logger.error).toHaveBeenCalledWith(chromeApi.runtime.lastError);
  });
});
