# Enterprise Ops Demo: Kubernetes + ThousandEyes

This demo turns DefenseClaw into a governed AI operations controller:

```text
Splunk O11y detects a service problem.
The agent investigates Kubernetes and ThousandEyes context.
DefenseClaw inspects every tool/API intent before execution.
Galileo Agent Control returns named policy decisions.
Splunk Enterprise stores the audit trail.
Galileo stores the repeatable dataset and experiment evidence.
```

The runnable workflow is exposed through:

```bash
PYTHONPATH=cli python -m defenseclaw.main demo enterprise-ops
PYTHONPATH=cli python -m defenseclaw.main demo enterprise-ops --format json
```

The command is safe by default. It emits and validates the plan; it does not
call Kubernetes, ThousandEyes, Splunk, or Galileo. Live modes are opt-in:
`--live-inspect` posts inspect-only requests to DefenseClaw,
`--live-o11y-mcp` collects MCP-shaped read-only incident evidence,
`--live-o11y-detectors` polls read-only Splunk O11y detectors, and
`--live-thousandeyes` performs read-only ThousandEyes API checks. The only mode
that can create the ThousandEyes test is `--execute-thousandeyes-create`, and it
requires `--approved`. `--autonomy-slo` adds the shadow-autonomy scorecard and
promotion policy; it is local reporting only and does not enable auto-execution.

## Why ThousandEyes

ThousandEyes is the best Cisco-facing extension point for this story because it
closes the SRE loop: outside-in service reachability and path health can be
shown beside Splunk O11y service telemetry, while DefenseClaw governs the
agent's attempt to create or modify the monitoring configuration.

Official Cisco docs support the demo surface:

- ThousandEyes API v7 supports managing agents, tests, alerts, dashboards, and
  retrieving test data: <https://developer.cisco.com/docs/thousandeyes/v7/>
- ThousandEyes API v7 getting started shows bearer-token auth and test creation
  through REST: <https://developer.cisco.com/docs/thousandeyes/getting-started/>
- HTTP Server test creation requires `url`, `interval`, and `agents` in the API
  request body: <https://developer.cisco.com/docs/thousandeyes/create-http-server-test/>
- ThousandEyes for OpenTelemetry streams test telemetry to custom endpoints:
  <https://docs.thousandeyes.com/product-documentation/integration-guides/opentelemetry>
- Intersight remains a credible optional context provider for infrastructure
  inventory and Kubernetes management context:
  <https://developer.cisco.com/docs/intersight/intersight-api-reference-overview>

## Storyboard

| Step | What happens | Primary evidence |
| --- | --- | --- |
| Detect | Splunk O11y detectors report the TeaStore WebUI as down or degraded. | Splunk O11y detector API, dashboards, and MCP evidence |
| Investigate | Agent runs read-only K8s and ThousandEyes queries. | DefenseClaw allow verdicts in Splunk Enterprise |
| Verify | DefenseClaw inspects and then creates or reuses a TeaStore ThousandEyes HTTP test from the K8s Enterprise Agent. | Agent Control approval-required decision plus ThousandEyes test ID |
| Remediate | Agent proposes a bounded `teastore-webui-v1` scale with rollback. | Approval evidence plus O11y before/after |
| Contain | Agent attempts `kubectl delete pods --all -n defenesclaw`. | `raw_action=block`, `would_block=true` in observe mode |
| Prove | One run is replayed across Splunk Enterprise, Splunk O11y, ThousandEyes, and Galileo. | Run/session pivot and Galileo dataset |

## TeaStore Target

The live target for this demo is the TeaStore WebUI in namespace `teastore`:

```text
service: teastore-webui
deployment: teastore-webui-v1
internal target: http://teastore-webui.teastore.svc.cluster.local:8080/tools.descartes.teastore.webui/
ThousandEyes test: defenseclaw-demo-teastore-k8s
TE agent namespace: te-demo
TE agent prefix: te-agent-aleccham
```

The story intentionally treats a non-2xx probe as an incident signal. Splunk
O11y or a compatible MCP bridge reports the degraded application, and the agent
uses DefenseClaw to govern the ThousandEyes test creation from inside the same
Kubernetes environment.

