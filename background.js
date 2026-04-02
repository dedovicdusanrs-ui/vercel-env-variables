function getAuthorization(sendResponse) {
  chrome.cookies.get(
    { url: "https://vercel.com", name: "authorization" },
    (cookie) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: "Unable to access the Vercel authorization cookie." });
        return;
      }

      if (!cookie?.value) {
        sendResponse({ error: "Vercel authorization cookie not found." });
        return;
      }

      sendResponse({ authorization: cookie.value });
    }
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.text !== "getAuthorization") {
    return false;
  }

  getAuthorization(sendResponse);
  return true;
});
