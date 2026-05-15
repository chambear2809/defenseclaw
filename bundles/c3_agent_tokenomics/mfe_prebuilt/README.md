# DefenseClaw Agent Tokenomics MFE

A Cisco Cloud Control micro-frontend (MFE) for the DefenseClaw / Agent Watch
tokenomics demo. The dashboard shows which agents, models, tools, and sessions
are driving token consumption, then connects that cost-pressure view to spend, trend, and top-consumer details.

This repo was forked from the C3 MFE POC, so it still includes the original
Splunk Observability impact dashboard and backend proxy. The DefenseClaw
tokenomics view is the primary demo surface for this repo.

The tokenomics view can use a C3 tokenomics summary API directly when
`TOKENOMICS_API_URL` is configured. If the API is not configured or cannot be
reached, it falls back to demo-safe mock data so the MFE remains usable for
rehearsal.

The MFE does not call Splunk O11y or tokenomics services directly from the browser. It only
renders the C3 tokenomics summary API/BFF response. That API can be backed by
fixture data for demo development or by live O11y SignalFlow/token metrics once
the DefenseClaw telemetry path is validated.

Current caveat: the API endpoint tested for the demo returns fresh API responses,
but the payload marks itself as `fixture_backed: true`. That means the MFE is
API-backed, but the backend is still serving fixture/demo data until the
tokenomics API is switched to fully live telemetry.

## What It Shows

- Total tokens, agent sessions, tool tokens, and optimization candidates.
- Token mix across input, output, cached, reasoning, and tool tokens.
- Top agents/connectors by token usage.
- Top models by token usage.
- Top tools or targets by token usage.
- Optimization recommendations.
- Simple tokenomics detail tables for top agents, models, spend, and token mix.
- An **Agent Details** tab inspired by the O11y agent Figma, including an
  agent map, simple detail cards, quality metrics, and performance /
  latency / error views.
- Agent details open in a right-side drawer with trace summary, token breakdown,
  session trace IDs, tool usage, and details timeline context.

## Architecture

- **Frontend**: React 19 MFE using Webpack 5 Module Federation
- **Tokenomics data source**: C3 tokenomics summary API, configured through
  `TOKENOMICS_API_URL`
- **Fallback data source**: local mock dashboard data in
  `src/DefenseClawTokenomics.jsx`
- **Optional inherited backend**: Express BFF on port 8080 for the original O11y
  impact dashboard
- **Platform**: Deployed to Cisco Platform Cloud Control (staging)

Expected tokenomics flow:

```text
DefenseClaw / Agent activity
        |
        v
O11y / OTel GenAI token telemetry + tokenomics detail data
        |
        v
C3 tokenomics summary API
        |
        v
DefenseClaw Agent Tokenomics MFE in Cloud Control
```

## Project Structure

```
├── src/
│   ├── App.jsx              # View switcher plus original O11y dashboard
│   ├── DefenseClawTokenomics.jsx # Agent tokenomics demo dashboard
│   ├── MFEErrorBoundary.jsx # Error boundary wrapper
│   ├── bootstrap.js         # Async bootstrap for Module Federation
│   ├── index.js             # Entry point
├── backend/
│   ├── Dockerfile           # Backend container image
│   ├── package.json
│   └── src/server.js        # Express token exchange and O11y API proxy
├── public/
│   └── index.html           # HTML template
├── webpack.config.js        # Webpack + Module Federation config
└── package.json
```

## Local Development

This MFE uses Cisco Design System packages from the Cisco DevHub Artifactory
npm registry. Before installing dependencies, export your Artifactory identity
token:

```bash
export ARTIFACTORY_CLOUD_AUTH="<your-devhub-artifactory-token>"
```

If you do not already have this token, generate or copy it from DevHub/JFrog
Artifactory for the `magnetic-common-npm` registry, then keep it in your shell
environment only. Do not commit it into this repo.

```bash
./run-tokenomics-demo.sh
```

The script installs dependencies with a temporary npm config, starts the
fixture API, and launches the tokenomics MFE at
http://127.0.0.1:3001/?view=tokenomics.

For manual setup, use a temporary npm config that points only the Cisco Design
System scope at Artifactory:

```bash
cat >/tmp/c3-mfe-npmrc <<'NPMRC'
@ciscodesignsystems:registry=https://artifactory.devhub-cloud.cisco.com/artifactory/api/npm/magnetic-common-npm/
//artifactory.devhub-cloud.cisco.com/artifactory/api/npm/magnetic-common-npm/:_authToken=${ARTIFACTORY_CLOUD_AUTH}
//artifactory.devhub-cloud.cisco.com/artifactory/api/npm/magnetic-common-npm/:always-auth=true
registry=https://registry.npmjs.org/
NPMRC

npm install --userconfig=/tmp/c3-mfe-npmrc --package-lock=false --ignore-scripts --no-audit --no-fund
npm start
```

