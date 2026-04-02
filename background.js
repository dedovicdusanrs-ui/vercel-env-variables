function getAuthorizationCookie() {
  return new Promise((resolve) => {
    chrome.cookies.get(
      { url: "https://vercel.com", name: "authorization" },
      (cookie) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError);
          resolve({
            error: "Unable to read the Vercel authorization cookie.",
          });
          return;
        }

        if (!cookie?.value) {
          resolve({
            error: "Vercel authorization cookie not found. Please sign in to Vercel and refresh the page.",
          });
          return;
        }

        resolve({ authorization: cookie.value });
      }
    );
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "getAuthorization") {
    return false;
  }

  getAuthorizationCookie().then(sendResponse);
  return true;
});
