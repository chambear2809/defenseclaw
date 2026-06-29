# DefenseClaw Isovalent Demo Deployment

These manifests reproduce the DefenseClaw/OpenClaw lab stack currently running
on the `isovalent-demo` EKS cluster.

The core lab namespace is `defenseclaw`. The optional Cisco Cloud Control
tokenomics demo is isolated in `defenseclaw-tokenomics`.

## Secret Contract

Secret values are not committed. Create or update these Secrets before applying
the manifests:

```bash
kubectl create namespace defenseclaw --dry-run=client -o yaml | kubectl apply -f -

kubectl -n defenseclaw create secret generic defenseclaw-secrets \
  --from-literal=OPENCLAW_GATEWAY_TOKEN="$OPENCLAW_GATEWAY_TOKEN" \
  --from-literal=OPENAI_API_KEY="$OPENAI_API_KEY" \
  --from-literal=GALILEO_API_KEY="${GALILEO_API_KEY:-$GALILEO_DEMO_V2_API_KEY}" \
  --from-literal=GALILEO_DEMO_V2_API_KEY="$GALILEO_DEMO_V2_API_KEY" \
  --from-literal=CISCO_AI_DEFENSE_API_KEY="$CISCO_AI_DEFENSE_API_KEY" \
  --from-literal=CISCO_AI_DEFENSE_OAUTH_BASIC="$CISCO_AI_DEFENSE_OAUTH_BASIC" \
  --dry-run=client -o yaml | kubectl apply -f -

# CISCO_AI_DEFENSE_API_KEY is the AI Defense app/API key used by the
# Inspection API. CISCO_AI_DEFENSE_OAUTH_BASIC is optional fallback material
# for minting a short-lived access token when the direct key is absent. Store
# either the full "Basic ..." value or the bare base64 payload.

kubectl -n defenseclaw create secret generic openclaw-secrets \
  --from-literal=OPENCLAW_GATEWAY_TOKEN="$OPENCLAW_GATEWAY_TOKEN" \
  --from-literal=BRIDGEIT_CHAT_BASE_URL="${BRIDGEIT_CHAT_BASE_URL:-https://chat-ai.cisco.com}" \
  --from-literal=BRIDGEIT_MODEL="${BRIDGEIT_MODEL:-gpt-4o-mini}" \
  --from-literal=BRIDGEIT_APP_KEY="$BRIDGEIT_APP_KEY" \
  --from-literal=BRIDGEIT_ACCESS_TOKEN="${BRIDGEIT_ACCESS_TOKEN:-}" \
  --from-literal=BRIDGEIT_OAUTH_TOKEN_URL="${BRIDGEIT_OAUTH_TOKEN_URL:-https://id.cisco.com/oauth2/default/v1/token}" \
  --from-literal=BRIDGEIT_CLIENT_ID="${BRIDGEIT_CLIENT_ID:-}" \
  --from-literal=BRIDGEIT_CLIENT_SECRET="${BRIDGEIT_CLIENT_SECRET:-}" \
  --from-literal=BRIDGEIT_PROXY_API_KEY="${BRIDGEIT_PROXY_API_KEY:-bridgeit-local}" \
  --dry-run=client -o yaml | kubectl apply -f -

# BridgeIT is wired two ways for OpenClaw:
# - The default OpenClaw model provider is `bridgeit/gpt-4o-mini`, routed
#   through a local OpenAI-compatible proxy that mints short-lived Cisco
#   OAuth tokens and calls `chat-ai.cisco.com`.
# - The MCP server also exposes `bridgeit_chat_completion` for explicit tool
#   calls. `bridgeit_rag_search` remains as a compatibility alias.
# Prefer `BRIDGEIT_CLIENT_ID` + `BRIDGEIT_CLIENT_SECRET`; `BRIDGEIT_ACCESS_TOKEN`
# is only for manual short-lived testing.
# OpenClaw intentionally does not receive `OPENAI_API_KEY`; chat should stay on
# BridgeIT and must not auto-discover OpenAI from the environment.

kubectl -n defenseclaw create secret generic splunk-cisco-skills-credentials \
  --from-file=credentials=/path/to/chmod-600/splunk-cisco-credentials \
  --from-file=splunk_o11y_token=/path/to/chmod-600/splunk-o11y-api-token \
  --dry-run=client -o yaml | kubectl apply -f -

# The OpenClaw init container copies `splunk_o11y_token` to
# /var/run/splunk-cisco-skills/splunk_o11y_token and appends
# SPLUNK_O11Y_TOKEN_FILE=/var/run/splunk-cisco-skills/splunk_o11y_token to the
# runtime credentials file. This must be an Observability Cloud API/access
# token; Splunk Cloud stack tokens are not valid for api.<realm>.observability.
# The same file-backed token is used by the `splunk-observability-cloud` MCP
# bridge for the hosted Splunk MCP Gateway. Do not commit the token or put it in
# the OpenClaw ConfigMap.

kubectl -n defenseclaw create secret generic thousandeyes-demo-secrets \
  --from-literal=THOUSANDEYES_TOKEN="$THOUSANDEYES_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -

# OpenClaw mounts the ThousandEyes token as /var/run/thousandeyes/token and
# exposes only the file path to the autonomous operator runtime and the
# `thousandeyes-mcp` bridge for the official ThousandEyes MCP endpoint
# https://api.thousandeyes.com/mcp. Do not commit the token or put it in the
# OpenClaw ConfigMap. ThousandEyes MCP write/delete/Instant Test actions require
# explicit operator approval because they mutate state and/or consume units.

kubectl -n defenseclaw create secret generic splunk-local-secrets \
  --from-literal=SPLUNK_PASSWORD="$SPLUNK_PASSWORD" \
  --from-literal=SPLUNK_HEC_TOKEN="$SPLUNK_HEC_TOKEN" \
  --from-literal=DEFENSECLAW_SPLUNK_HEC_TOKEN="$DEFENSECLAW_SPLUNK_HEC_TOKEN" \
  --from-literal=DEFENSECLAW_INDEX="${DEFENSECLAW_INDEX:-defenseclaw_local}" \
  --from-literal=DEFENSECLAW_LOCAL_USERNAME="${DEFENSECLAW_LOCAL_USERNAME:-defenseclaw_local_user}" \
  --from-literal=DEFENSECLAW_LOCAL_PASSWORD="$DEFENSECLAW_LOCAL_PASSWORD" \
  --from-literal=PHONE_HOME_ENABLED="${PHONE_HOME_ENABLED:-false}" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n defenseclaw create secret generic agent-control-secrets \
  --from-literal=AGENT_CONTROL_API_KEY="$AGENT_CONTROL_API_KEY" \
  --from-literal=AGENT_CONTROL_API_KEYS="$AGENT_CONTROL_API_KEYS" \
  --from-literal=AGENT_CONTROL_ADMIN_API_KEYS="$AGENT_CONTROL_ADMIN_API_KEYS" \
  --from-literal=AGENT_CONTROL_SESSION_SECRET="$AGENT_CONTROL_SESSION_SECRET" \
  --from-literal=AGENT_CONTROL_POSTGRES_PASSWORD="$AGENT_CONTROL_POSTGRES_PASSWORD" \
  --from-literal=AGENT_CONTROL_DB_URL="$AGENT_CONTROL_DB_URL" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl create namespace defenseclaw-tokenomics --dry-run=client -o yaml | kubectl apply -f -

kubectl -n defenseclaw-tokenomics create secret generic c3-agent-tokenomics-galileo \
  --from-literal=GALILEO_API_KEY="${GALILEO_DEMO_V2_API_KEY:-$GALILEO_API_KEY}" \
  --dry-run=client -o yaml | kubectl apply -f -
```

