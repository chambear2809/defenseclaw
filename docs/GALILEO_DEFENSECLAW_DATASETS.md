# Galileo DefenseClaw Demo Datasets

These datasets are for demonstrating DefenseClaw runtime governance in Galileo
SaaS without using the unrelated Cisco Cloud Control demo path.

The datasets live in `datasets/galileo/*.jsonl`. Each row uses Galileo's standard dataset fields:

- `input`: prompt variables for the DefenseClaw runtime governance prompt.
- `ground_truth`: expected behavior for correctness and context-adherence checks.
- `metadata`: scenario labels, expected Agent Control match, expected action, stage, and suggested Galileo metrics.

The reusable prompt template is `prompts/galileo/defenseclaw-runtime-governance.md`.

The repo-owned Agent Flow prompt/test block for the enterprise TeaStore flow is
`prompts/galileo/enterprise-ops-agent-flow.md`.

It is also uploaded to Galileo SaaS as prompt
`defenseclaw-enterprise-ops-agent-flow` with ID
`ce2a5908-bc6c-45e0-89e7-cd498d6ed870` in the current demo-v2 Galileo
tenant.

The Galileo Playground recipe is `playgrounds/galileo/defenseclaw-runtime-governance.playground.json`.

These assets are the primary Galileo Agent Watch / experiment-review path for
the DefenseClaw K8 demo. They are separate from the Cisco Cloud Control
tokenomics demo.

## Dataset Set

- `defenseclaw-safe-ops`
- `defenseclaw-prompt-injection-pre-llm`
- `defenseclaw-dangerous-tool-pre-tool`
- `defenseclaw-pii-post-llm`
- `defenseclaw-ambiguous-admin-intent`
- `defenseclaw-grounded-cluster-review`
- `defenseclaw-enterprise-ops-thousandeyes`

## Upload

Install the Galileo SDK in a temporary environment, then upload the datasets and prompt template:

```bash
python3 -m venv /tmp/defenseclaw-galileo-upload
/tmp/defenseclaw-galileo-upload/bin/python -m pip install --upgrade pip galileo

export GALILEO_SECRET_KEY="${GALILEO_SECRET_KEY:-GALILEO_DEMO_V2_API_KEY}"
export GALILEO_API_KEY="$(kubectl -n defenseclaw get secret defenseclaw-secrets -o "jsonpath={.data.${GALILEO_SECRET_KEY}}" | base64 --decode)"
GALILEO_CONSOLE_URL="https://console.demo-v2.galileocloud.io" \
GALILEO_API_URL="https://api.demo-v2.galileocloud.io" \
/tmp/defenseclaw-galileo-upload/bin/python scripts/upload_galileo_demo_datasets.py \
  --ensure-project defenseclaw-enterprise-ops-20260515 \
  --log-stream-name defenseclaw-enterprise-ops-20260515 \
  --include-agent-flow-prompt
```

The uploader skips datasets that already exist by name unless
`--update-existing-datasets` is supplied. Pass `--create-duplicates` only when
you intentionally want a new copy.

## Current Demo-v2 Galileo Upload

Console project: `https://console.demo-v2.galileocloud.io/project/ef0960e1-8744-4019-9faa-103b13f94e0d`

Experiments: `https://console.demo-v2.galileocloud.io/project/ef0960e1-8744-4019-9faa-103b13f94e0d/experiments`

Project: `defenseclaw-enterprise-ops-20260515`

Project ID: `ef0960e1-8744-4019-9faa-103b13f94e0d`

Log stream ID: `7d3fa020-621d-4164-aa4a-96b600663c92`

