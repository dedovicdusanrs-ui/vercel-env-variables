const EXPORT_CARD_ID = "vercel-env-variables-export-card";
const TARGET_SELECTOR = "#environment-variables-fieldset > span:nth-child(5)";
const PROJECT_NAME_SELECTOR =
  "body > div.bg-background-200.min-h-vh.relative > header > nav > ul > li:nth-child(2) > div > a > p";
const PROJECT_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeProjectName(value) {
  const trimmedValue = value?.trim();

  if (!isNonEmptyString(trimmedValue) || !PROJECT_NAME_PATTERN.test(trimmedValue)) {
    return null;
  }

  return trimmedValue;
}

function getProjectName() {
  const pathSegments = window.location.pathname.split("/").filter(Boolean);
  const settingsIndex = pathSegments.indexOf("settings");

  if (settingsIndex > 0) {
    const projectNameFromPath = normalizeProjectName(pathSegments[settingsIndex - 1]);

    if (projectNameFromPath) {
      return projectNameFromPath;
    }
  }

  return normalizeProjectName(document.querySelector(PROJECT_NAME_SELECTOR)?.textContent);
}

function isEnvironmentVariablesPage() {
  return window.location.pathname.includes("/settings/environment-variables");
}

function buildProjectApiUrl(projectName) {
  return new URL(`/api/v9/projects/${encodeURIComponent(projectName)}`, window.location.origin);
}

function buildEnvApiUrl(projectName, envId) {
  return new URL(
    `/api/v1/projects/${encodeURIComponent(projectName)}/env/${encodeURIComponent(envId)}`,
    window.location.origin
  );
}

function createFetchOptions(authorizationCookie) {
  if (!isNonEmptyString(authorizationCookie)) {
    throw new Error("Unable to authorize this request. Refresh the page and try again.");
  }

  return {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: `authorization=${encodeURIComponent(authorizationCookie)};`,
    },
  };
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : "Unexpected error";
}

async function fetchEnv(authorizationCookie, projectName) {
  const normalizedProjectName = normalizeProjectName(projectName);

  if (!normalizedProjectName) {
    return {
      error: "Project name not found. Refresh the page and try again.",
    };
  }

  let fetchOptions;

  try {
    fetchOptions = createFetchOptions(authorizationCookie);
  } catch (error) {
    return { error: getErrorMessage(error) };
  }

  try {
    const response = await fetch(buildProjectApiUrl(normalizedProjectName), fetchOptions);

    if (!response.ok) {
      throw new Error(`Error: ${response.status} - ${response.statusText}`);
    }

    const projectData = await response.json();
    const encryptedEnvVars = Array.isArray(projectData.env)
      ? projectData.env
          .map((env) => ({
            id: env.id,
            key: env.key,
          }))
          .filter((env) => isNonEmptyString(env.id) && isNonEmptyString(env.key))
      : [];

    const envVars = [];

    for (const encryptedEnv of encryptedEnvVars) {
      const envResponse = await fetch(
        buildEnvApiUrl(normalizedProjectName, encryptedEnv.id),
        fetchOptions
      );

      if (!envResponse.ok) {
        throw new Error(`Error: ${envResponse.status} - ${envResponse.statusText}`);
      }

      const envData = await envResponse.json();

      if (!isNonEmptyString(envData?.key)) {
        continue;
      }

      envVars.push({
        key: envData.key,
        value: String(envData.value ?? ""),
      });
    }

    return { env: envVars };
  } catch (error) {
    return { error: getErrorMessage(error) };
  }
}

function formatEnvLine(env) {
  return `${env.key}=${env.value}`;
}

function copyAllEnv(envArray) {
  const envContent = envArray.map(formatEnvLine).join("\n");

  navigator.clipboard
    .writeText(envContent)
    .then(() => {
      alert("All ENV variables copied to clipboard!");
    })
    .catch(() => {
      alert("Failed to copy environment variables.");
    });
}

