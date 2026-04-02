const VERCEL_URL = "https://vercel.com";

function getAuthorizationCookie() {
  return new Promise((resolve, reject) => {
    chrome.cookies.get(
      { url: VERCEL_URL, name: "authorization" },
      (cookie) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!cookie?.value) {
          reject(
            new Error(
              "Authorization cookie not found. Please sign in to Vercel and refresh the page."
            )
          );
          return;
        }

        resolve(cookie.value);
      }
    );
  });
}

async function fetchProjectEnv(projectName) {
  const authorizationCookie = await getAuthorizationCookie();
  const fetchOptions = {
    method: "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Cookie: `authorization=${authorizationCookie};`,
    },
  };

  const projectResponse = await fetch(
    `${VERCEL_URL}/api/v9/projects/${encodeURIComponent(projectName)}`,
    fetchOptions
  );

  if (!projectResponse.ok) {
    throw new Error(
      `Error: ${projectResponse.status} - ${projectResponse.statusText}`
    );
  }

  const projectData = await projectResponse.json();
  const encryptedEnvVars =
    projectData.env?.map((env) => ({ id: env.id })) || [];

  const envVars = [];
  for (const encryptedEnv of encryptedEnvVars) {
    const envResponse = await fetch(
      `${VERCEL_URL}/api/v1/projects/${encodeURIComponent(
        projectName
      )}/env/${encodeURIComponent(encryptedEnv.id)}`,
      fetchOptions
    );

    if (!envResponse.ok) {
      throw new Error(
        `Error: ${envResponse.status} - ${envResponse.statusText}`
      );
    }

    const envData = await envResponse.json();
    envVars.push({
      key: envData.key,
      value: envData.value,
    });
  }

  return { env: envVars };
}

function isAllowedSender(sender) {
  return typeof sender?.url === "string" && sender.url.startsWith(VERCEL_URL);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "fetchProjectEnv") {
    return false;
  }

  if (!isAllowedSender(sender) || !message.projectName) {
    sendResponse({ error: "Invalid request." });
    return false;
  }

  fetchProjectEnv(message.projectName)
    .then(sendResponse)
    .catch((error) => {
      console.error("Failed to fetch project data:", error);
      sendResponse({ error: error.message });
    });

  return true;
});
