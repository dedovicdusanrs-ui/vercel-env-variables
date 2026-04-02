const PROJECT_NAME_SELECTOR =
  "body > div.bg-background-200.min-h-vh.relative > header > nav > ul > li:nth-child(2) > div > a > p";
const TARGET_ELEMENT_SELECTOR =
  "#environment-variables-fieldset > span:nth-child(5)";
const EXTENSION_UI_ID = "vercel-env-variables-export-card";
const STATUS_MESSAGE_DURATION_MS = 2500;
const NAVIGATION_RENDER_DELAY_MS = 1000;
let latestInitializationId = 0;
let navigationTimeoutId = null;

function getProjectName() {
  return document.querySelector(PROJECT_NAME_SELECTOR)?.textContent?.trim() || "";
}

function requestEnvironmentVariables(projectName) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "FETCH_ENV_VARIABLES", projectName },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            error:
              chrome.runtime.lastError.message ||
              "Failed to contact the extension background worker.",
          });
          return;
        }

        resolve(
          response && typeof response === "object"
            ? response
            : { error: "The background worker returned an invalid response." }
        );
      }
    );
  });
}

function copyAllEnv(envArray) {
  const envContent = envArray.map((env) => `${env.key}=${env.value}`).join("\n");

  navigator.clipboard
    .writeText(envContent)
    .then(() => {
      showStatusMessage("Environment variables copied successfully.");
    })
    .catch((error) => {
      console.error("Failed to copy environment variables:", error);
      showStatusMessage("Failed to copy environment variables.", true);
    });
}

