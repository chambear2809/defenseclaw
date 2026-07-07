# Cisco Cloud Control Agent Tokenomics Bundle

This bundle contains the Cisco Cloud Control-facing Agent Tokenomics contract,
sample payloads, and prebuilt micro-frontend handoff assets.

## Contents

- `openapi/` - live tokenomics summary, alert, policy, and apply/release API contract.
- `samples/` - safe sample rows for O11y token metrics and Galileo runtime controls.
- `mfe_prebuilt/` - prebuilt DefenseClaw Agent Tokenomics MFE package from the
  pragmatic-clarity handoff.
- [`C3_AGENT_TOKENOMICS_DEMO_SCRIPT.md`](../../docs/C3_AGENT_TOKENOMICS_DEMO_SCRIPT.md) -
  live EKS preflight and five-minute presenter script.

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

Without `TOKENOMICS_BFF_URL`, the runner starts a read-only fixture API on port
`8787`. With `TOKENOMICS_BFF_URL`, it proxies the live DefenseClaw-backed BFF,
including budget policy apply and release operations.