Runs at http://localhost:3001 and serves the Developer Sandbox remote at
http://localhost:3001/remoteEntry.js.

Open the tokenomics view directly with:

```bash
open "http://localhost:3001/?view=tokenomics"
```

By default, the dev server uses the staging MFE surface ID
`bd0da223-80b8-4d93-9bbc-3bdcd3023464`, so Cloud Control looks for the container
`mfe_bd0da223_80b8_4d93_9bbc_3bdcd3023464`. Override `SURFACE_ID` only when
testing another surface:

```bash
SURFACE_ID=<other-surface-id> npm start
```

For local live-data testing, start the backend and point the frontend at it:

```bash
PORT=18080 node backend/src/server.js
BACKEND_URL=http://localhost:18080 npm start
```

For the DefenseClaw tokenomics view, set `TOKENOMICS_API_URL` if you need to
load live tokenomics data. The MFE appends the current `window`,
`environment`, `service`, and `agent` filters, sends `X-C3-Tenant` using
`TOKENOMICS_TENANT_ID`, and reuses the Cloud Control CUI bearer token discovered
by the forked O11y MFE shell when that token is present in browser storage:

```bash
TOKENOMICS_API_URL="http://<tokenomics-host>:8010/v1/c3/agent-tokenomics/summary" \
TOKENOMICS_TENANT_ID="c3-demo-tenant" \
npm start
```

This keeps the live C3 path aligned with the existing O11y MFE auth pattern:
Cloud Control provides the CUI token, the browser sends it to the tokenomics
summary API, and the BFF owns any downstream token exchange.

For demo rehearsal without live O11y credentials, run the bundled synthetic
tokenomics fixture API in one terminal:

```bash
npm run serve:tokenomics-fixture
```

Then start the MFE against it in another terminal:

```bash
TOKENOMICS_API_URL="http://127.0.0.1:8787/v1/c3/agent-tokenomics/summary" \
TOKENOMICS_TENANT_ID="c3-demo-tenant" \
npm start
```

The fixture is stored in `fixtures/tokenomics-summary-runtime-governance.json`. It is
based on the Webex PR bundle and includes token totals, token mix, top
agents/models, and detail rows. The MFE will label this
mode as **Fixture-backed API** so it is clear that the page is API-backed but
not claiming live O11y telemetry.

The tokenomics view intentionally does not require Splunk or O11y
credentials in the browser. The demo API should be CORS-enabled and expose a
summary shape only. The local fixture accepts unauthenticated requests for demo
rehearsal, but a live tokenomics API can require the Cloud Control CUI bearer
token. If `TOKENOMICS_API_URL` is unset or cannot be reached, the view renders
the mock dashboard so the Cloud Control surface is still usable for demo
rehearsal.

### Data Source Status

The dashboard now shows the active data mode in the page:

- **Live aggregate API**: the MFE successfully loaded data from
  `TOKENOMICS_API_URL`.
- **Fixture-backed API**: the MFE successfully loaded the API, but the API
  reported `debug.fixture_backed: true`.
- **Synthetic fallback**: the configured API failed, so the MFE rendered local
  demo-safe data.
- **Synthetic demo data**: `TOKENOMICS_API_URL` was not configured.

Answering the current Webex question directly: data is flowing into the MFE only
through the summary API. Traces can be present in Splunk O11y while the APM AI /
tokenomics fields still need instrumentation or configuration validation. Once
the BFF is switched from fixture mode to live SignalFlow reads over
`gen_ai.client.token.usage` and the related agent/model/provider dimensions, the
same MFE should render that live aggregate response without another frontend
change.

For the current demo endpoint, the health check should return `{"status":"ok"}`:

```bash
curl "http://<tokenomics-host>:8787/healthz"
```

The summary API should return fields like:

- `summary.total_tokens`
- `summary.input_tokens`
- `summary.output_tokens`
- `summary.active_agents`
- `summary.request_count`
- `summary.cost.total`, `summary.cost.input`, `summary.cost.output`, and
  `summary.cost.pricing_status`
- `token_mix`
- `top_agents`
- `top_models`
- `detail rows from the tokenomics summary API`
- `recommendations`
- `debug.fixture_backed`

Do not commit bearer tokens, Splunk credentials, or API keys into this repo. The
tokenomics demo endpoint used here is expected to expose only the summary data
needed by the browser MFE.

