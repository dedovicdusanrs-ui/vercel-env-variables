async function getAuthorizationCookie() {
  const cookie = await chrome.cookies.get({
    url: "https://vercel.com",
    name: "authorization",
  });

  if (!cookie?.value) {
    throw new Error("Authorization cookie not found. Please sign in to Vercel and try again.");
  }

  return cookie.value;
}

async function fetchJson(url, authorizationCookie) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Cookie: `authorization=${authorizationCookie};`,
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchProjectEnvironmentVariables(projectName) {
  const authorizationCookie = await getAuthorizationCookie();
  const encodedProjectName = encodeURIComponent(projectName);

  const projectData = await fetchJson(
    `https://vercel.com/api/v9/projects/${encodedProjectName}`,
    authorizationCookie
  );

  const envEntries = Array.isArray(projectData.env) ? projectData.env : [];
  const envVariables = [];

  for (const envEntry of envEntries) {
    const envData = await fetchJson(
      `https://vercel.com/api/v1/projects/${encodedProjectName}/env/${envEntry.id}`,
      authorizationCookie
    );

    envVariables.push({
      key: envData.key,
      value: envData.value,
    });
  }

  return { env: envVariables };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FETCH_ENV_VARIABLES") {
    return false;
  }

  fetchProjectEnvironmentVariables(message.projectName)
    .then((result) => sendResponse(result))
    .catch((error) => {
      console.error("Failed to fetch environment variables:", error);
      sendResponse({ error: error.message || "Failed to fetch environment variables." });
    });

  return true;
});