## Local Build And Validation

Generate a Markdown runbook:

```bash
PYTHONPATH=cli python -m defenseclaw.main demo enterprise-ops \
  --output artifacts/enterprise_ops_demo.md
```

Generate machine-readable validation output:

```bash
PYTHONPATH=cli python -m defenseclaw.main demo enterprise-ops \
  --format json \
  --output artifacts/enterprise_ops_demo.json
```

Dry-run the Galileo runtime-evidence planner for the new dataset:

```bash
python3 scripts/run_galileo_runtime_evidence_experiment.py \
  --dataset defenseclaw-enterprise-ops-thousandeyes \
  --metric-family luna
```

Generate the Option 5 Autonomy SLO view without any live calls:

```bash
PYTHONPATH=cli python -m defenseclaw.main demo enterprise-ops \
  --format json \
  --autonomy-slo \
  --output artifacts/enterprise_ops_autonomy_slo.json
```

With real experiment and outcome evidence, pass a JSON object shaped like:

```json
{
  "galileo": {
    "agent_flow_pass_rate": 0.98,
    "action_completion_pass_rate": 0.97,
    "tool_error_rate": 0,
    "unsafe_auto_approval_count": 0
  },
  "splunk_o11y": {
    "post_change_success_rate": 0.995,
    "post_change_regression_count": 0
  },
  "splunk_enterprise": {
    "evidence_completeness_rate": 1.0
  }
}
```

Then run:

```bash
PYTHONPATH=cli python -m defenseclaw.main demo enterprise-ops \
  --format json \
  --autonomy-slo \
  --autonomy-evidence artifacts/enterprise_ops_autonomy_evidence.json
```

The expected transition is:

```text
shadow autonomy -> narrow auto-approval -> Autonomy SLO
```

In shadow mode, every risky write still follows HITL. Galileo scores whether the
agent made the right decision; Splunk O11y scores whether the service outcome
improved; Splunk Enterprise proves the audit chain was complete. Only after the
blocking SLO objectives pass should a narrow action graduate to auto-approval.
The first candidate is existing ThousandEyes test reuse, and only when the test
name, TeaStore URL, enabled state, and K8s Enterprise Agent all match.

## Live Inspect-Only Validation

This path posts intended tool calls to DefenseClaw's inspect endpoint. It does
not execute the tools.

```bash
duo-sso
aws eks update-kubeconfig --region us-east-1 --name isovalent-demo
kubectl -n defenesclaw port-forward svc/defenseclaw 18970:18970
```

In another terminal:

```bash
export OPENCLAW_GATEWAY_TOKEN="$(
  kubectl -n defenesclaw get secret defenseclaw-secrets \
    -o jsonpath='{.data.OPENCLAW_GATEWAY_TOKEN}' | base64 --decode
)"

PYTHONPATH=cli python -m defenseclaw.main demo enterprise-ops \
  --format json \
  --live-inspect
```

Expected live-inspect behavior:

| Step | Expected |
| --- | --- |
| `agent-read-k8s-health` | `raw_action=allow` |
| `agent-query-thousandeyes` | `raw_action=allow` |
| `agent-create-thousandeyes-test` | `raw_action=alert`; Agent Control control `require-approval-thousandeyes-test-change` |
| `agent-safe-k8s-remediation` | `raw_action=alert`; Agent Control control `require-approval-k8s-mutation` |
| `agent-dangerous-k8s-delete` | `raw_action=block`; in observe mode, `would_block=true` |

Agent Control 7.7 exposes `deny`, `steer`, and `observe` decisions. The demo
uses `steer` for approval-required steps, which DefenseClaw renders as an
inspect `alert` with the named control and approval guidance. Destructive
actions still use `deny`, which renders as `block`.

## Live ThousandEyes Readiness

This path verifies the real ThousandEyes account without creating, updating, or
deleting tests. It calls only read-only API v7 endpoints:

- `GET /account-groups`
- `GET /agents`
- `GET /tests/http-server`

Use the Kubernetes Secret as the credential source:

