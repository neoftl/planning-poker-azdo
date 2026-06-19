# Azure DevOps Planning Poker
A zero-infrastructure extension to Azure DevOps to add Planning Poker estimation.

## Behaviour
- Adds an area to work items where each user can choose a fibonacci number from 0 to 21.
- Each user can choose and change their own value.
- When a user chooses a value, it is stored against the work item and other users can see that this user has selected a value, but not what the value is.
- Any user can then choose to "End voting", which replaces the options with the list of users and which values they chose. A comment is added to the work item with the results.
- Any user can choose to "Reset voting", which clears all votes and restores the options to choose from.

---

## Project structure

```
AzDO Poker/
  vss-extension.json   – Extension manifest (edit publisher here)
  package.json         – npm scripts and dependencies
  tsconfig.json        – TypeScript config
  webpack.config.js    – Bundles TypeScript + CSS → dist/
  images/
    poker-icon.svg     – Extension icon
  src/
    poker.html         – HTML template (webpack input)
    poker.ts           – All extension logic
    poker.css          – Styles (injected at runtime)
  dist/                – Build output (git-ignored)
  releases/            – Packaged .vsix files (git-ignored)
```

## Prerequisites

| Tool | Install |
|------|---------|
| Node.js 18+ | https://nodejs.org |
| tfx-cli | `npm install -g tfx-cli` |
| Azure DevOps publisher account | https://marketplace.visualstudio.com/manage |

## One-time setup

1. **Create a publisher** at https://marketplace.visualstudio.com/manage if you don't have one.
2. Edit `vss-extension.json` and replace `YOUR-PUBLISHER-ID` with your publisher ID.

## Build and package

```powershell
cd "AzDO Poker"
npm install          # install dependencies
npm run package      # build + create releases/planning-poker-<version>.vsix
```

The `.vsix` file is placed in the `releases/` folder.

## Install on your Azure DevOps organisation

### Option A – Private (recommended for POC)

1. Go to **https://marketplace.visualstudio.com/manage** → your publisher.
2. Click **New extension → Azure DevOps**.
3. Upload the generated `.vsix` file.
4. After upload, click **Share** and share it with your Azure DevOps organisation.
5. In your Azure DevOps organisation go to  
   **Organisation Settings → Extensions → Shared** and install it.

### Option B – Direct upload via tfx-cli

```powershell
# Publish (requires a Personal Access Token with Marketplace:Manage scope)
tfx extension publish --manifest-globs vss-extension.json --token <YOUR-PAT>

# Then share with your organisation
tfx extension share --publisher YOUR-PUBLISHER-ID --extension-id planning-poker --share-with YOUR-ORG
```

## How votes are stored

Votes are stored in the Azure DevOps **Extension Data Service** (key-value store
built into every AzDO organisation) — no database, no backend required.

Each work item gets its own document keyed by work-item ID.  
When a user selects a card the value is written immediately, but the UI only
reveals values to all participants when someone clicks **End Voting**.  
Clicking **End Voting** also posts the results as a work-item comment.

> **Note:** Because storage is collection-scoped, technically all users could
> read raw data via the API. The hiding is UI-side only. For a trusted team
> this is sufficient for a POC.

## Development (live reload)

```powershell
npm run build:dev    # watch mode — rebuilds on every file change
```

Use the [Azure DevOps Extension Hot Reload and Debug](https://github.com/nickyonge/azure-devops-extension-hot-reload-and-debug)
tool to load `dist/poker.html` from localhost during development.
