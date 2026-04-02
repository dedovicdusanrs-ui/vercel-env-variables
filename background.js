const PROJECT_NAME_PATTERN = /^[\w.-]+$/;

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

function normalizeProjectName(projectName) {
  const normalizedProjectName = typeof projectName === "string" ? projectName.trim() : "";

  if (!PROJECT_NAME_PATTERN.test(normalizedProjectName)) {
    throw new Error("Invalid project name.");
  }

  return normalizedProjectName;
}

async function fetchProjectEnvironmentVariables(projectName) {
  const authorizationCookie = await getAuthorizationCookie();
  const encodedProjectName = encodeURIComponent(normalizeProjectName(projectName));

  const projectData = await fetchJson(
    `https://vercel.com/api/v9/projects/${encodedProjectName}`,
    authorizationCookie
  );

  const envEntries = Array.isArray(projectData.env) ? projectData.env : [];
  const envVariables = await Promise.all(
    envEntries.map(async (envEntry) => {
      const envData = await fetchJson(
        `https://vercel.com/api/v1/projects/${encodedProjectName}/env/${envEntry.id}`,
        authorizationCookie
      );

      return {
        key: envData.key,
        value: envData.value,
      };
    })
  );

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