function downloadEnvFile(filename, envArray) {
  const envContent = envArray.map((env) => `${env.key}=${env.value}`).join("\n");
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

function showStatusMessage(message, isError = false) {
  const existingMessage = document.getElementById(`${EXTENSION_UI_ID}-status`);

  if (existingMessage) {
    existingMessage.remove();
  }

  const status = document.createElement("p");
  status.id = `${EXTENSION_UI_ID}-status`;
  status.textContent = message;
  status.style.cssText = `font-size: 12px; color: ${
    isError ? "var(--ds-red-600)" : "var(--ds-green-700)"
  };`;

  const container = document.getElementById(EXTENSION_UI_ID);
  container?.appendChild(status);

  setTimeout(() => {
    status.remove();
  }, STATUS_MESSAGE_DURATION_MS);
}

async function initializeUI() {
  const requestId = ++latestInitializationId;
  const targetElement = document.querySelector(TARGET_ELEMENT_SELECTOR);

  if (!targetElement?.parentNode) {
    return;
  }

  document.getElementById(EXTENSION_UI_ID)?.remove();

  const projectName = getProjectName();

  if (!projectName) {
    const errorUI = createUI({ error: "Project name not found. Please refresh the page." });
    targetElement.parentNode.insertBefore(errorUI, targetElement.nextSibling);
    return;
  }

  const loadingUI = createUI({ isLoading: true });
  targetElement.parentNode.insertBefore(loadingUI, targetElement.nextSibling);

  const result = await requestEnvironmentVariables(projectName);

  if (requestId !== latestInitializationId) {
    return;
  }

  loadingUI.replaceWith(createUI(result));
}

function createActionButton(label, iconPathMarkup, onClick) {
  const button = document.createElement("button");
  button.className =
    "button_base__BjwbK reset_reset__KRyvc button_button__81573 reset_reset__KRyvc button_secondary__kMMNc button_small__iQMBm button_invert__YNhnn";
  button.setAttribute("data-geist-button", "");
  button.setAttribute("data-prefix", "true");
  button.setAttribute("data-suffix", "false");
  button.setAttribute("data-version", "v1");
  button.style.setProperty("--geist-icon-size", "16px");
  button.innerHTML = `<span class="button_prefix__2XlwH">${iconPathMarkup}</span><span class="button_content__1aE1_">${label}</span>`;
  button.addEventListener("click", onClick);

  return button;
}

function createUI(result = {}) {
  const isLoading = result.isLoading === true;
  const container = document.createElement("div");
  container.id = EXTENSION_UI_ID;

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

  const cardContainer = document.createElement("div");
  cardContainer.className = "geist-themed geist-default entity_form__ly2Cv geist-text p";
  cardContainer.setAttribute("type", "default");

  const stackDiv = document.createElement("div");
  stackDiv.className = "stack_stack__iZkUS stack";
  stackDiv.setAttribute("data-version", "v1");
  stackDiv.style.cssText =
    "--stack-flex: initial; --stack-direction: column; --stack-align: start; --stack-justify: flex-start; --stack-padding: 0px; --stack-gap: 12px;";

  if (isLoading) {
    const loadingDiv = document.createElement("div");
    loadingDiv.style.cssText =
      "display: flex; align-items: center; gap: 8px; color: var(--ds-gray-700);";
    loadingDiv.innerHTML = `
      <style>
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .spinner {
          animation: spin 1s linear infinite;
          transform-origin: center;
        }
      </style>
      <svg class="spinner" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="2" stroke-dasharray="44" stroke-dashoffset="22" stroke-linecap="round"/>
      </svg>
      <span>Loading environment variables...</span>
    `;
    stackDiv.appendChild(loadingDiv);
  } else if (result.error) {
    const errorDiv = document.createElement("div");
    errorDiv.style.cssText = "color: var(--ds-red-600); padding: 8px;";
    errorDiv.textContent = `Error: ${result.error}`;
    stackDiv.appendChild(errorDiv);
  } else if (Array.isArray(result.env) && result.env.length === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.style.cssText = "color: var(--ds-gray-700); padding: 8px;";
    emptyDiv.textContent = "No environment variables were found for this project.";
    stackDiv.appendChild(emptyDiv);
  } else if (Array.isArray(result.env)) {
    const buttonContainer = document.createElement("div");
    buttonContainer.style.cssText = "display: flex; gap: 8px; justify-content: space-between;";

    const copyButton = createActionButton(
      "Copy",
      `<svg data-testid="geist-icon" height="16" stroke-linejoin="round" viewBox="0 0 16 16" width="16" style="color: currentcolor;">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M14.5 13.5V6.5V5.41421C14.5 5.149 14.3946 4.89464 14.2071 4.70711L9.79289 0.292893C9.60536 0.105357 9.351 0 9.08579 0H8H3H1.5V1.5V13.5C1.5 14.8807 2.61929 16 4 16H12C13.3807 16 14.5 14.8807 14.5 13.5ZM13 13.5V6.5H9.5H8V5V1.5H3V13.5C3 14.0523 3.44772 14.5 4 14.5H12C12.5523 14.5 13 14.0523 13 13.5ZM9.5 5V2.12132L12.3787 5H9.5ZM5.13 5.00062H4.505V6.25062H5.13H6H6.625V5.00062H6H5.13ZM4.505 8H5.13H11H11.625V9.25H11H5.13H4.505V8ZM5.13 11H4.505V12.25H5.13H11H11.625V11H11H5.13Z" fill="currentColor"></path>
      </svg>`,
      () => copyAllEnv(result.env)
    );

    const downloadButton = createActionButton(
      ".env",
      `<svg data-testid="geist-icon" height="16" stroke-linejoin="round" viewBox="0 0 16 16" width="16" style="color: currentcolor;">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M8 12L3 7l1.4-1.4L7 8.2V1h2v7.2l2.6-2.6L13 7l-5 5zm-6 2h12v-2H2v2z" fill="currentColor"></path>
      </svg>`,
      () => downloadEnvFile(".env", result.env)
    );

    buttonContainer.appendChild(copyButton);
    buttonContainer.appendChild(downloadButton);
    stackDiv.appendChild(buttonContainer);
  }

  cardContainer.appendChild(headingContainer);
  cardContainer.appendChild(stackDiv);
  container.appendChild(cardContainer);

  return container;
}

initializeUI();

let lastUrl = location.href;
new MutationObserver(() => {
  const currentUrl = location.href;

  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    clearTimeout(navigationTimeoutId);
    navigationTimeoutId = setTimeout(() => {
      initializeUI();
    }, NAVIGATION_RENDER_DELAY_MS);
  }
}).observe(document, { subtree: true, childList: true });