### Agent Details Design Notes

The tokenomics page now has two primary tabs:

- **Command view**: the original cost, token, and quality
  dashboard.
- **Agent Details**: a simple details surface based on the O11y
  agent-map Figma direction. It shows a multi-agent flow, issue counts by agent,
  clickable trace drilldowns, quality metrics, and performance/error
  context.

Clicking **Open top agent** or any trace drilldown card opens the agent details
drawer. The drawer is intentionally local-demo friendly: it uses trace IDs and
summary fields from the API/fixture when present, and falls back to deterministic
demo-safe rows when the live trace backend is not connected yet.

## Original O11y POC View

The MFE looks for the Cloud Control CUI token in browser storage under
`accessToken` and related CUI token keys. It does not include a manual token
entry field; without a browser-provided token the dashboard remains empty until
Cloud Control authentication completes.

TLS verification is enabled by default for upstream token and O11y calls. For a
local-only staging debug run that needs the old `curl -k` behavior, start the
backend with `O11Y_ALLOW_INSECURE_TLS=true`.

When a token is present but live loading fails, the dashboard shows an explicit
live-data error and zero rows instead of silently showing sample data.
When live O11y rows include a source service, row labels open the matching
Splunk Observability APM service view in a new tab. The generated links use the
active O11y org URL, service name, environment, and metric time window from the
backend response.

## Production Build

```bash
SURFACE_ID=<your-surface-id> npm run build
```

The `SURFACE_ID` env var sets the Module Federation container name to `mfe_<surface_id_with_underscores>`.
Production builds require `SURFACE_ID` so release artifacts cannot silently use
the staging MFE surface ID.

## Verify Remote Entry

```bash
npm test
```

This builds the MFE into `.tmp/sandbox-dist` and verifies that `remoteEntry.js`
exposes the expected Developer Sandbox container, `./App`, and
`./DefenseClawTokenomics` modules. It leaves `dist/` untouched so a release
build is not replaced by a test build.

For the full local, prebuilt handoff, live API, and staging walkthrough, see
the [Agent Tokenomics MFE End-to-End Test Guide](docs/tokenomics-e2e-testing.md).

To build the staging sandbox remote into `.tmp/sandbox-dist` without verifying:

```bash
npm run build:sandbox
```

To verify an existing `dist/` artifact for another surface:

```bash
SURFACE_ID=<surface-id> node scripts/verify-remote-entry.js
```

The Module Federation container exposes both:

- `./App` for the original O11y impact dashboard.
- `./DefenseClawTokenomics` for the DefenseClaw Agent Tokenomics dashboard.

## Packaging for Cisco Platform

```bash
SURFACE_ID=<surface-id> npm run build
cd dist && zip -r ../bundle.zip . && cd ..
tar czf source.tgz --exclude=node_modules --exclude=dist --exclude=bundle.zip --exclude=source.tgz --exclude=.git .
```

Set `BACKEND_URL` to the deployed backend surface URL when building a live-data
O11y artifact. For the tokenomics view, set `TOKENOMICS_API_URL` when building
the frontend artifact. Upload `bundle.zip` through the Cisco Platform Hosting
API.

### Cisco Bootstrap Handoff

Jacob pointed us at [bootstrap.platform.cisco.com](https://bootstrap.platform.cisco.com/)
as the preferred one-shot prompt path from Cisco VPN. Use that flow when you
want a harness or agent to upload the built MFE artifact and wire it into a
tenant context instead of manually driving Platform Hosting.

Before using the bootstrap flow, build the same artifact you would publish
manually:

```bash
SURFACE_ID=<surface-id> \
TOKENOMICS_API_URL="https://<tokenomics-bff>/v1/c3/agent-tokenomics/summary" \
TOKENOMICS_TENANT_ID="<tenant-id>" \
npm run build

cd dist && zip -r ../bundle.zip . && cd ..
```

The live tokenomics API should accept the Cloud Control CUI bearer token that
the MFE now sends on API requests. The local fixture remains unauthenticated for
demo rehearsal.

## Key IDs (Staging)

| Resource | ID |
|---|---|
| App | `8f6dd7e5-93aa-473e-8c11-5ac300b20e2d` |
| MFE Surface | `bd0da223-80b8-4d93-9bbc-3bdcd3023464` |
| Backend Surface | `91474c0b-4ed3-4857-b6dd-165dd73b01ea` |
| Developer Sandbox | `https://staging.cloud.cisco.com/developer-sandbox/bd0da223-80b8-4d93-9bbc-3bdcd3023464` |
