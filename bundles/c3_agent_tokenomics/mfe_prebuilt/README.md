# Deskside AI Resilience MFE

A Cisco Cloud Control micro-frontend (MFE) named Deskside AI Resilience for AMD
Deskside fleet tokenomics and Agent Control. Each Deskside can run multiple
employee or task agents; DefenseClaw is modeled separately as the resident
enforcement and telemetry agent on the box.

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

The EKS demo BFF reads DefenseClaw's live budget ledger and reports
`fixture_backed: false`. Local rehearsal remains fixture-backed unless the
prebuilt runner is given `TOKENOMICS_BFF_URL`.

The prebuilt shell exposes `/fleet`, `/agent-behavior`, `/budgets`,
`/infrastructure`, `/agent-controls`, `/policy-studio`, and `/network-security`. The fleet
inventory and Cisco ISE/Catalyst acknowledgement
chain are explicitly simulated; the Tokenomics ledger and the current pilot
Deskside controls can be backed by live DefenseClaw data. Local mutable rehearsal
state resets when the runner restarts.

## What It Shows

- Total tokens, agent sessions, tool tokens, and optimization candidates.
- Token mix across input, output, cached, reasoning, and tool tokens.
- Top agents/connectors by token usage.
- Top models by token usage.
- Top tools or targets by token usage.
- Optimization recommendations.
- Adoption, Cost, and Budget tabs modeled after an enterprise AI Usage workspace.
- Clearly labeled modeled provider adoption, department heatmap, model-level
  daily cost trend, cost breakdown, and searchable usage detail data.
- An API-sourced organization projection whose seven-day modeled non-Halo
  tokens/cost and annualization factor are auditable in
  `cost.organization_projection`; agent filters exclude this unattributed overlay.
- An in-page budget workspace for per-agent token and cost thresholds plus the
  budget breach feed.
- An AMD Ryzen AI Halo + Cisco C9550 core / C9350 access reference topology.
- A clearly labeled demo Lemonade semantic-routing comparison.
- Agent Controls for the 100K chat hard stop, exact command approvals, and a
  capability-level baseline preview with advanced exact-name scan exceptions.
- Policy Studio for translating natural-language security and trust intent into
  a constrained, non-executable guardrail draft with explicit operator inspection.
- Agent-level Tokenomics filtering and economics detail across department,
  model, agent, people/devices, execution route, tasks, requests, tokens, and spend.
- A repeatable malicious-skill vignette across AMD AXIS, tool policy, simulated
  ISE ANC/RADIUS CoA, and Catalyst containment.
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
DefenseClaw usage ledger (OpenClaw snapshots and supported OTLP sources)
        |
        v
C3 tokenomics summary API
        |
        v
Deskside AI Resilience MFE in Cloud Control
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

Data flows into the browser only through the summary API. The live BFF reads the
DefenseClaw ledger; OTLP traces and audit evidence independently continue to
Galileo and Splunk. This keeps sink credentials out of the browser and prevents
sink query latency from weakening local enforcement.

### Agent Controls API

The Cloud Control-facing BFF exposes these focused routes below
`/v1/c3/agent-tokenomics`:

- `GET /agent-controls/allowed` lists only `command` and `tool` allow entries.
- `POST /agent-controls/allow` approves one exact command or tool name.
- `POST /agent-controls/remove` removes the matching approval. The BFF
  translates this to DefenseClaw's authenticated DELETE operation.

Command approvals match the complete command policy key, so approving
`git status` does not approve `git push`. Dangerous-command scanning runs before
the approval lookup and cannot be bypassed by an explicit allow. A tool approval
is an exact-name scan bypass: the hook lane retains CodeGuard only for recognized
write tools with inspectable path and content arguments, while the sidecar lane
treats the entry as a full scan bypass. It does not add an operating-system mount
or filesystem permission; workspace, path, network, and identity boundaries must
be enforced independently.

The quick 100K switch uses the existing catch-all budget policy with
`session_token_budget: 100000` and `action: deny`. A chat at exactly 100,000
tokens is within budget; at 100,001 tokens DefenseClaw denies the next inspected
model or tool action.

### Policy Studio API

Policy Studio uses a two-step, server-held draft contract below
`/v1/c3/agent-tokenomics`:

- `POST /policy-studio/drafts` generates and validates a typed guardrail draft.
- `POST /policy-studio/drafts/{draft_id}/apply` records a versioned demo
  acknowledgment and stages the held draft. The result is explicitly `not_enforced` and
  `ephemeral`; it does not call the live Agent Control endpoints.

The BFF can use an approved OpenAI-compatible provider with
`POLICY_STUDIO_LLM_BASE_URL`, `POLICY_STUDIO_LLM_API_KEY`,
`POLICY_STUDIO_LLM_MODEL`, and `POLICY_STUDIO_LLM_PROVIDER`. The API key stays
server-side. When the provider is absent, unreachable, or returns an invalid
shape, the BFF uses a deterministic fallback and discloses that mode in the UI.
Model output is normalized into fixed categories, decisions, severities, and a
server-owned JSON preview; executable Rego/YAML is never accepted from the model
or browser.

The demo acknowledgment is not authenticated identity evidence. Live generation
is concurrency- and rate-limited. The demo load balancer must remain restricted
to an operator CIDR; production use requires Cloud Control HTTPS and SSO before
any sensitive policy intent is entered.

### AMD Deskside fleet demo API

The demo-safe fleet contract adds:

- `GET /fleet/overview` for fixture inventory, resident DefenseClaw status,
  model routes, device posture, and simulated enforcement evidence.
- `GET /fleet/analytics` for the explicitly modeled seven-day adoption and
  modeled-cost scenario; these figures are never merged with the live ledger.
- `POST /security/policy` to arm or disarm future automatic containment with
  optimistic policy-version checks.
- `POST /fleet/desksides/{device_id}/network-action` to simulate idempotent
  quarantine or restore operations.
- `POST /fleet/demo/reset` to restore the pristine policy, inventory, device,
  action-count, and evidence baseline between rehearsals.

These routes never call a production ISE or switch. The browser labels their
state as simulated and keeps ordinary budget breaches separate from critical
security isolation.

Run the repeatable three-vignette browser test with:

```bash
npm run test:e2e:demo
```

For the current demo endpoint, the same-origin health check should return
`{"status":"ok"}`:

```bash
curl "http://<tokenomics-host>/healthz"
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
the [Deskside AI Resilience MFE End-to-End Test Guide](docs/tokenomics-e2e-testing.md).

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
- `./DefenseClawTokenomics` for the Deskside AI Resilience dashboard.

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