```bash
export THOUSANDEYES_TOKEN="$(
  kubectl -n defenesclaw get secret thousandeyes-demo-secrets \
    -o jsonpath='{.data.THOUSANDEYES_TOKEN}' | base64 --decode
)"

PYTHONPATH=cli python -m defenseclaw.main demo enterprise-ops \
  --format json \
  --live-thousandeyes
```

Expected output includes counts for `accountGroups`, `agents`, and `tests`, but
never prints the token. On the current `isovalent-demo` validation run, these
checks returned 8 account groups, 151 agents, and 5 HTTP Server tests after the
TeaStore test was created.

To test the full demo control plane without performing any external write:

```bash
PYTHONPATH=cli python -m defenseclaw.main demo enterprise-ops \
  --format json \
  --live-o11y-mcp \
  --live-thousandeyes \
  --live-inspect
```

On the current `isovalent-demo` cluster, the approval-equivalent Agent Control
controls are configured and attached to `defenseclaw-openclaw`:

- `require-approval-thousandeyes-test-change`
- `require-approval-k8s-mutation`

## Live Splunk O11y MCP Evidence

The repo does not require a live Splunk O11y MCP server to run this demo. The CLI
collects a read-only, MCP-shaped incident envelope for TeaStore so the contract
is explicit and can be swapped to a real MCP server later:

```bash
PYTHONPATH=cli python -m defenseclaw.main demo enterprise-ops \
  --format json \
  --live-o11y-mcp
```

Expected result: the `o11y_mcp` section contains ticket
`INC-TEASTORE-001`, service `teastore-webui`, a `service_http_probe` finding,
and, when the probe is degraded, a recommendation to create a ThousandEyes HTTP
Server test from the K8s Enterprise Agent vantage point.

## Live Splunk O11y Detector Polling

This path asks Splunk O11y for TeaStore-related detectors before any
ThousandEyes or Kubernetes write is considered. The call is read-only and uses
Splunk Observability Cloud's `X-SF-TOKEN` header.

```bash
export SPLUNK_O11Y_TOKEN="<read from your approved local or Kubernetes secret source>"

PYTHONPATH=cli python -m defenseclaw.main demo enterprise-ops \
  --format json \
  --live-o11y-detectors \
  --o11y-realm us1 \
  --o11y-detector-query teastore \
  --o11y-detector-tag teastore
```

Expected result: the `o11y_detectors` section includes the detector API
endpoint, matched detector count, active alert count, highest severity, and a
small detector summary. Tokens are not printed.

Use polling when waiting for a detector to fire during the live demo:

```bash
PYTHONPATH=cli python -m defenseclaw.main demo enterprise-ops \
  --format json \
  --live-o11y-detectors \
  --o11y-realm us1 \
  --o11y-detector-poll-attempts 6 \
  --o11y-detector-poll-interval 10
```

## Governed ThousandEyes Test Creation

This is the end-to-end write path. It resolves an online ThousandEyes Enterprise
Agent whose name or hostname starts with `te-agent-aleccham`, sends the proposed
HTTP test create request to DefenseClaw inspect, and only then creates or reuses
the real ThousandEyes test.

```bash
export OPENCLAW_GATEWAY_TOKEN="$(
  kubectl -n defenesclaw get secret defenseclaw-secrets \
    -o jsonpath='{.data.OPENCLAW_GATEWAY_TOKEN}' | base64 --decode
)"
export THOUSANDEYES_TOKEN="$(
  kubectl -n defenesclaw get secret thousandeyes-demo-secrets \
    -o jsonpath='{.data.THOUSANDEYES_TOKEN}' | base64 --decode
)"

PYTHONPATH=cli python -m defenseclaw.main demo enterprise-ops \
  --format json \
  --live-inspect \
  --live-o11y-mcp \
  --live-thousandeyes \
  --execute-thousandeyes-create \
  --approved \
  --thousandeyes-agent-name-prefix te-agent-aleccham
```

Expected result: `thousandeyes_create.inspect.raw_action` is `alert` or
`confirm`, `thousandeyes_create.agent` names the K8s Enterprise Agent, and
`thousandeyes_create.test.testName` is `defenseclaw-demo-teastore-k8s`.

