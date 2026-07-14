# Deskside AI Resilience Prebuilt Demo

This package includes a prebuilt `dist/` directory, so you do not need to run
`npm install`.

## Run

```bash
./run-prebuilt-tokenomics-demo.sh
```

Then open:

```text
http://127.0.0.1:3001/?view=tokenomics
```

Without additional configuration, the runner starts:

- the prebuilt MFE on `http://127.0.0.1:3001`
- the fixture tokenomics API on `http://127.0.0.1:8787`

For the live control path, point the same runner at the internal BFF:

```bash
TOKENOMICS_BFF_URL="http://127.0.0.1:8788" ./run-prebuilt-tokenomics-demo.sh
```

The UI serves its live API proxy on same-origin port `3001` for usage, alerts,
budget apply/release, and Agent Controls operations. Local port `8787` remains
available as a direct API endpoint for diagnostics. Upstream requests fail with
a bounded `502` or `504` response instead of hanging indefinitely.

The shell has seven focused operator pages:

- `http://127.0.0.1:3001/fleet` for AMD Deskside inventory and posture.
- `http://127.0.0.1:3001/agent-behavior` for modeled agent outcomes and exceptions.
- `http://127.0.0.1:3001/budgets` for Adoption, Cost, and Budget tabs. The
  header identifies live or fixture ledger provenance, while fleet adoption and
  cost cards remain explicitly modeled; live policies and alerts stay on Budget.
- `http://127.0.0.1:3001/infrastructure` for CPU, memory, GPU, network, power,
  and energy telemetry shaped like a Splunk Observability response.
- `http://127.0.0.1:3001/agent-controls` for the 100K chat guardrail, exact
  command approvals, and the capability-level agent policy preview.
- `http://127.0.0.1:3001/policy-studio` for natural-language security and trust
  intent, constrained guardrail generation, operator inspection, and safe staging.
- `http://127.0.0.1:3001/network-security` for the scripted malicious-skill and
  simulated ISE/Catalyst containment vignette.

Exact command approvals do not approve every command from the same executable,
and built-in dangerous-command checks still win. Exact tool allow entries are
shown only under **Advanced details** because they bypass routine inspection;
they are not workspace, network, or identity permissions. The demo UI allows
operators to remove these exceptions but not create new ones.

## Notes

- Requires Node.js 18+.
- Fixture mode keeps budget policies and command/tool approvals in memory so the
  controls can be rehearsed. State resets on restart and is not enforced by a
  DefenseClaw runtime. The EKS deployment uses live DefenseClaw data with fixture
  fallback disabled.
- Policy Studio fixture generation is deterministic and explicitly labeled.
  Staging records an unauthenticated demo acknowledgment only in process memory
  and never changes live enforcement.
- Press `Ctrl+C` in the terminal to stop both servers.
