# Deskside AI Resilience Bundle

This bundle contains the Deskside AI Resilience API contract, sample payloads,
and prebuilt micro-frontend handoff assets for Cisco Cloud Control.

## Contents

- `openapi/` - live tokenomics, budget-control, Agent Control, and Policy Studio API contract.
- `samples/` - safe sample rows for O11y token metrics and Galileo runtime controls.
- `mfe_prebuilt/` - prebuilt Deskside AI Resilience MFE package from the
  pragmatic-clarity handoff.
- [`C3_AGENT_TOKENOMICS_DEMO_SCRIPT.md`](../../docs/C3_AGENT_TOKENOMICS_DEMO_SCRIPT.md) -
  live EKS preflight and five-minute presenter script.
- [`AMD_DESKSIDE_DEMO_SCRIPT.md`](../../docs/AMD_DESKSIDE_DEMO_SCRIPT.md) - the
  three-vignette Deskside AI Resilience stage flow.
- [`AMD_DESKSIDE_CLOUD_CONTROL_PRODUCT_MODEL.md`](../../docs/AMD_DESKSIDE_CLOUD_CONTROL_PRODUCT_MODEL.md) -
  Deskside AI Resilience fleet identity, policy, tokenomics, and ISE/Catalyst
  design contract.

## Run The Prebuilt MFE

The prebuilt package does not require `npm install`.

```bash
cd bundles/c3_agent_tokenomics/mfe_prebuilt
./run-prebuilt-tokenomics-demo.sh
```

Then open:

```text
http://127.0.0.1:3001/?view=tokenomics
```

Without `TOKENOMICS_BFF_URL`, the runner starts a mutable in-memory rehearsal API
on port `8787`. Budget policies and command/tool approvals can be changed through
the UI, but they reset when the runner stops and do not enforce anything outside
the demo process.

With `TOKENOMICS_BFF_URL`, the runner proxies the live DefenseClaw-backed BFF,
including budget apply/release and Agent Controls list/allow/remove operations.
Open the focused pages at `/fleet`, `/budgets`, `/agent-controls`, `/policy-studio`,
and `/network-security`.