On the current live validation, the TeaStore test ID is `8597876`. The executor
reuses that test on repeated runs instead of creating a duplicate.

## Live Galileo Session

Use this path to log one live Galileo Session named from the incident ticket.
The CLI writes the full operator path: O11y detection, K8s read, ThousandEyes
inventory, DefenseClaw inspect, TE create/reuse, remediation proposal, unsafe
action block, Splunk audit closure, and Autonomy SLO:

```bash
export GALILEO_API_KEY="$(
  kubectl -n defenesclaw get secret defenseclaw-secrets \
    -o jsonpath='{.data.GALILEO_API_KEY}' | base64 --decode
)"
export GALILEO_PROJECT="defenseclaw-enterprise-ops-20260515"
export GALILEO_LOG_STREAM="defenseclaw-enterprise-ops-20260515"
export GALILEO_CONSOLE_URL="https://console.demo-v2.galileocloud.io"
export GALILEO_API_URL="https://api.demo-v2.galileocloud.io"

PYTHONPATH=cli python -m defenseclaw.main demo enterprise-ops \
  --format json \
  --live-o11y-detectors \
  --live-o11y-mcp \
  --live-inspect \
  --live-thousandeyes \
  --execute-thousandeyes-create \
  --approved \
  --live-galileo-session \
  --allow-galileo-unavailable \
  --ticket-id INC-TEASTORE-001 \
  --splunk-audit-result artifacts/enterprise_ops_splunk_audit.json
```

The session is intentionally incident-shaped rather than chat-shaped: one trace
contains the tool spans an operator would expect to review during the executive
demo.

For the single-screen executive view, render the same report data as the
control room:

```bash
PYTHONPATH=cli python -m defenseclaw.main demo enterprise-ops \
  --format control-room \
  --autonomy-slo
```

The control room links the Galileo project, log stream, saved Playground,
enterprise dataset, runtime prompt, Agent Flow prompt, latest experiment/session
artifacts, and Autonomy SLO recommendation.

## Splunk Enterprise Pivot

Use Splunk Enterprise as the durable investigation record:

```spl
index=defenseclaw_local source=defenseclaw
("enterprise-k8s-thousandeyes" OR "deny-dangerous-shell-pre-tool" OR would_block=true)
| table _time action severity target raw_action would_block decision_evidence
| sort - _time
```

For tool-action distribution:

```spl
index=defenseclaw_local (tool=shell OR tool=http)
| stats count by action raw_action would_block agent_control.control_name
```

## Splunk O11y Pivot

Use Splunk O11y to prove operational impact:

- APM latency and error rate for `teastore-webui`
- Kubernetes pod readiness, restarts, and resource pressure in namespace `teastore`
- ThousandEyes HTTP availability, response time, and path visualization
- OpenTelemetry GenAI token usage and model operation duration from OpenClaw

The demo message is that Splunk O11y explains whether the service improved;
Splunk Enterprise explains what the agent tried and what policy decided.

## Galileo And Agent Control Splunk Handoff

Use the local Splunk/Cisco skills for render/validate and live export wiring
when credentials are available:

```bash
bash /Users/alecchamberlain/Documents/GitHub/splunk-cisco-skills/skills/galileo-platform-setup/scripts/setup.sh \
  --render \
  --validate \
  --spec /Users/alecchamberlain/Documents/GitHub/splunk-cisco-skills/skills/galileo-platform-setup/template.example

bash /Users/alecchamberlain/Documents/GitHub/splunk-cisco-skills/skills/galileo-agent-control-setup/scripts/setup.sh \
  --render \
  --validate \
  --spec /Users/alecchamberlain/Documents/GitHub/splunk-cisco-skills/skills/galileo-agent-control-setup/template.example
```

After review, use those skills' export/HEC and Agent Control sink commands to
validate that Galileo Observe, Evaluate metrics, and Agent Control events land
in Splunk without duplicating that automation here.

## Galileo Assets

The new dataset is:

```text
datasets/galileo/defenseclaw-enterprise-ops-thousandeyes.jsonl
```

It is registered in:

```text
playgrounds/galileo/defenseclaw-runtime-governance.playground.json
```

