# Cisco Cloud Control Agent Tokenomics GUI Demo Script

This is a GUI-led demo. The presenter conducts the workload from OpenClaw
Chat, then uses the Cisco Cloud Control Tokenomics GUI to show live usage,
apply a DefenseClaw budget policy, and demonstrate that the next OpenClaw
request is governed. Do not show a terminal during the timed presentation.

## Demo Outcome

The audience should see this sequence:

1. OpenClaw completes a read-only TeaStore investigation with enterprise tools.
2. The completed turn appears as live usage in Tokenomics.
3. The presenter applies a budget policy in the Tokenomics GUI.
4. DefenseClaw governs the next OpenClaw request.
5. Tokenomics shows the effective policy and budget-breach evidence.

## Operator-Only Preflight

Run this before the audience arrives. It discovers the current Tokenomics URL
and verifies that the GUI is backed by the live DefenseClaw ledger rather than
fixtures.

```bash
duo-sso
aws eks update-kubeconfig --region us-east-1 --name isovalent-demo

export TOKENOMICS_NAMESPACE="defenseclaw-tokenomics"
export TOKENOMICS_BFF_HOST="$(kubectl -n "$TOKENOMICS_NAMESPACE" get svc c3-agent-tokenomics-demo -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')"
export TOKENOMICS_MFE_HOST="$(kubectl -n "$TOKENOMICS_NAMESPACE" get svc c3-agent-tokenomics-mfe -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')"
export TOKENOMICS_API="http://${TOKENOMICS_BFF_HOST}:8787"
export TOKENOMICS_UI="http://${TOKENOMICS_MFE_HOST}/?view=tokenomics"

kubectl -n "$TOKENOMICS_NAMESPACE" rollout status deploy/c3-agent-tokenomics-demo --timeout=90s
kubectl -n "$TOKENOMICS_NAMESPACE" rollout status deploy/c3-agent-tokenomics-mfe --timeout=90s
curl -fsS "$TOKENOMICS_API/readyz" | jq -e '.status == "ready" and .mode == "live"'
curl -fsS "$TOKENOMICS_API/v1/c3/agent-tokenomics/summary?include_galileo=true" \
  | jq -e '.source == "defenseclaw_gateway_ledger" and (.debug.fixture_backed | not)'
curl -fsS "$TOKENOMICS_API/v1/c3/agent-tokenomics/policies/effective" \
  | jq '.[] | select(.agent_id == "main")'
curl -fsS -o /dev/null "$TOKENOMICS_UI"

printf 'OpenClaw Chat: %s\nTokenomics UI: %s\n' \
  'https://openclaw.rosa.fso-tme.eoha.p3.openshiftapps.com/chat' \
  "$TOKENOMICS_UI"
```

Do not start the demo if either `jq -e` check fails.

## Prepare The Browser

Open these tabs in this order:

1. **OpenClaw Chat** - `https://openclaw.rosa.fso-tme.eoha.p3.openshiftapps.com/chat`
2. **Tokenomics Control Plane** - use the `TOKENOMICS_UI` printed by preflight

In OpenClaw, create a fresh chat so the audience can follow one clean run.

In Tokenomics, click **Refresh**. If **Current Control State** already contains
a policy for agent `main`, record its action and four budget values in the
presenter notes. Then use **Apply Local Budget Policy** to replace it temporarily
with a **Steer** policy whose session and daily token budgets are both
`9000000000`; leave both cost budgets blank. This prevents the baseline prompt
from being blocked while preserving the values needed for cleanup. If no
`main` policy exists, record that fact and leave the control state empty.

Click **Refresh**. The **Open Budget Alerts** card should read `0` before the
live run.

The Tokenomics page contains two related GUI surfaces:

- The outer **Tokenomics Control Plane** provides **Apply Local Budget Policy**,
  **Current Control State**, and **Budget Breach Feed**.
- The embedded **C3 Tokenomics MFE** provides **Cost**, **Budget**,
  **Controls**, and **Settings** tabs for the executive and operator views.

## 0:00-0:30 - Start In OpenClaw

Show: the fresh OpenClaw chat.

Say:

> We are starting with an autonomous operations agent in OpenClaw. The agent
> can investigate Kubernetes, Splunk Observability, and ThousandEyes, while
> DefenseClaw governs every request and tool call. We will conduct the work
> here, then use Cisco Cloud Control Tokenomics to control its budget.

Paste this prompt into OpenClaw:

```text
Run a fresh, read-only TeaStore incident check. Do not use earlier chat history,
do not ask to proceed, and do not make any changes.

1. Call splunk-observability-cloud__o11y_search_alerts_or_incidents with:
   {"params":{"time_range":{"start":"-2h","stop":"now"},"detector_id":"HI-D6XZA4AE","include_inactive":false,"limit":10}}
2. Use exec only for this read-only command:
   kubectl -n teastore get deploy,svc,pods -o wide
3. Call thousandeyes-mcp__list_network_app_synthetics_tests with:
   {"name":"defenseclaw-demo-teastore-k8s","type":"http-server","target":"teastore-webui","detail":"compact","page_size":20}
4. Summarize the O11y alert, Kubernetes health, ThousandEyes reuse decision,
   DefenseClaw policy gates, and recommended next action.

Do not call create, update, delete, Instant Test, or Kubernetes mutation tools.
Label any tool failure clearly.
```

## 0:30-1:40 - Follow The Governed Run

Stay in OpenClaw while it works. Expand the visible tool-call cards as they
appear.

Point out:

- Splunk Observability is queried through the approved MCP integration.
- Kubernetes is read only.
- ThousandEyes reuses the existing synthetic test instead of creating one.
- The final answer preserves the evidence and recommends a next action without
  mutating the environment.

Say:

> The useful result is not only the answer. This run has a session, model,
> requests, tool activity, and token consumption. DefenseClaw records that
> operational context in the live budget ledger.

Wait for the final OpenClaw response before moving on.

## 1:40-2:40 - Inspect Usage In Tokenomics

Switch to **Tokenomics Control Plane**. Wait about 10 seconds for the OpenClaw
usage exporter, then click **Refresh**.

In the outer control plane, show:

- **Total Tokens** and request count
- **Active Agents** and sessions
- **Open Budget Alerts**, which should still be `0`

In the embedded MFE, stay on **Cost** and show:

- the live data status at the top
- total requests, tokens, cost status, and active agents
- **Current Window Spend** and token mix
- **Usage Detail**, then click the **Agent** dimension to show `main`

Open **Settings** and point to **Summary Source**. It should state that the
summary comes from the live DefenseClaw ledger.

Say:

> The browser has no gateway, observability, or Galileo credential. The BFF
> keeps those integrations server-side, while the GUI receives a live summary
> from DefenseClaw's durable budget ledger.

## 2:40-3:30 - Apply A Budget Policy In The GUI

Use the outer **Apply Local Budget Policy** form.

Enter:

| Field | Demo value |
| --- | --- |
| Agent ID | `main` |
| Agent Name | `main` |
| Action | **Deny** |
| Session Token Budget | `1` |
| Daily Token Budget | `1` |
| Cost budgets | leave blank |

The value `1` is intentionally low so the rehearsal produces a deterministic
breach. In a customer scenario, use a threshold derived from an approved budget.

Click **Apply Policy**.

Show the resulting GUI state:

- the red live-alert banner
- one or more entries in **Budget Breach Feed**
- the `deny` policy under **Current Control State**
- observed usage compared with the configured budget

Say:

> This is a live policy change, not a dashboard annotation. DefenseClaw has
> reconciled existing usage against the new threshold and armed a hard stop for
> the next matching OpenClaw request.

## 3:30-4:15 - Demonstrate Enforcement In OpenClaw

Return to OpenClaw and send this follow-up in the same chat:

```text
Re-check the TeaStore Kubernetes pod status in read-only mode and summarize
only what changed since the previous check.
```

Show the DefenseClaw budget-control denial in the chat instead of a new tool
result.

Say:

> The requested action is read only, but the agent has exceeded the budget we
> just assigned. DefenseClaw evaluates budget state before the next model or
> tool operation, so the control follows the agent across interfaces.

If the request proceeds, return to Tokenomics and verify that the policy targets
agent `main`, the action is **Deny**, and an open alert is visible. Click
**Refresh**, then retry the OpenClaw follow-up.

## 4:15-4:50 - Review The Evidence In Tokenomics

Return to Tokenomics and click **Refresh**.

Walk through the embedded MFE tabs:

1. **Cost** - show **Open Budget Alerts** and **Live Runtime Evidence**.
2. **Budget** - show **Policy State**, recommendations, and
   **Effective Policies**.
3. **Controls** - show **Top Consumers Under Watch**,
   **Open Budget Signals**, and recommended actions.
4. **Settings** - reiterate that the source is the live DefenseClaw ledger.

Say:

> Cisco Cloud Control brings consumption, policy, and runtime evidence into one
> operator flow. OpenClaw performs the work, DefenseClaw measures and enforces,
> and Tokenomics explains why the control fired.

## 4:50-5:00 - Close

Return to the top of the Tokenomics page.

Say:

> The closed loop is straightforward: conduct work in OpenClaw, measure the
> resulting usage, apply a budget in Cisco Cloud Control, and enforce it in
> DefenseClaw before the next operation. That is governed autonomy with a live
> cost and control plane.

## GUI Cleanup

After the audience segment, clean up through the Tokenomics GUI:

1. If no `main` policy existed before the demo, find agent `main` under
   **Current Control State** and click **Release**.
2. If a `main` policy did exist, use **Apply Local Budget Policy** to restore
   the recorded action and budget values.
3. Click **Refresh** and confirm the one-token policy is gone. The control state
   should now match the presenter notes, or contain no `main` policy when none
   existed before the demo.
4. Return to OpenClaw and resend the read-only follow-up if you want to show
   that normal operation resumes under the restored control state.

Do not leave the deterministic one-token policy active after the demo.

## Automated Playwright Validation

The same GUI flow is automated in
`bundles/c3_agent_tokenomics/mfe_prebuilt/e2e/tokenomics-openclaw-live.spec.js`.
It preserves any existing `main` policy, runs the OpenClaw chat, validates the
ledger update and GUI policy enforcement, releases the test policy, and restores
the original policy in cleanup.

```bash
cd bundles/c3_agent_tokenomics/mfe_prebuilt
cd e2e
npm install
npx playwright install chromium
cd ..

export TOKENOMICS_MFE_HOST="$(kubectl -n defenseclaw-tokenomics get svc c3-agent-tokenomics-mfe -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')"
export OPENCLAW_GATEWAY_TOKEN="$(kubectl -n defenseclaw get secret defenseclaw-secrets -o jsonpath='{.data.OPENCLAW_GATEWAY_TOKEN}' | base64 --decode)"
TOKENOMICS_UI_URL="http://${TOKENOMICS_MFE_HOST}/?view=tokenomics" \
npm run test:e2e:live
```

Use `PW_HEADFUL=1` on the final command to watch the automated presenter flow.