function downloadEnvFile(filename, envArray) {
  const envContent = envArray.map(formatEnvLine).join("\n");
  const blob = new Blob([envContent], { type: "text/plain" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();

  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

function removeExistingUI() {
  document.getElementById(EXPORT_CARD_ID)?.remove();
}

function insertUI(targetElement, uiElement) {
  removeExistingUI();
  targetElement.parentNode.insertBefore(uiElement, targetElement.nextSibling);
}

function initializeUI() {
  if (!isEnvironmentVariablesPage()) {
    removeExistingUI();
    return;
  }

  const targetElement = document.querySelector(TARGET_SELECTOR);

  if (!targetElement?.parentNode) {
    return;
  }

  const projectName = getProjectName();

  if (!projectName) {
    insertUI(
      targetElement,
      createUI(false, { error: "Project name not found. Refresh the page and try again." })
    );
    return;
  }

  const loadingUI = createUI(true);
  insertUI(targetElement, loadingUI);

  chrome.runtime.sendMessage({ text: "getAuthorization" }, (response) => {
    if (chrome.runtime.lastError) {
      loadingUI.replaceWith(
        createUI(false, { error: "Unable to retrieve authorization details." })
      );
      return;
    }

    if (response?.error) {
      loadingUI.replaceWith(createUI(false, { error: response.error }));
      return;
    }

    fetchEnv(response?.authorization, projectName).then((result) => {
      loadingUI.replaceWith(createUI(false, result));
    });
  });
}

function createButton(label, onClick) {
  const button = document.createElement("button");

  button.className =
    "button_base__BjwbK reset_reset__KRyvc button_button__81573 reset_reset__KRyvc button_secondary__kMMNc button_small__iQMBm button_invert__YNhnn";
  button.setAttribute("data-geist-button", "");
  button.setAttribute("data-version", "v1");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);

  return button;
}

function createLoadingIndicator() {
  const loadingDiv = document.createElement("div");
  loadingDiv.style.cssText =
    "display: flex; align-items: center; gap: 8px; color: var(--ds-gray-700);";

  const spinner = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  spinner.setAttribute("width", "16");
  spinner.setAttribute("height", "16");
  spinner.setAttribute("viewBox", "0 0 16 16");
  spinner.style.cssText = "animation: vercel-env-spin 1s linear infinite;";

  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "8");
  circle.setAttribute("cy", "8");
  circle.setAttribute("r", "7");
  circle.setAttribute("fill", "none");
  circle.setAttribute("stroke", "currentColor");
  circle.setAttribute("stroke-width", "2");
  circle.setAttribute("stroke-dasharray", "44");
  circle.setAttribute("stroke-dashoffset", "22");
  circle.setAttribute("stroke-linecap", "round");

  const style = document.createElement("style");
  style.textContent =
    "@keyframes vercel-env-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }";

  spinner.appendChild(circle);
  loadingDiv.appendChild(style);
  loadingDiv.appendChild(spinner);

  const loadingText = document.createElement("span");
  loadingText.textContent = "Loading environment variables...";
  loadingDiv.appendChild(loadingText);

  return loadingDiv;
}

function createUI(isLoading = true, result = null) {
  const cardContainer = document.createElement("div");
  cardContainer.id = EXPORT_CARD_ID;
  cardContainer.className = "geist-themed geist-default entity_form__ly2Cv geist-text p";
  cardContainer.setAttribute("type", "default");

  const headingContainer = document.createElement("div");
  headingContainer.className = "stack_stack__iZkUS stack";
  headingContainer.setAttribute("data-version", "v1");
  headingContainer.style.cssText =
    "--stack-flex: initial; --stack-direction: row; --stack-align: center; --stack-justify: flex-start; --stack-padding: 0px; --stack-gap: 8px;";

  const heading = document.createElement("h3");
  heading.className = "text_wrapper__i87JK";
  heading.setAttribute("data-version", "v1");
  heading.style.cssText =
    "--text-color: var(--ds-gray-1000); --text-size: 1rem; --text-line-height: 1.5rem; --text-letter-spacing: -0.020625rem; --text-weight: 600; padding-bottom: 8px;";
  heading.textContent = "Export Environment Variables";

  headingContainer.appendChild(heading);

  const stackDiv = document.createElement("div");
  stackDiv.className = "stack_stack__iZkUS stack";
  stackDiv.setAttribute("data-version", "v1");
  stackDiv.style.cssText =
    "--stack-flex: initial; --stack-direction: column; --stack-align: start; --stack-justify: flex-start; --stack-padding: 0px; --stack-gap: 12px;";

  if (isLoading) {
    stackDiv.appendChild(createLoadingIndicator());
  } else if (result?.error) {
    const errorDiv = document.createElement("div");
    errorDiv.style.cssText = "color: var(--ds-red-600); padding: 8px;";
    errorDiv.textContent = `Error: ${result.error}`;
    stackDiv.appendChild(errorDiv);
  } else if (result?.env) {
    const buttonContainer = document.createElement("div");
    buttonContainer.style.cssText = "display: flex; gap: 8px; justify-content: space-between;";

    buttonContainer.appendChild(createButton("Copy", () => copyAllEnv(result.env)));
    buttonContainer.appendChild(
      createButton(".env", () => downloadEnvFile(".env", result.env))
    );
    stackDiv.appendChild(buttonContainer);
  }

  cardContainer.appendChild(headingContainer);
  cardContainer.appendChild(stackDiv);

  return cardContainer;
}

initializeUI();

let lastUrl = location.href;
let initializeQueued = false;

function queueInitializeUI() {
  if (initializeQueued) {
    return;
  }

  initializeQueued = true;

  requestAnimationFrame(() => {
    initializeQueued = false;
    initializeUI();
  });
}

new MutationObserver(() => {
  const currentUrl = location.href;

  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    queueInitializeUI();
    return;
  }

  if (isEnvironmentVariablesPage()) {
    const targetElement = document.querySelector(TARGET_SELECTOR);

    if (targetElement && !document.getElementById(EXPORT_CARD_ID)) {
      queueInitializeUI();
    }
  }
}).observe(document, { subtree: true, childList: true });