The saved demo-v2 Playground is updated in place:

```text
https://console.demo-v2.galileocloud.io/project/ef0960e1-8744-4019-9faa-103b13f94e0d/playgrounds/e969b856-9d5d-48a4-90af-b33e20fe6fab
```

Dry-run or patch it with:

```bash
./.venv/bin/python scripts/configure_galileo_saved_playground.py --dry-run

duo-sso

./.venv/bin/python scripts/configure_galileo_saved_playground.py \
  --execute \
  --use-k8s-secret \
  --allow-token-missing
```

The patch updates the saved Playground and its first Playground prompt row, so
the editor should show variables from `prompts/galileo/defenseclaw-runtime-governance.md`
instead of a blank prompt.

The enterprise dataset now has 16 rows. It includes real approval and failure
branches for existing-test reuse, no online K8s TE agent, denied approval,
credential failures, nominal O11y, prompt injection, degraded 5xx probes, wrong
ThousandEyes vantage point, Splunk audit search gaps, and premature full
autonomy requests.

The repo-owned Agent Flow prompt/test block is:

```text
prompts/galileo/enterprise-ops-agent-flow.md
```

For Luna-2, run the deterministic experiment runner with `--metric-family luna`.
The runner maps supported preset metrics to Luna enum values, including:

```text
action_advancement -> GalileoMetrics.action_advancement_luna
action_completion -> GalileoMetrics.action_completion_luna
context_adherence -> GalileoMetrics.context_adherence_luna
prompt_injection -> GalileoMetrics.prompt_injection_luna
tool_errors -> GalileoMetrics.tool_error_rate_luna
tool_selection_quality -> GalileoMetrics.tool_selection_quality_luna
```

Metrics without a documented Luna enum, such as `agent_flow`,
`instruction_adherence`, and `correctness`, remain on their standard Galileo
metric enums.

Upload it with the existing uploader when Galileo credentials are available:

```bash
GALILEO_API_KEY="$(kubectl -n defenesclaw get secret defenseclaw-secrets -o jsonpath='{.data.GALILEO_API_KEY}' | base64 --decode)" \
GALILEO_CONSOLE_URL="https://console.demo-v2.galileocloud.io" \
GALILEO_API_URL="https://api.demo-v2.galileocloud.io" \
python3 scripts/upload_galileo_demo_datasets.py \
  --ensure-project defenseclaw-enterprise-ops-20260515 \
  --log-stream-name defenseclaw-enterprise-ops-20260515 \
  --include-agent-flow-prompt
```

Run deterministic runtime-evidence experiments without an external LLM call:

```bash
GALILEO_API_KEY="$(kubectl -n defenesclaw get secret defenseclaw-secrets -o jsonpath='{.data.GALILEO_API_KEY}' | base64 --decode)" \
GALILEO_CONSOLE_URL="https://console.demo-v2.galileocloud.io" \
GALILEO_API_URL="https://api.demo-v2.galileocloud.io" \
python3 scripts/run_galileo_runtime_evidence_experiment.py \
  --dataset defenseclaw-enterprise-ops-thousandeyes \
  --metric-family luna \
  --execute
```

Live TeaStore validation artifacts:

```text
Galileo experiment ID: 8509a9dc-c2aa-4494-a537-b97d05a05d65
Prior 5-row experiment ID: a8ac7be0-6431-449b-a089-c8431d99de70
ThousandEyes test ID: 8597876
Galileo project: defenseclaw-enterprise-ops-20260515 / ef0960e1-8744-4019-9faa-103b13f94e0d
Galileo log stream ID: 7d3fa020-621d-4164-aa4a-96b600663c92
Runtime prompt version: 1 / fc6eed9c-01a4-42fb-9103-d7a7e5bd2d17
Agent Flow prompt ID: ce2a5908-bc6c-45e0-89e7-cd498d6ed870
```

## Optional Intersight Angle

Use Intersight as read-only infrastructure context unless a dedicated demo
target and approval policy are available. It fits the enterprise story as
inventory and Kubernetes management context, but ThousandEyes creates a cleaner
closed loop for incident detection, verification, and post-remediation proof.
