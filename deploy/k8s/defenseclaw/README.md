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
  --from-literal=GALILEO_API_KEY="$GALILEO_API_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n defenseclaw create secret generic openclaw-secrets \
  --from-literal=OPENCLAW_GATEWAY_TOKEN="$OPENCLAW_GATEWAY_TOKEN" \
  --from-literal=OPENAI_API_KEY="$OPENAI_API_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n defenseclaw create secret generic splunk-cisco-skills-credentials \
  --from-file=credentials=/path/to/chmod-600/splunk-cisco-credentials \
  --dry-run=client -o yaml | kubectl apply -f -

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
  --from-literal=GALILEO_API_KEY="$GALILEO_API_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -
```

The Splunk OTel Collector values expect:

- `otel-splunk/splunk-otel-collector` with keys `splunk_observability_access_token` and `splunk_observability_access_token_secondary`
- `otel-splunk/streaming-postgres-dbmon` with keys `username`, `password`, and `access-token`

## Apply

```bash
duo-sso
aws eks update-kubeconfig --region us-east-1 --name isovalent-demo

make docker-gateway-overlay-push \
  OVERLAY_BASE_IMAGE=637423309390.dkr.ecr.us-east-1.amazonaws.com/defenseclaw:0.6.0 \
  OVERLAY_IMAGE_TAG=0.6.0-web-tui-20260520-2

# Built by the splunk-cisco-skills-bundle workflow from pinned source commit
# 2bce17ff8f2f29afd6f5326d7976d20c251538a4. Runtime pods never pull GitHub
# or install Python dependencies from PyPI.
gh workflow run splunk-cisco-skills-bundle.yml \
  -f source_sha=2bce17ff8f2f29afd6f5326d7976d20c251538a4 \
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
  sh -c 'release=/home/node/.openclaw/splunk-cisco-skills/releases/2bce17ff8f2f29afd6f5326d7976d20c251538a4; test -s "$release/.complete" && test "$(cat "$release/.revision")" = "2bce17ff8f2f29afd6f5326d7976d20c251538a4"'
```

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
| DefenseClaw Browser TUI | Live DefenseClaw TUI over a PTY-backed WebSocket | `kubectl -n defenseclaw get svc defenseclaw-tui` |
| Agent Control | Active runtime controls and matched policy | `kubectl -n defenseclaw get svc agent-control-ui` |
| Splunk Local | Searchable audit, verdict, gateway, and OTel evidence | `kubectl -n defenseclaw get svc splunk-local-ui` |
| Galileo | Prompt, datasets, and completed runtime-evidence experiments | `https://app.galileo.ai/project/0ba7b20d-8262-44c4-b230-547a0cd74b2b` |
| Cisco Cloud Control tokenomics MFE | Prebuilt executive tokenomics UI and fixture API | `kubectl -n defenseclaw-tokenomics get svc c3-agent-tokenomics-mfe` |

### Galileo Object Inventory

| Object | Value |
| --- | --- |
| Project | `clus-demo` |
| Project ID | `0ba7b20d-8262-44c4-b230-547a0cd74b2b` |
| Log stream ID | `82b893bd-fa1f-411e-81e8-e12ca66692ad` |
| Prompt | `defenseclaw-runtime-governance` |
| Prompt ID | `1a327ae4-264d-4036-80f6-f8a424158a91` |
| Selected prompt version | `2` |
| Selected prompt version ID | `a7e61200-cc43-4fbe-941f-331095be3f4e` |
| Prompt variables | `user_prompt`, `cluster_context`, `agent_name`, `guardrail_mode` |
| Playground recipe | `playgrounds/galileo/defenseclaw-runtime-governance.playground.json` |
| Default model alias | `gpt-4.1-nano` |
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

1. Open project `clus-demo`.
2. Show prompt `defenseclaw-runtime-governance` and selected version `2`.
3. Show the six DefenseClaw datasets and explain the risk scenario behind each.
4. Review the completed `defenseclaw-runtime-evidence-*` experiments.
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

Use it live only when Galileo's configured model provider has quota:

```bash
GALILEO_API_KEY="$(kubectl -n defenseclaw get secret defenseclaw-secrets -o jsonpath='{.data.GALILEO_API_KEY}' | base64 --decode)" \
python3 scripts/run_galileo_playground_experiment.py --all --execute
```

The reliable path is the deterministic runtime-evidence runner, which does not
call an external LLM:

```bash
python3 scripts/run_galileo_runtime_evidence_experiment.py --all
```

```bash
GALILEO_API_KEY="$(kubectl -n defenseclaw get secret defenseclaw-secrets -o jsonpath='{.data.GALILEO_API_KEY}' | base64 --decode)" \
python3 scripts/run_galileo_runtime_evidence_experiment.py --all --execute
```