The Splunk OTel Collector values expect:

- `otel-splunk/splunk-otel-collector` with keys `splunk_observability_access_token` and `splunk_observability_access_token_secondary`
- `otel-splunk/streaming-postgres-dbmon` with keys `username`, `password`, and `access-token`

## Apply

```bash
duo-sso
aws eks update-kubeconfig --region us-east-1 --name isovalent-demo

make docker-gateway-runtime-push \
  VERSION=0.7.2 \
  OVERLAY_IMAGE_TAG=0.7.2-web-tui

# Built by the splunk-cisco-skills-bundle workflow from pinned source commit
# 5b5f74818616ab102af36642b93fb3ff6773581c. Runtime pods never pull GitHub
# or install Python dependencies from PyPI.
gh workflow run splunk-cisco-skills-bundle.yml \
  -f source_sha=5b5f74818616ab102af36642b93fb3ff6773581c \
  -f publish=true

kubectl apply -f deploy/k8s/defenseclaw/isovalent-demo-core.yaml
kubectl apply -f deploy/k8s/defenseclaw/c3-agent-tokenomics-demo.yaml
kubectl apply -f deploy/k8s/defenseclaw/c3-agent-tokenomics-mfe.yaml

helm repo add splunk-otel-collector-chart https://signalfx.github.io/splunk-otel-collector-chart
helm repo update
helm upgrade --install splunk-otel-collector \
  splunk-otel-collector-chart/splunk-otel-collector \
  --version 0.148.0 \
  --namespace otel-splunk \
  --create-namespace \
  --values deploy/helm/splunk-otel-collector/isovalent-demo.values.yaml
```

## Validate

