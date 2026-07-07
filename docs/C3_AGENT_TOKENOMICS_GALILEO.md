# Cisco Cloud Control Tokenomics + Galileo Runtime Governance Demo

This demo adds a Cisco Cloud Control-facing bridge for the executive Agent
Tokenomics view. In the live EKS path, DefenseClaw's durable budget ledger is
the source of truth for token and reported-cost usage, and DefenseClaw enforces
the local deny or steer policy. The same OTel stream continues to Galileo and
Splunk; Galileo metadata remains optional server-side enrichment.

The repo still uses `c3` in some live identifiers, paths, modules, and demo
endpoints, such as `/v1/c3/agent-tokenomics/summary` and
`c3-agent-tokenomics-demo`. In demo narration, read `c3` as Cisco Cloud
Control.

## Customer story

> C3 shows which agents, models, services, and workflows are consuming tokens,
> raises live budget alerts, and applies a DefenseClaw stop or steer policy.
> Agent Control and Galileo provide the broader named runtime-governance plane,
> while Splunk receives the operational evidence.

Use [C3_AGENT_TOKENOMICS_DEMO_SCRIPT.md](C3_AGENT_TOKENOMICS_DEMO_SCRIPT.md)
for the live EKS preflight, stage directions, and five-minute narration.

## Cisco Cloud Control fit

