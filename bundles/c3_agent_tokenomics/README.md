# Cisco Cloud Control Agent Tokenomics Bundle

This bundle contains the Cisco Cloud Control-facing Agent Tokenomics contract,
sample payloads, and prebuilt micro-frontend handoff assets.

## Contents

- `openapi/` - read-only tokenomics summary API contract.
- `samples/` - safe sample rows for O11y token metrics and Galileo runtime controls.
- `mfe_prebuilt/` - prebuilt DefenseClaw Agent Tokenomics MFE package from the
  pragmatic-clarity handoff.

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

The runner starts the static MFE on port `3001` and a fixture tokenomics API on
port `8787`.