```bash
kubectl -n defenseclaw rollout status deploy/agent-control
kubectl -n defenseclaw rollout status deploy/agent-control-postgres
kubectl -n defenseclaw rollout status deploy/defenseclaw
kubectl -n defenseclaw rollout status deploy/openclaw
kubectl -n defenseclaw rollout status deploy/splunk-local
kubectl -n defenseclaw-tokenomics rollout status deploy/c3-agent-tokenomics-demo
kubectl -n defenseclaw-tokenomics rollout status deploy/c3-agent-tokenomics-mfe
helm -n otel-splunk status splunk-otel-collector

kubectl -n defenseclaw exec deploy/openclaw -- \
  sh -c 'release=/home/node/.openclaw/splunk-cisco-skills/releases/5b5f74818616ab102af36642b93fb3ff6773581c; test -f "$release/.complete" && test "$(cat "$release/.revision")" = "9bb131a104830b166dc0918b1be89332a7a8ada4"'

kubectl -n defenseclaw exec deploy/openclaw -- \
  sh -c 'kubectl version --client=true && kubectl auth can-i get pods -n teastore && test -s "$THOUSANDEYES_TOKEN_FILE" && test -s "$SPLUNK_O11Y_TOKEN_FILE"'

kubectl -n defenseclaw exec deploy/openclaw -- \
  sh -c 'test -s /home/node/.openclaw/mcp-bridges/splunk-observability-cloud/run-splunk-o11y-mcp.js && test -s /home/node/.openclaw/mcp-bridges/thousandeyes/run-thousandeyes-mcp.js'
```

For the recorded OpenClaw TeaStore run, external evidence should come from the
loaded `splunk-observability-cloud` and `thousandeyes-mcp` MCP tools. Do not use
the runtime-evidence helper in the recording script; use read-only `exec` only
for Kubernetes health because this lab does not load a Kubernetes MCP server.

## K8 Demo Surface

The core demo is the live DefenseClaw/OpenClaw runtime in `defenseclaw`.
Splunk shows operational evidence, Agent Control shows active runtime policy,
and Galileo shows repeatable prompt, dataset, and experiment evidence for the
same governance scenarios. The Cisco Cloud Control tokenomics demo in namespace
`defenseclaw-tokenomics` is a separate optional surface and is not part of this
Agent Watch flow.

| Surface | Demo use | Entry point |
| --- | --- | --- |
| DefenseClaw API | Live `/api/v1/inspect/tool` policy decision | `kubectl -n defenseclaw port-forward svc/defenseclaw 18970:18970` |
| DefenseClaw Browser TUI | Live DefenseClaw TUI over a PTY-backed WebSocket | `http://a246f73430d334d7ea0360d19c827954-26b8542129d36765.elb.us-east-1.amazonaws.com` (`kubectl -n defenseclaw get svc defenseclaw-tui`) |
| Agent Control | Controls page for active runtime policy; Monitor page for live matched decisions | `kubectl -n defenseclaw get svc agent-control-ui` |
| Splunk Local | Searchable audit, verdict, gateway, and OTel evidence | `kubectl -n defenseclaw get svc splunk-local-ui` |
| Galileo | Prompt, datasets, saved Playground, and completed experiment evidence | `https://console.demo-v2.galileocloud.io/project/ef0960e1-8744-4019-9faa-103b13f94e0d` |
| Cisco Cloud Control tokenomics MFE | Prebuilt executive tokenomics UI and fixture API | `kubectl -n defenseclaw-tokenomics get svc c3-agent-tokenomics-mfe` |

### Galileo Object Inventory

| Object | Value |
| --- | --- |
| Project | `defenseclaw-enterprise-ops-20260515` |
| Project ID | `ef0960e1-8744-4019-9faa-103b13f94e0d` |
| Log stream ID | `7d3fa020-621d-4164-aa4a-96b600663c92` |
| Prompt | `defenseclaw-runtime-governance` |
| Prompt ID | `096341e8-05c8-4c8f-9e39-12155a61a8ad` |
| Selected prompt version | `3` |
| Selected prompt version ID | `5d76f586-e9a7-4aed-8697-29c282da0555` |
| Prompt variables | `user_prompt`, `cluster_context`, `agent_name`, `guardrail_mode` |
| Playground recipe | `playgrounds/galileo/defenseclaw-runtime-governance.playground.json` |
| Default model alias | `BridgeIT GPT-4o Mini (custom)` |
| Playground settings | temperature `0.2`, max tokens `700`, top_p `1.0` |

The full dataset and experiment inventory lives in
[docs/GALILEO_DEFENSECLAW_DATASETS.md](../../../docs/GALILEO_DEFENSECLAW_DATASETS.md).
The timed 5, 25, 45, and 60 minute run-of-show variants live in
[docs/DEFENSECLAW_DEMO_PACKAGE.md](../../../docs/DEFENSECLAW_DEMO_PACKAGE.md).

