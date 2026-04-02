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
  let senderOrigin = null;

  try {
    senderOrigin = sender.url ? new URL(sender.url).origin : null;
  } catch (error) {
    senderOrigin = null;
  }

  if (sender.id !== chrome.runtime.id || senderOrigin !== "https://vercel.com") {
    sendResponse({ error: "Unauthorized sender." });
    return false;
  }

  if (message?.text !== "getAuthorization") {
    return false;
  }

  getAuthorization(sendResponse);
  return true;
});
