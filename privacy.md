# Privacy Policy — Planning Poker for Azure DevOps

**Last updated: June 2026**

## What data is collected

Planning Poker stores only the data needed to run an estimation session:

- **Work item ID** — used as the key for the session document
- **User display name and identity ID** — sourced from the Azure DevOps SDK at runtime; used to associate a vote with the person who cast it
- **Vote value** — the card selected by the user (e.g. `5`, `8`, `?`)

No telemetry, analytics, or tracking of any kind is collected.

## Where data is stored

All session data is written to the **Azure DevOps Extension Data Service** — a built-in storage facility provided by Microsoft as part of every Azure DevOps organisation. Data never leaves your Azure DevOps instance and is never sent to any third-party server.

## Who can access the data

Session documents are stored at collection scope within the Extension Data Service. Any user with permissions to query extension data in your collection can read the raw documents via the Azure DevOps REST API. Vote values are hidden in the UI until "End Voting" is clicked, but this concealment is enforced client-side only.

## Data retention

Session data persists until a "New Round" is started, which overwrites the document with an empty session. There is no automatic expiry.

## Contact

If you have questions about privacy, open an issue in the extension repository or contact your Azure DevOps collection administrator.