| Artifact | Galileo ID | Role |
| --- | --- | --- |
| `defenseclaw-safe-ops` | `ed48fe0e-a27e-4011-a461-aa6cc4022101` | Baseline read-only K8 operations that should pass. |
| `defenseclaw-prompt-injection-pre-llm` | `9ebcc5f7-a133-4da6-a762-9cafcaa22711` | Maps to `observe-prompt-injection-pre-llm`. |
| `defenseclaw-dangerous-tool-pre-tool` | `4a60a2a7-55eb-42c1-96cf-b9bf7e6710a4` | Maps to `deny-dangerous-shell-pre-tool`; best bridge to `/api/v1/inspect/tool`. |
| `defenseclaw-pii-post-llm` | `18716fff-2c83-40e8-9c72-43520e63e3a4` | Maps to `steer-pii-post-llm`. |
| `defenseclaw-ambiguous-admin-intent` | `894bfeea-274c-4639-9d21-e7bb1d53f48b` | Shows approval-seeking behavior for risky admin requests. |
| `defenseclaw-grounded-cluster-review` | `82505136-42a9-4eab-932b-2e7903ee23fa` | Validates K8 facts, especially `isovalent-demo` and namespace `defenseclaw`. |
| `defenseclaw-enterprise-ops-thousandeyes` | `4d89a5d8-1e7f-421d-b742-cadb6e000c68` | Enterprise closed loop across Splunk O11y, ThousandEyes, K8s remediation, Splunk Enterprise, Galileo, and shadow-first Autonomy SLO. |
| `defenseclaw-runtime-governance` prompt | `096341e8-05c8-4c8f-9e39-12155a61a8ad` | Runtime governance prompt template. |
| `defenseclaw-enterprise-ops-agent-flow` prompt | `ce2a5908-bc6c-45e0-89e7-cd498d6ed870` | Agent Flow metric/test block for the TeaStore incident flow. |

Selected runtime-governance prompt version: `2`

Selected runtime-governance prompt version ID: `8ebe7696-a235-49f7-88bf-1d5abb3645d7`

Selected enterprise agent-flow prompt version: `2`

Selected enterprise agent-flow prompt version ID: `4400f9ef-699f-4812-b6a3-ae39cc35a08d`

Prompt variables: `user_prompt`, `cluster_context`, `agent_name`, `guardrail_mode`

The latest upload artifact is `artifacts/galileo_enterprise_ops_sync_20260523T041607Z.json`.

## Previous Hosted Galileo SaaS Upload

Console project: `https://app.galileo.ai/project/0ba7b20d-8262-44c4-b230-547a0cd74b2b`

Experiments: `https://app.galileo.ai/project/0ba7b20d-8262-44c4-b230-547a0cd74b2b/experiments`

Project: `clus-demo`

Project ID: `0ba7b20d-8262-44c4-b230-547a0cd74b2b`

Log stream ID: `82b893bd-fa1f-411e-81e8-e12ca66692ad`

| Artifact | Galileo ID | Role |
| --- | --- | --- |
| `defenseclaw-safe-ops` | `1cb6a564-91f8-4c4a-a4b8-9ee9e44e5fdb` | Baseline read-only K8 operations that should pass. |
| `defenseclaw-prompt-injection-pre-llm` | `8633dc49-c9f0-4179-b7be-a9c371910eba` | Maps to `observe-prompt-injection-pre-llm`. |
| `defenseclaw-dangerous-tool-pre-tool` | `fa039b81-a70a-41cd-aacd-4e3c5e2488fe` | Maps to `deny-dangerous-shell-pre-tool`; best bridge to `/api/v1/inspect/tool`. |
| `defenseclaw-pii-post-llm` | `810e5961-5bef-4615-8280-180238b6f1ac` | Maps to `steer-pii-post-llm`. |
| `defenseclaw-ambiguous-admin-intent` | `6a404e8b-5952-44d8-aa4c-7362b319ecca` | Shows approval-seeking behavior for risky admin requests. |
| `defenseclaw-grounded-cluster-review` | `c750e742-59d6-47e0-bc99-c8721386e9eb` | Validates K8 facts, especially `isovalent-demo` and namespace `defenseclaw`. |
| `defenseclaw-enterprise-ops-thousandeyes` | `a706d5bf-e96d-447a-a461-1f3648331b27` | Enterprise closed loop across Splunk O11y, ThousandEyes, K8s remediation, Splunk Enterprise, and Galileo. |
| `defenseclaw-runtime-governance` prompt | `1a327ae4-264d-4036-80f6-f8a424158a91` | Runtime governance prompt template. |

Selected prompt version: `3`

Selected prompt version ID: `45463b63-7f60-44fe-9820-cf7afe58014e`

Prompt variables: `user_prompt`, `cluster_context`, `agent_name`, `guardrail_mode`

Local validation on May 10, 2026 confirmed the dry-run planners reference the
prompt, the dataset recipe, the selected prompt version, and the
runtime-evidence experiment targets. The enterprise ThousandEyes dataset was
validated end to end on May 14, 2026 against TeaStore, DefenseClaw, Splunk
Enterprise, and ThousandEyes.

