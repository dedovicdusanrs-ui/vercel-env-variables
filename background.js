let authorization = "EMPTY";

function setAuthorization(value = "EMPTY") {
  authorization = value;
  return authorization;
}

function getAuthorization() {
  return authorization;
}

function loadAuthorizationCookie(chromeApi = chrome, logger = console) {
  chromeApi.cookies.get(
    { url: "https://vercel.com", name: "authorization" },
    (cookie) => {
      if (chromeApi.runtime.lastError) {
        logger.error(chromeApi.runtime.lastError);
        return;
      }

      logger.log("Authorization Cookie:", cookie);
      setAuthorization(cookie?.value ?? "EMPTY");
    }
  );
}

function registerMessageListener(chromeApi = chrome) {
  chromeApi.runtime.onMessage.addListener(function (_msg, _sender, sendResponse) {
    sendResponse(getAuthorization());
  });
}

function initializeBackground(chromeApi = chrome, logger = console) {
  loadAuthorizationCookie(chromeApi, logger);
  registerMessageListener(chromeApi);
}

if (typeof chrome !== "undefined" && chrome?.cookies && chrome?.runtime?.onMessage) {
  initializeBackground();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getAuthorization,
    initializeBackground,
    loadAuthorizationCookie,
    registerMessageListener,
    setAuthorization,
  };
}
