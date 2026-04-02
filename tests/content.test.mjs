// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

describe("scripts/content.js", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("fetchEnv returns decrypted environment variables on success", async () => {
    const logger = { error: vi.fn() };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          env: [
            { id: "env_1", key: "API_URL", value: "encrypted" },
            { id: "env_2", key: "TOKEN", value: "encrypted" },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ key: "API_URL", value: "https://example.com" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ key: "TOKEN", value: "secret" }),
      });
    const { fetchEnv } = require("../scripts/content.js");

    const result = await fetchEnv("auth-token", "demo-project", fetchImpl, logger);

    expect(result).toEqual({
      env: [
        { key: "API_URL", value: "https://example.com" },
        { key: "TOKEN", value: "secret" },
      ],
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://vercel.com/api/v9/projects/demo-project",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Cookie: "authorization=auth-token;",
        }),
      })
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("fetchEnv returns a readable error when the env detail request fails", async () => {
    const logger = { error: vi.fn() };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          env: [{ id: "env_1", key: "API_URL", value: "encrypted" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Server Error",
      });
    const { fetchEnv } = require("../scripts/content.js");

    const result = await fetchEnv("auth-token", "demo-project", fetchImpl, logger);

    expect(result).toEqual({ error: "Error: 500 - Server Error" });
    expect(logger.error).toHaveBeenCalled();
  });

  it("copies all environment variables in dotenv format", async () => {
    const alertFn = vi.fn();
    const logger = { error: vi.fn() };
    const navigatorApi = {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    };
    const { copyAllEnv } = require("../scripts/content.js");

    await copyAllEnv(
      [
        { key: "API_URL", value: "https://example.com" },
        { key: "TOKEN", value: "secret" },
      ],
      navigatorApi,
      alertFn,
      logger
    );

    expect(navigatorApi.clipboard.writeText).toHaveBeenCalledWith(
      "API_URL=https://example.com\nTOKEN=secret"
    );
    expect(alertFn).toHaveBeenCalledWith("All ENV variables copied to clipboard!");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("downloads an env file with the expected filename", () => {
    const appendedNodes = [];
    const removedNodes = [];
    const clickSpy = vi.spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const createObjectURL = vi.fn(() => "blob:download");
    const revokeObjectURL = vi.fn();
    const body = {
      appendChild: vi.fn((node) => appendedNodes.push(node)),
      removeChild: vi.fn((node) => removedNodes.push(node)),
    };
    const doc = {
      body,
      createElement: vi.fn((tagName) => document.createElement(tagName)),
    };
    const win = {
      URL: {
        createObjectURL,
        revokeObjectURL,
      },
    };
    const { downloadEnvFile } = require("../scripts/content.js");

    downloadEnvFile(
      ".env",
      [{ key: "API_URL", value: "https://example.com" }],
      doc,
      win
    );

    const link = appendedNodes[0];
    expect(doc.createElement).toHaveBeenCalledWith("a");
    expect(link.download).toBe(".env");
    expect(link.href).toBe("blob:download");
    expect(clickSpy).toHaveBeenCalled();
    expect(removedNodes[0]).toBe(link);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:download");
  });

  it("createUI renders loading, error, and success states", () => {
    const copyHandler = vi.fn();
    const downloadHandler = vi.fn();
    const { createUI } = require("../scripts/content.js");

    const loadingUi = createUI(true, null, { doc: document });
    expect(loadingUi.textContent).toContain("Loading environment variables...");

    const errorUi = createUI(false, { error: "Failed request" }, { doc: document });
    expect(errorUi.textContent).toContain("Error: Failed request");

    const successUi = createUI(
      false,
      { env: [{ key: "TOKEN", value: "secret" }] },
      { copyHandler, doc: document, downloadHandler }
    );
    const buttons = successUi.querySelectorAll("button");

    expect(buttons).toHaveLength(2);
    buttons[0].click();
    buttons[1].click();

    expect(copyHandler).toHaveBeenCalledWith([{ key: "TOKEN", value: "secret" }]);
    expect(downloadHandler).toHaveBeenCalledWith(".env", [{ key: "TOKEN", value: "secret" }]);
  });

  it("initializeUI inserts an error card when the project name is missing", () => {
    document.body.innerHTML = `
      <div id="environment-variables-fieldset">
        <span></span><span></span><span></span><span></span><span id="target"></span>
      </div>
    `;
    const logger = { error: vi.fn(), log: vi.fn() };
    const { initializeUI } = require("../scripts/content.js");

    initializeUI({
      chromeApi: { runtime: { sendMessage: vi.fn() } },
      doc: document,
      logger,
      projectName: null,
    });

    expect(logger.error).toHaveBeenCalledWith("Project name not found!");
    expect(document.body.textContent).toContain("Project name not found. Please refresh the page.");
  });

  it("initializeUI replaces the loading card with the fetched result", async () => {
    document.body.innerHTML = `
      <div id="environment-variables-fieldset">
        <span></span><span></span><span></span><span></span><span id="target"></span>
      </div>
    `;
    const fetchEnvFn = vi.fn().mockResolvedValue({
      env: [{ key: "TOKEN", value: "secret" }],
    });
    const sendMessage = vi.fn((_message, callback) => callback("auth-token"));
    const logger = { error: vi.fn(), log: vi.fn() };
    const { initializeUI } = require("../scripts/content.js");

    initializeUI({
      chromeApi: { runtime: { sendMessage } },
      doc: document,
      fetchEnvFn,
      logger,
      projectName: "demo-project",
    });

    expect(document.body.textContent).toContain("Loading environment variables...");

    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith(
      { text: "getAuthorization" },
      expect.any(Function)
    );
    expect(fetchEnvFn).toHaveBeenCalledWith("auth-token", "demo-project");
    expect(document.body.textContent).toContain("Copy");
    expect(document.body.textContent).toContain(".env");
    expect(document.body.textContent).not.toContain("Loading environment variables...");
  });
});
