function getAuthorizationCookie(sendResponse) {
  chrome.cookies.get(
    { url: "https://vercel.com", name: "authorization" },
    (cookie) => {
      if (chrome.runtime.lastError || !cookie?.value) {
        sendResponse("");
        return;
      }

      sendResponse(cookie.value);
    }
  );
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg?.text !== "getAuthorization") {
    sendResponse("");
    return;
  }

  getAuthorizationCookie(sendResponse);
  // Keep the message channel open because sendResponse runs in the cookies callback.
  return true;
});