On May 14, 2026, the uploader synced all seven datasets into Galileo SaaS in
place. The SaaS copy had 15 enterprise TeaStore rows under dataset ID
`a706d5bf-e96d-447a-a461-1f3648331b27`. The repo copy now has 16 rows after
adding the shadow-first Autonomy SLO branch; rerun the uploader before relying
on that row in Galileo SaaS.

## Credential Setup

For the live lab, get the Galileo API key from the `defenseclaw` namespace
without printing it:

```bash
export GALILEO_API_KEY="$(kubectl -n defenseclaw get secret defenseclaw-secrets -o jsonpath='{.data.GALILEO_API_KEY}' | base64 --decode)"
export GALILEO_PROJECT="defenseclaw-enterprise-ops-20260515"
export GALILEO_PROJECT_ID="ef0960e1-8744-4019-9faa-103b13f94e0d"
export GALILEO_LOG_STREAM="defenseclaw-enterprise-ops-20260515"
export GALILEO_LOG_STREAM_ID="7d3fa020-621d-4164-aa4a-96b600663c92"
export GALILEO_CONSOLE_URL="https://console.demo-v2.galileocloud.io"
export GALILEO_API_URL="https://api.demo-v2.galileocloud.io"
```

Install the SDK into a temporary environment if the repo environment does not
already have it:

```bash
python3 -m venv /tmp/defenseclaw-galileo-upload
/tmp/defenseclaw-galileo-upload/bin/python -m pip install --upgrade pip galileo
```

## Saved Playground

Galileo's console Playground is configured from existing project assets. The
demo-v2 tenant has a saved enterprise Playground that should be updated in
place rather than recreated:

```text
https://console.demo-v2.galileocloud.io/project/ef0960e1-8744-4019-9faa-103b13f94e0d/playgrounds/e969b856-9d5d-48a4-90af-b33e20fe6fab
```

The repo carries the exact Playground recipe so the SaaS setup is repeatable:

```bash
cat playgrounds/galileo/defenseclaw-runtime-governance.playground.json
```

Dry-run the saved Playground patch without the Galileo SDK or API token:

```bash
./.venv/bin/python scripts/configure_galileo_saved_playground.py --dry-run
```

When tokens are restored, patch the existing saved Playground with the latest
enterprise dataset version, prompt body, prompt version, model settings, and
scorer configs. In the live lab, the easy path reads the Galileo key from the
existing Kubernetes secret after SSO:

```bash
duo-sso

./.venv/bin/python scripts/configure_galileo_saved_playground.py \
  --execute \
  --use-k8s-secret \
  --allow-token-missing
```

Use `--allow-token-missing` during quota/token outages; the command records a
redacted skipped artifact instead of failing the demo prep.

Console fallback:

1. Open Galileo project `defenseclaw-enterprise-ops-20260515`.
2. Open saved Playground `defenseclaw-enterprise-ops-thousandeyes-playground`.
3. Select prompt `defenseclaw-runtime-governance` and confirm the editor shows
   the prompt body from `prompts/galileo/defenseclaw-runtime-governance.md`.
4. Select dataset `defenseclaw-enterprise-ops-thousandeyes`, latest version.
5. Add the enterprise dataset's `default_metrics`; keep row-level metrics such
   as `correctness` and `output_pii` when the scorer catalog exposes them.
6. Run the Playground and log the result as an experiment when provider quota
   is available.

The recipe uses model alias `gpt-4.1-nano` with temperature `0.2`, max tokens
`700`, and top_p `1.0`. The metric names are aligned with each JSONL row's
`metadata.galileo_metrics`; use `tool_errors` and `output_pii` where those are
the row-level metrics.

The code-backed equivalent can dry-run the experiment setup:

```bash
/tmp/defenseclaw-galileo-upload/bin/python scripts/run_galileo_playground_experiment.py --all
```

To start a real Galileo experiment for one dataset:

```bash
GALILEO_API_KEY="$(kubectl -n defenseclaw get secret defenseclaw-secrets -o jsonpath='{.data.GALILEO_API_KEY}' | base64 --decode)" \
GALILEO_CONSOLE_URL="https://console.demo-v2.galileocloud.io" \
GALILEO_API_URL="https://api.demo-v2.galileocloud.io" \
/tmp/defenseclaw-galileo-upload/bin/python scripts/run_galileo_playground_experiment.py \
  --dataset defenseclaw-dangerous-tool-pre-tool \
  --execute
```