### Live Agent Control And Splunk Flow

Use the dangerous tool scenario as the live bridge between the running K8
stack and Galileo evidence:

```bash
kubectl -n defenseclaw port-forward svc/defenseclaw 18970:18970
```

```bash
curl -sS http://127.0.0.1:18970/api/v1/inspect/tool \
  -H 'Content-Type: application/json' \
  -d '{"tool":"shell","args":{"command":"kubectl delete pods --all -n defenseclaw"}}' | jq
```

In observe mode, the useful evidence is `raw_action`, `would_block`,
`agent_control.control_name`, and `agent_control.action`. The expected Agent
Control match is `deny-dangerous-shell-pre-tool`.

Open the Agent Control UI from `agent-control-ui`. Show **Controls** first to
confirm the active runtime policies, then switch to **Monitor** to show the live
decision event for the same tool request.

Then open Splunk Local and pivot on the same control decision:

```spl
index=defenseclaw_local source=defenseclaw
("deny-dangerous-shell-pre-tool" OR would_block=true OR raw_action=block)
| table _time sourcetype action severity target details raw_action would_block
| sort - _time
```

### Galileo Review

After the live Agent Control/Splunk flow, use Galileo as the repeatable review
surface:

1. Open project `defenseclaw-enterprise-ops-20260515`.
2. Show prompt `defenseclaw-runtime-governance` and selected version `2`.
3. Show the seven DefenseClaw datasets and explain the risk scenario behind each.
4. Review the saved enterprise Playground and completed runtime-evidence fallback experiments.
5. Use `defenseclaw-dangerous-tool-pre-tool` as the main bridge back to Agent
   Control and Splunk evidence from the live `/api/v1/inspect/tool` demo.

### Dataset Evidence Map

| Dataset | Agent Control control | Splunk evidence | Demo message |
| --- | --- | --- | --- |
| `defenseclaw-safe-ops` | None; expected allow | `openclaw_gateway_logs_base`, read-only health and status events | Safe K8 inspection proceeds without mutation. |
| `defenseclaw-prompt-injection-pre-llm` | `observe-prompt-injection-pre-llm` | `defenseclaw:verdict` / `guardrail-verdict` rows with `direction=prompt` and injection findings | Untrusted instructions are observed before the LLM step. |
| `defenseclaw-dangerous-tool-pre-tool` | `deny-dangerous-shell-pre-tool` | `/api/v1/inspect/tool` audit rows with `would_block=true`, `raw_action=block`, and Agent Control fields | Destructive shell/K8 tool use is denied before execution. |
| `defenseclaw-pii-post-llm` | `steer-pii-post-llm` | `defenseclaw:verdict` and redacted completion evidence with PII/secret findings | Sensitive output is steered or redacted before review. |
| `defenseclaw-ambiguous-admin-intent` | Approval-seeking behavior; prompt injection may be observed | `defenseclaw_control_actions`, HITL or would-ask/would-block details when configured | Risky admin intent should ask for approval, scope, and rollback. |
| `defenseclaw-grounded-cluster-review` | None unless the row explains `deny-dangerous-shell-pre-tool` | Gateway, audit, and OTel rows for `isovalent-demo` / `defenseclaw` context | Answers stay grounded in the live cluster and ignore Cisco Cloud Control resources. |

### Galileo Experiment Paths

Dry-run the model-backed Playground path:

```bash
python3 scripts/run_galileo_playground_experiment.py --all
```

Use it live after the BridgeIT custom integration is configured:

```bash
GALILEO_API_KEY="$(kubectl -n defenseclaw get secret defenseclaw-secrets -o jsonpath='{.data.GALILEO_DEMO_V2_API_KEY}' | base64 --decode)" \
GALILEO_CONSOLE_URL="https://console.demo-v2.galileocloud.io" \
GALILEO_API_URL="https://api.demo-v2.galileocloud.io" \
python3 scripts/run_galileo_playground_experiment.py \
  --dataset defenseclaw-dangerous-tool-pre-tool \
  --execute
```

The deterministic runtime-evidence runner is a Galileo fallback path only. Do
not use it for the recorded OpenClaw TeaStore run, which should exercise MCP
tool calls directly:

```bash
python3 scripts/run_galileo_runtime_evidence_experiment.py --all
```

```bash
GALILEO_API_KEY="$(kubectl -n defenseclaw get secret defenseclaw-secrets -o jsonpath='{.data.GALILEO_DEMO_V2_API_KEY}' | base64 --decode)" \
python3 scripts/run_galileo_runtime_evidence_experiment.py --all --execute
```