[Cisco Cloud Control](https://cloud.cisco.com/) is positioned as a unified
management experience for Cisco products and beyond. In the security domain,
[Cisco Security Cloud Control](https://www.cisco.com/c/en/us/products/collateral/security/security-cloud-control/security-cloud-control-faq.html)
centralizes management, visibility, and automation across Cisco security
products, including Cisco AI Defense. The
[Security Cloud Control API](https://developer.cisco.com/docs/security-cloud-control/)
documents programmatic management for organizations, users, roles, network
objects, and integrated products such as AI Defense.

This repo does not call Cisco Cloud Control or Security Cloud Control APIs
directly. The demo bridge models the server-side payload and policy contract a
Cisco Cloud Control-native experience could consume. Policy provenance is
`local` today; a future Galileo SaaS controller can push the same contract into
DefenseClaw without moving the enforcement point or exposing credentials.

The base endpoint remains:

```http
GET /v1/c3/agent-tokenomics/summary
```

The Galileo-enriched view is opt-in:

```http
GET /v1/c3/agent-tokenomics/summary?include_galileo=true
```

When `include_galileo=false`, the response is the tokenomics-only DTO.
When `include_galileo=true`, the response adds:

- top-level `galileo` rollups
- per-agent `top_agents[].galileo` runtime summaries
- `runtime_governance_cards` for the four Cisco Cloud Control executive cards
- `runtime_governance_evidence` for the evidence table
- an executive banner that explains the O11y + Galileo + Cisco Cloud Control split

The live control endpoints are:

```http
GET  /v1/c3/agent-tokenomics/usage/rows
GET  /v1/c3/agent-tokenomics/policies/effective
GET  /v1/c3/agent-tokenomics/alerts
POST /v1/c3/agent-tokenomics/controls/apply
POST /v1/c3/agent-tokenomics/controls/release
```

`GET /readyz` is the dependency-aware readiness contract. With fixture fallback
disabled, it returns `503` until the authenticated DefenseClaw policy API is
reachable.

## Data sources and ownership

| Data | Source of truth | Cisco Cloud Control use |
|------|-----------------|--------|
| Token counts, reported cost, models, agents, sessions | DefenseClaw budget ledger | KPI cards, top-agent/model tables, budget evaluation |
| Operational token and policy evidence | Galileo and Splunk via OTel/audit sinks | Cross-system investigation and demo proof |
| Named non-budget runtime controls | Agent Control | Existing deny, steer, observe, and approval policy evaluation |
| Unified executive view | Cisco Cloud Control-native app | One page for agent cost, behavior, and runtime governance |

The Cisco Cloud Control browser experience must not receive O11y or Galileo API
keys. This bridge is a server-side BFF shape only.

## Cisco Cloud Control visual additions

The existing tokenomics page should keep the O11y KPI row and add a second row:

1. **Runtime Controls** - `galileo.runtime_control_events`
2. **Blocked Unsafe Actions** - `galileo.denies`
3. **Human Reviews** - `galileo.human_reviews`
4. **Failed Runtime Evals** - `galileo.failed_evals`

Add a table named **Runtime Governance Evidence** backed by
`runtime_governance_evidence`:

| Column | Field |
|--------|-------|
| Agent | `agent_name` |
| Decision | `decision` |
| Severity | `severity` |
| Reason | `reason` |
| Target / Tool | `target` and `action` |
| Token pressure | `token_pressure.tokens`, `token_pressure.percentage_of_total`, `token_pressure.rank` |
| Trace link | `deep_link` |

## Join strategy

Galileo enrichment joins to O11y rows in this order:

1. `trace_id`
2. `session_id` / `gen_ai.conversation.id`
3. `agent_name` / `gen_ai.agent.name`

The response includes `join_key` on each governance evidence row so the UI can
annotate lower-confidence joins later without changing the DTO.

## Local commands

Generate the O11y-only response:

```bash
PYTHONPATH=cli python -m defenseclaw.c3_agent_tokenomics.cli \
  --tenant-id c3-demo-tenant \
  --workspace-id wayne-demo \
  --output artifacts/c3_agent_tokenomics_o11y.json
```

Generate the O11y + Galileo response:

```bash
PYTHONPATH=cli python -m defenseclaw.c3_agent_tokenomics.cli \
  --tenant-id c3-demo-tenant \
  --workspace-id wayne-demo \
  --include-galileo \
  --output artifacts/c3_agent_tokenomics_with_galileo.json
```

Use the DefenseClaw CLI wrapper:

```bash
PYTHONPATH=cli python -m defenseclaw.main c3-tokenomics generate \
  --include-galileo \
  --output artifacts/c3_agent_tokenomics_with_galileo.json
```

Serve the mock BFF for Cisco Cloud Control frontend wiring:

```bash
PYTHONPATH=cli python -m defenseclaw.c3_agent_tokenomics.mock_api --port 8787
curl http://127.0.0.1:8787/healthz
curl 'http://127.0.0.1:8787/v1/c3/agent-tokenomics/summary?include_galileo=true'
```

## Prebuilt MFE handoff

The pragmatic-clarity prebuilt micro-frontend handoff is checked in under
`bundles/c3_agent_tokenomics/mfe_prebuilt`. It includes a static `dist/`
directory, fixture summary payload, and a local Node runner so reviewers can
exercise the Cisco Cloud Control tokenomics surface without Artifactory access
or `npm install`:

```bash
cd bundles/c3_agent_tokenomics/mfe_prebuilt
./run-prebuilt-tokenomics-demo.sh
```

Then open:

```text
http://127.0.0.1:3001/?view=tokenomics
```

## Environment knobs

| Variable | Use |
|----------|-----|
| `TOKENOMICS_DEMO_FIXTURE_PATH` | Override packaged O11y metric rows fixture |
| `TOKENOMICS_DEMO_ALLOW_FIXTURE_FALLBACK` | Stage-demo fallback guard; defaults to `true` |
| `DEFENSECLAW_GATEWAY_BASE_URL` | Internal DefenseClaw API base URL |
| `DEFENSECLAW_GATEWAY_TOKEN` | Server-side gateway bearer token; never returned to the browser |
| `TOKENOMICS_BFF_URL` | Internal BFF URL used by the prebuilt MFE proxy |
| `TOKENOMICS_BFF_TIMEOUT_MS` | MFE proxy deadline, bounded to 100-30000 ms; defaults to 7000 |
| `GALILEO_RUNTIME_CONTROLS_FIXTURE_PATH` | Override packaged Galileo runtime controls fixture |
| `O11Y_REALM` | Fill O11y deep-link host, for example `us0` |
| `GALILEO_API_BASE` | Galileo API host; defaults to `https://api.galileo.ai` |
| `GALILEO_API_KEY` | Server-side Galileo API key for live checks; never returned to browser |
| `GALILEO_PROJECT` | Galileo project name; repo default is `clus-demo` |
| `GALILEO_PROJECT_ID` | Galileo project UUID; repo default is `0ba7b20d-8262-44c4-b230-547a0cd74b2b` |
| `GALILEO_LOG_STREAM` | Galileo log stream name; repo default is `clus-demo` |
| `GALILEO_LOG_STREAM_ID` | Galileo log stream UUID; repo default is `82b893bd-fa1f-411e-81e8-e12ca66692ad` |

## Galileo credential check

Local fixture-backed generation can incorporate the project/log-stream metadata
without storing credentials:

```bash
export GALILEO_API_KEY="<redacted>"
export GALILEO_PROJECT="clus-demo"
export GALILEO_PROJECT_ID="0ba7b20d-8262-44c4-b230-547a0cd74b2b"
export GALILEO_LOG_STREAM="clus-demo"
export GALILEO_LOG_STREAM_ID="82b893bd-fa1f-411e-81e8-e12ca66692ad"
PYTHONPATH=cli python -m defenseclaw.main c3-tokenomics generate \
  --include-galileo \
  --output artifacts/c3_agent_tokenomics_with_galileo.json
```

To verify the key can resolve the configured project, run a live server-side
check. The command prints only safe status and project metadata, not the API key.

```bash
PYTHONPATH=cli python -m defenseclaw.main c3-tokenomics galileo-check --live
```

## SignalFlow starting points

Confirm the exact metric names and dimensions in the demo org's Metric Finder.
The fixture-backed transform expects rows equivalent to these rollups:

```python
# Total tokens by type
A = data('gen_ai.client.token.usage', rollup='sum').sum(by=['gen_ai.token.type']).publish(label='tokens_by_type')
```

```python
# Tokens by agent/model/provider/type
A = data('gen_ai.client.token.usage', rollup='sum').sum(by=['gen_ai.agent.name', 'gen_ai.request.model', 'gen_ai.provider.name', 'gen_ai.token.type']).publish(label='tokens_by_agent_model')
```

```python
# Duration pressure by agent/model when available
A = data('gen_ai.client.operation.duration', rollup='average').mean(by=['gen_ai.agent.name', 'gen_ai.request.model']).publish(label='operation_duration')
```

## Kubernetes demo path

`deploy/k8s/defenseclaw/c3-agent-tokenomics-demo.yaml` adds a hardened, live
Cisco Cloud Control BFF deployment beside DefenseClaw. Production demo mode
sets `TOKENOMICS_DEMO_ALLOW_FIXTURE_FALLBACK=false`; readiness therefore fails
instead of displaying synthetic usage when the gateway is unavailable. The
ConfigMap carries safe defaults such as
`O11Y_REALM=us1`, `GALILEO_PROJECT=clus-demo`, and
`GALILEO_PROJECT_ID=0ba7b20d-8262-44c4-b230-547a0cd74b2b`; it also pins the
demo log stream ID. The gateway token comes from the required
`defenseclaw-gateway-access` Secret. The Galileo API key remains optional:

```bash
kubectl create namespace defenseclaw-tokenomics --dry-run=client -o yaml | kubectl apply -f -
kubectl -n defenseclaw-tokenomics create secret generic c3-agent-tokenomics-galileo \
  --from-literal=GALILEO_API_KEY="$GALILEO_API_KEY"
```

Keep the Cisco Cloud Control frontend pointed at the BFF service, not at Galileo
directly.

The demo HTTP surface is exposed as a Kubernetes `LoadBalancer` Service so a
browser-facing Cisco Cloud Control UI or test client can reach it in EKS. Future
API-only dependencies should remain `ClusterIP` unless they serve a user-visible
UI.

`deploy/k8s/defenseclaw/c3-agent-tokenomics-mfe.yaml` deploys the prebuilt MFE
handoff beside that BFF. It serves the static MFE on service port `80` and the
same-origin proxy to the live BFF on service port `8787`:

```bash
kubectl apply -f deploy/k8s/defenseclaw/c3-agent-tokenomics-mfe.yaml
kubectl -n defenseclaw-tokenomics rollout status deploy/c3-agent-tokenomics-mfe
kubectl -n defenseclaw-tokenomics get svc c3-agent-tokenomics-mfe
```

## Acceptance criteria

- `/readyz` reports `mode=live` and the summary reports
  `source=defenseclaw_gateway_ledger` with `debug.fixture_backed=false`.
- An empty live ledger returns a truthful zero summary rather than fixture data.
- Missing optional dimensions become `unknown` rather than endpoint failures.
- Applying a policy creates an alert for existing over-budget usage and blocks
  the next matching inspect request when `action=deny`.
- Releasing a policy atomically removes it and releases all alerts it produced.
- Budget breach and enforcement decisions reach the audit/OTel evidence path.
- O11y and Galileo credentials remain server-side.
- Dollar cost is shown only when the source reports it; no synthetic pricing is invented.
