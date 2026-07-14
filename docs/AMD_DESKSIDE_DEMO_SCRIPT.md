# Deskside AI Resilience Demo Script

This is the short stage flow the Deskside AI Resilience MFE is designed to
support in Cloud Control. It uses three vignettes and keeps live telemetry,
modeled scenario values, and blueprint benchmarks visibly separate.

## Presenter preflight

Open the MFE at `/fleet`. Confirm:

- **Fleet** shows AMD Ryzen AI Halo beside Cisco C9550 core and C9350 access.
- **Tokenomics** loads the live DefenseClaw ledger and the Lemonade comparison is labeled **Demo · not telemetry**.
- **Network Security** says **simulated connector** and **Automatic isolation** starts in Monitor mode.
- `DSK-AUS-017` is Critical but not isolated. If it is isolated, click **Reset vignette**.

The local repeatability test runs the complete flow and resets it:

```bash
cd bundles/c3_agent_tokenomics/mfe_prebuilt
npm test
npm run test:e2e:demo
```

## Vignette 1 — The hardware story (10–15 seconds)

Open **Fleet**.

Show the hardware strip:

- AMD Ryzen AI Halo — on-desk local inference.
- Cisco C9550 core + C9350 access — the campus backbone and enforcement edge for agentic AI.
- “Two companies’ hardware. One employee desk.”

Say:

> This isn't a rack in a data center or a tenant in someone else's cloud—it's hardware that sits right where the work happens. AMD's compute handles local inference, while Cisco's next-generation access switching handles constant agent traffic and network policy. Two companies' hardware, one desk.

Briefly point to the source bar: fleet inventory and routing mix are a demo scenario; the token ledger is live from the connected resident DefenseClaw agent.

## Vignette 2 — Tokenomics made visible

Open **Tokenomics**.

1. Under **Same agent task, a smaller cloud footprint**, click **Run agent task**.
2. Let the visible task counter finish at the frontier-only baseline.
3. Point out **Tests passed · same staged outcome**.
4. Turn on **Lemonade semantic router**. The comparison reruns automatically.
5. Show the local/cloud split, smaller cloud-token counter, and unchanged staged outcome.

Say:

> Every one of these calls has a cost, and most IT teams have never been able to see it at task level. Here is the token footprint for this staged coding task. Now we turn on Lemonade intelligent routing between local AMD compute and an approved frontier fallback. The same staged task finishes with a much smaller cloud footprint. Multiply that by every device, every day, and the payback becomes visible.

Do not present the scenario values as measured production savings. The demo disclosure keeps them separate until the working AMD/Lemonade build exports validated task telemetry. The Tokenomics header identifies the separate DefenseClaw ledger provenance.

## Vignette 3 — One policy, everywhere, instantly

Open **Network Security**.

1. Show **Enterprise Agent Safety** across three planes: AMD AXIS sandbox, every tool call, and ISE + C9350 network response.
2. Turn on **Automatically isolate a Deskside after a critical Agent Control policy breach**.
3. Under **“Meeting Notes Pro” looks useful—until it acts**, click **Run malicious skill**.
4. Walk left to right through the green stages:
   - AXIS contains the skill.
   - Tool policy denies credential access.
   - Cloud Control requests the configured ISE ANC policy.
   - ISE produces the simulated RADIUS CoA acknowledgement.
   - C9350 changes the Deskside to remediation-only access.
5. Show `DSK-AUS-017` as Isolated and the four correlated lifecycle cards.

Say:

> Someone adds a skill they think is harmless. The moment it attempts credential access and unapproved egress, the same Cloud Control policy contains it in the sandbox, blocks its tool call, and isolates the Deskside on the network so nothing spreads. That is one policy, written once, enforced at every layer.

If time allows, point to **Blueprint benchmark** and say:

> This level of protection barely costs anything in dispatch speed: AXIS measured 1.739 milliseconds against a 1.702 millisecond near-native baseline—15 to 20 times lower enforcement latency than the prior Firecracker path.

The UI labels this as a blueprint benchmark, not live page telemetry. ISE and C9350 actions are also explicitly simulated until a production integration is connected.

## Reset after every run

1. Click **Reset vignette**. This reloads the pristine demo inventory, original evidence timeline, and Monitor-mode policy.
2. Confirm **Automatic isolation** reads Monitor.
3. Return to **Fleet** and confirm only the pre-seeded demo device remains isolated.

Disabling automatic isolation never restores an already isolated device. Restore remains a separate audited action.

## Optional/open — infrastructure observability

Only add an infrastructure-level observability segment when engineering confirms the intended data source and story. It is not required for the three-vignette flow and should not displace the Tokenomics or one-policy containment moments.