The prompt-runner path requires Galileo's configured OpenAI integration to have quota. On May 10, 2026, the configured OpenAI integration returned `insufficient_quota`, so prompt-runner experiments could be created but could not complete until that provider key is refreshed.

## Working Runtime Evidence Experiments

The local-function runner logs deterministic DefenseClaw/Agent Control behavior into Galileo without calling an external LLM. This keeps the demo working even when the Playground model provider is out of quota:

```bash
GALILEO_API_KEY="$(kubectl -n defenseclaw get secret defenseclaw-secrets -o jsonpath='{.data.GALILEO_API_KEY}' | base64 --decode)" \
GALILEO_CONSOLE_URL="https://console.demo-v2.galileocloud.io" \
GALILEO_API_URL="https://api.demo-v2.galileocloud.io" \
/tmp/defenseclaw-galileo-upload/bin/python scripts/run_galileo_runtime_evidence_experiment.py \
  --all \
  --metric-family luna \
  --execute
```

Current demo-v2 Enterprise Ops experiment:

| Dataset | Experiment ID | Console link |
| --- | --- | --- |
| `defenseclaw-enterprise-ops-thousandeyes` | `b1d20128-4e55-4f3f-999b-f4962491c5e5` | `https://console.demo-v2.galileocloud.io/project/ef0960e1-8744-4019-9faa-103b13f94e0d/experiments/b1d20128-4e55-4f3f-999b-f4962491c5e5` |

Completed experiment set:

| Dataset | Experiment ID | Console link |
| --- | --- | --- |
| `defenseclaw-safe-ops` | `25777783-d6e3-47fa-ba8b-fda125366a96` | `https://app.galileo.ai/project/0ba7b20d-8262-44c4-b230-547a0cd74b2b/experiments/25777783-d6e3-47fa-ba8b-fda125366a96` |
| `defenseclaw-prompt-injection-pre-llm` | `b559e317-da6d-4ba4-be9e-203612880ecb` | `https://app.galileo.ai/project/0ba7b20d-8262-44c4-b230-547a0cd74b2b/experiments/b559e317-da6d-4ba4-be9e-203612880ecb` |
| `defenseclaw-dangerous-tool-pre-tool` | `5481b4e6-bee9-40d6-b45a-29912f66a94c` | `https://app.galileo.ai/project/0ba7b20d-8262-44c4-b230-547a0cd74b2b/experiments/5481b4e6-bee9-40d6-b45a-29912f66a94c` |
| `defenseclaw-pii-post-llm` | `c94b8a41-2d8d-44db-935c-4b02721e92e5` | `https://app.galileo.ai/project/0ba7b20d-8262-44c4-b230-547a0cd74b2b/experiments/c94b8a41-2d8d-44db-935c-4b02721e92e5` |
| `defenseclaw-ambiguous-admin-intent` | `c06da073-07f9-4a89-90a0-aea0a9e517c1` | `https://app.galileo.ai/project/0ba7b20d-8262-44c4-b230-547a0cd74b2b/experiments/c06da073-07f9-4a89-90a0-aea0a9e517c1` |
| `defenseclaw-grounded-cluster-review` | `f77143fc-fa4b-4be0-9249-6af39ee8357b` | `https://app.galileo.ai/project/0ba7b20d-8262-44c4-b230-547a0cd74b2b/experiments/f77143fc-fa4b-4be0-9249-6af39ee8357b` |
| `defenseclaw-enterprise-ops-thousandeyes` | `a8ac7be0-6431-449b-a089-c8431d99de70` | `https://app.galileo.ai/project/0ba7b20d-8262-44c4-b230-547a0cd74b2b/experiments/a8ac7be0-6431-449b-a089-c8431d99de70` |
| `defenseclaw-enterprise-ops-thousandeyes` latest SaaS 15-row sync | `f74208cd-462a-4f56-b1e4-51f1cda991d7` | `https://app.galileo.ai/project/0ba7b20d-8262-44c4-b230-547a0cd74b2b/experiments/f74208cd-462a-4f56-b1e4-51f1cda991d7` |

The current demo-v2 enterprise ThousandEyes experiment was refreshed during
live validation on May 23, 2026.

## Live TeaStore Validation

The current TeaStore enterprise incident run anchors the executive demo:

| Artifact | ID |
| --- | --- |
| Demo-v2 runtime-evidence experiment | `b1d20128-4e55-4f3f-999b-f4962491c5e5` |
| Prior 5-row Galileo experiment | `a8ac7be0-6431-449b-a089-c8431d99de70` |
| ThousandEyes HTTP Server test | `8597876` |
| Galileo project | `defenseclaw-enterprise-ops-20260515` / `ef0960e1-8744-4019-9faa-103b13f94e0d` |
| Galileo log stream | `7d3fa020-621d-4164-aa4a-96b600663c92` |

The test name is `defenseclaw-demo-teastore-k8s`, and the target URL is:

```text
http://teastore-webui.teastore.svc.cluster.local:8080/tools.descartes.teastore.webui/
```

Repeated TeaStore runs should reuse TE test ID `8597876` when the URL and
Kubernetes Enterprise Agent still match.

## Luna-2 Metrics

Use Luna-2 for high-volume scoring of the TeaStore incident rows. The runtime
experiment runner has a metric-name mapper and passes explicit metrics into
`run_experiment`. Use:

```bash
python3 scripts/run_galileo_runtime_evidence_experiment.py \
  --dataset defenseclaw-enterprise-ops-thousandeyes \
  --metric-family luna
```

For the enterprise dataset, the runner adds `action_advancement` and
`action_completion` even if a row-level metric list omits them. Supported Luna
enum mappings are:

| Metric name | Luna enum |
| --- | --- |
| `action_advancement` | `GalileoMetrics.action_advancement_luna` |
| `action_completion` | `GalileoMetrics.action_completion_luna` |
| `context_adherence` | `GalileoMetrics.context_adherence_luna` |
| `prompt_injection` | `GalileoMetrics.prompt_injection_luna` |
| `tool_errors` | `GalileoMetrics.tool_error_rate_luna` |
| `tool_selection_quality` | `GalileoMetrics.tool_selection_quality_luna` |

Metrics without a documented Luna enum, including `agent_flow`,
`instruction_adherence`, `correctness`, and `output_pii`, continue to use the
standard Galileo enum.

In the previous hosted `clus-demo` tenant, the Luna SLM scorer labels are not enabled
for experiments yet. The runner resolves requested Luna metrics against the live
SaaS scorer catalog and falls back to the available standard scorer names. It
also keeps session-only metrics such as `agent_flow` and `action_completion` in
the Playground/session recipe, but excludes them from deterministic experiments
because Galileo rejects them for experiment runs.

## Live Session Logging

The demo CLI can log one Galileo Session named from `INC-TEASTORE-001`:

```bash
PYTHONPATH=cli python -m defenseclaw.main demo enterprise-ops \
  --format json \
  --live-o11y-mcp \
  --live-inspect \
  --live-thousandeyes \
  --execute-thousandeyes-create \
  --approved \
  --live-galileo-session \
  --allow-galileo-unavailable \
  --ticket-id INC-TEASTORE-001
```

The session contains the full operator path: `O11y detect`, `K8s read`,
`ThousandEyes inventory`, `DefenseClaw inspect`, `TE create/reuse`,
`Remediation proposal`, `Unsafe action block`, `Splunk audit closure`, and
`Autonomy SLO`.

## Splunk Export And Agent Control Handoff

Use the local Splunk/Cisco skills for live Galileo and Agent Control wiring
instead of duplicating that automation in this repo. Render and validate first:

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

When credentials and provider quota are restored, use those skills' rendered
export/HEC and Agent Control sink commands to validate Splunk ingestion. Keep
Galileo payloads redacted by default and use `sourcetype=galileo:observe:json`
unless the Splunk tenant has a stricter sourcetype standard.

## Demo Flow

1. Run `defenseclaw-safe-ops` to show normal read-only cluster operations.
2. Run `defenseclaw-prompt-injection-pre-llm` to show prompt-injection detection before the LLM step.
3. Run `defenseclaw-dangerous-tool-pre-tool` to show Agent Control deny decisions before shell/tool execution.
4. Run `defenseclaw-pii-post-llm` to show post-LLM steering/redaction behavior.
5. Run `defenseclaw-ambiguous-admin-intent` to show approval-seeking behavior for risky admin requests.
6. Run `defenseclaw-grounded-cluster-review` to show correctness and context adherence around the live `isovalent-demo` cluster.
7. Run `defenseclaw-enterprise-ops-thousandeyes` to show the full Splunk O11y, ThousandEyes, K8s remediation, Splunk Enterprise, and Galileo story.
