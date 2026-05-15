# Agent Tokenomics MFE End-to-End Test Guide

This guide covers the practical end-to-end checks for the DefenseClaw Agent
Tokenomics MFE. It is meant for local demo validation, handoff zip validation,
and staging smoke tests before sharing the app broadly.

## What to Validate

An E2E pass should prove that:

- The tokenomics fixture API or live tokenomics BFF is reachable.
- The MFE loads at `/?view=tokenomics`.
- The page renders the Summary, Table, and Agent Details views.
- Agent rows can route into the Agent Details view.
- The agent details drawer opens from the details view.
- The Module Federation remote exposes the expected app modules.

## Prerequisites

- Node.js 18 or newer.
- npm.
- Cisco VPN only when installing Cisco Design System packages from Artifactory
  or testing Cisco Platform staging.
- `ARTIFACTORY_CLOUD_AUTH` only for source-based local testing that needs
  `npm install`.

Do not commit Artifactory tokens, CUI bearer tokens, Splunk credentials, O11y
tokens, or external API keys into this repo.

## Fast Local E2E With Source

Use this path when you are changing code and want the dev server.

```bash
export ARTIFACTORY_CLOUD_AUTH="<your-devhub-artifactory-token>"
./run-tokenomics-demo.sh
```

The script starts:

- fixture API: `http://127.0.0.1:8787`
- MFE: `http://127.0.0.1:3001/?view=tokenomics`

Health check:

```bash
curl http://127.0.0.1:8787/healthz
curl 'http://127.0.0.1:8787/v1/c3/agent-tokenomics/summary'
```

Expected API signal:

- `status` is `ok` from `/healthz`.
- The summary response contains `summary`, `top_agents`, `token_mix`,
  `detail rows from the tokenomics summary API`, and `debug.fixture_backed: true`.

## Browser Walkthrough

Open:

```text
http://127.0.0.1:3001/?view=tokenomics
```

Validate the Summary view:

- Header starts with `Agent Tokenomics`.
- KPI cards show total tokens, agent sessions, cost, and active agent count.
- Token usage/cost charts render.
- Quality and eval cards render.
- Agents Overview appears directly under the quality/eval charts.
- Tokenomics details appears as the final section with a simple details table.

Validate navigation:

- Open the Table view.
- Click an agent name in the table.
- Confirm the app lands on the Agent Details details view.
- Confirm the selected agent is reflected in the map context.
- Open the agent flyout/details drawer from the details view.
- Confirm the drawer shows trace IDs, token breakdown, tool usage, and token usage and quality context.

Validate fallbacks:

- Stop the fixture API and reload the page.
- The app should remain usable with synthetic fallback data instead of showing a
  blank page.
- Restart the fixture API before continuing.

## Automated Checks

Run:

```bash
npm test
```

This currently verifies:

- O11y backend request construction for the inherited O11y POC path.
- Sandbox build generation.
- `remoteEntry.js` exposes the expected Module Federation container and modules.

The sandbox build test writes to `.tmp/sandbox-dist` and leaves `dist/`
untouched.

## Prebuilt Handoff E2E

Use this path for reviewers who should not need Artifactory access or
`npm install`.

The prebuilt package must include:

- `dist/`
- `fixtures/tokenomics-summary-runtime-governance.json`
- `scripts/serve-prebuilt-tokenomics-demo.js`
- `run-prebuilt-tokenomics-demo.sh`
- `PREBUILT_DEMO_README.md`

Run:

```bash
./run-prebuilt-tokenomics-demo.sh
```

Then open:

```text
http://127.0.0.1:3001/?view=tokenomics
```

This starts the prebuilt static MFE and fixture API from a single Node process.
It does not install dependencies.

## Live Tokenomics API E2E

Use this path when a real tokenomics BFF is available.

```bash
TOKENOMICS_API_URL="https://<tokenomics-bff>/v1/c3/agent-tokenomics/summary" \
TOKENOMICS_TENANT_ID="<tenant-id>" \
npm start -- --host 127.0.0.1 --port 3001
```

Expected behavior:

- The browser sends the Cloud Control CUI bearer token when available in browser
  storage.
- The browser sends `X-C3-Tenant` using `TOKENOMICS_TENANT_ID`.
- The MFE renders whatever summary shape the BFF returns.
- If the BFF response has `debug.fixture_backed: true`, the page labels the data
  as fixture-backed API data.
- If the BFF fails, the page falls back to synthetic demo data.

Minimum response fields:

- `summary.total_tokens`
- `summary.session_count`
- `summary.request_count`
- `summary.cost`
- `top_agents`
- `top_models`
- `token_mix`
- `detail rows from the tokenomics summary API`
- `recommendations`

## Staging Smoke Test

After publishing a bundle to Cisco Platform staging, open the Developer Sandbox
URL for the surface:

```text
https://staging.cloud.cisco.com/developer-sandbox/bd0da223-80b8-4d93-9bbc-3bdcd3023464
```

Validate:

- The remote loads without `failed to load` errors.
- The tokenomics view can be opened.
- Summary, Table, and Agent Details views all render.
- Agent-to-map navigation works.
- The details drawer opens.
- Browser console has no fatal Module Federation errors.

If Chrome fails but Safari works, retry Chrome after clearing the staging tab's
site data or using a fresh profile. A stale remote entry or cached auth state can
make the staging shell report that the remote is not reachable even when the
artifact is healthy.

## Build and Remote Verification

For a production-style build:

```bash
SURFACE_ID="<surface-id>" \
TOKENOMICS_API_URL="https://<tokenomics-bff>/v1/c3/agent-tokenomics/summary" \
TOKENOMICS_TENANT_ID="<tenant-id>" \
npm run build
```

Verify the generated remote:

```bash
SURFACE_ID="<surface-id>" node scripts/verify-remote-entry.js
```

Package for upload:

```bash
cd dist
zip -r ../bundle.zip .
cd ..
```

## Common Failures

`Cannot find module webpack-dev-server`

Run `./run-tokenomics-demo.sh` without `sudo` and let it install dependencies
with `ARTIFACTORY_CLOUD_AUTH` set. For reviewers without Artifactory access, use
the prebuilt handoff package instead.

`ARTIFACTORY_CLOUD_AUTH is required`

The source-based dev server needs Cisco Design System packages. Either export
the token or use the prebuilt package.

`mfe_<id> failed to load`

Confirm the bundle was built with the same `SURFACE_ID` as the staging surface
and that `remoteEntry.js` is present in the uploaded artifact.

Fixture API works but UI shows synthetic data

Confirm `TOKENOMICS_API_URL` points to:

```text
http://127.0.0.1:8787/v1/c3/agent-tokenomics/summary
```

Then reload the MFE.

## Done Criteria

Before sharing the MFE with another team, confirm:

- `npm test` passes.
- Source or prebuilt local E2E works.
- Summary, Table, and Agent Details views render.
- Table agent click lands on Agent Details.
- Agent details drawer opens from details view.
- The data status badge matches the tested mode: live aggregate API,
  fixture-backed API, synthetic fallback, or synthetic demo data.
