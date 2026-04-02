# Vercel Env Variables

Chrome extension for exporting environment variables from a Vercel project page in one step.

![Promo tile](./assets/store_images/Promo%20Tile.png)

## Overview

Vercel's dashboard makes it easy to manage project variables, but exporting them all at once can still be tedious. This extension adds a small export panel directly to the Vercel project interface so you can:

- copy all variables to your clipboard
- download them as a `.env` file
- avoid manually copying each key/value pair one by one

The extension is designed for developers who already manage projects in Vercel and want a faster way to move environment variables into a local development setup.

## Features

- Injects an export UI into Vercel project pages
- Reads the current project's environment variables from Vercel
- Supports one-click copy to clipboard
- Supports one-click `.env` file download
- Shows loading and error states in the page UI
- Works inside the existing Vercel dashboard flow

## How it works

The extension is built as a Manifest V3 Chrome extension with three main parts:

### 1. Background service worker

`background.js` reads the Vercel `authorization` cookie and returns it to the content script when requested.

### 2. Content script

`scripts/content.js` runs on `https://vercel.com/*` pages. It:

- detects the current project name from the Vercel UI
- requests the authorization token from the background script
- calls Vercel project APIs to retrieve environment variables
- renders the export card into the dashboard
- lets the user copy or download the result

### 3. Popup

`popup/popup.html` provides a simple extension popup with a short description and a link to the repository.

## Permissions

The extension requests only the permissions it needs:

- `cookies`: used to read the Vercel authorization cookie
- `host_permissions` for `*://vercel.com/*`: used to run on Vercel pages and call Vercel endpoints

See `manifest.json` for the complete configuration.

## Installation

### Install from source

1. Clone or download this repository.
2. Open Chrome or another Chromium-based browser.
3. Go to `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the repository folder you cloned locally.

## Usage

1. Log in to your Vercel account in the browser where the extension is installed.
2. Open a Vercel project.
3. Navigate to the project's environment variables page.
4. Wait for the **Export Environment Variables** card to appear.
5. Choose one of the available actions:
   - **Copy**: copies all variables in `KEY=value` format
   - **.env**: downloads the variables as a `.env` file

## Example output

Downloaded or copied variables use standard `.env` formatting:

```dotenv
DATABASE_URL=postgres://example
NEXT_PUBLIC_API_URL=https://api.example.com
VERCEL_TOKEN=example-token
```

## Project structure

```text
vercel-env-variables/
├── assets/
│   ├── icons/
│   └── store_images/
├── popup/
│   ├── assets/
│   └── popup.html
├── scripts/
│   └── content.js
├── background.js
├── manifest.json
└── README.md
```

## Development notes

- This repository is a plain Chrome extension project with no build step.
- Load the repository directly as an unpacked extension while developing.
- Changes to extension files usually require reloading the extension in `chrome://extensions`.

## Limitations

- The extension depends on Vercel's current dashboard structure and selectors.
- It works only when you are authenticated in Vercel.
- It is intended for Vercel pages and does not run outside `vercel.com`.
- If Vercel changes its internal API responses or page layout, the export UI may need to be updated.

## Privacy and security

- The extension reads the Vercel authorization cookie only to request project environment variables.
- Exported values are copied to your clipboard or downloaded locally in your browser.
- No backend service is included in this repository.

Review the source before installing if you plan to use it in sensitive environments.

## Design

- [View the design in Figma](https://www.figma.com/design/HEUaSGIRA1Zm8v1QPnZp0j/VercelEnv?node-id=0-1&t=bzm7XtbQChFEBZon-1)

## License

This project is licensed under the terms of the [LICENSE](./LICENSE) file.
