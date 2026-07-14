# Deskside AI Resilience Product Model

## Product intent

Deskside AI Resilience gives an enterprise one place in Cloud Control to decide
where AMD Deskside AI work runs, how much it may spend, what workload agents may
do, and when a high-risk Deskside must lose enterprise network access.

The default route should be **Fleet Overview** (`/fleet`), not Budgets. The primary operator object is the managed Deskside fleet; tokenomics, workload-agent controls, and network enforcement are views and policies over that fleet.

## Identity and responsibility

Each managed Deskside runs exactly one logical **DefenseClaw resident agent**. It is the local policy enforcement and telemetry component. It is not an employee workload agent and must not be counted in active-agent, task, or model-consumption totals.

Each Deskside can run zero or more **workload agents**, such as Employee Assistant, Code Builder, or Research Agent. Those agents perform employee tasks through local AMD models, frontier cloud models, tools, and files. DefenseClaw observes and enforces their actions.

```text
Enterprise tenant
└── Fleet
    └── Fleet group / department / site
        └── AMD Deskside endpoint
            ├── Employee assignment
            ├── DefenseClaw resident agent (exactly one logical instance)
            └── Workload agents (zero or more)
                └── Task / chat / session
                    ├── Model request
                    └── Tool or file action
```

Stable identity should include:

| Level | Required identity |
|---|---|
| Enterprise | `tenant_id` |
| Fleet scope | `fleet_id`, optional `group_id`, `site_id`, `department_id` |
| Deskside | `device_id` plus a managed endpoint identity; MAC and IP are observations, not the durable primary key |
| Resident control | `defenseclaw_instance_id`, enrolled device certificate identity, desired and applied policy versions |
| Employee | Enterprise subject ID; display name is presentation data |
| Workload agent | `workload_agent_id` and, when concurrent copies exist, `workload_agent_instance_id` |
| Execution | `task_id`, `session_id`, `trace_id`, and model/tool action IDs |

Fleet metrics must name both populations explicitly, for example **24 DefenseClaw protections reporting** and **67 active workload agents**. A generic “Active Agents: 91” is misleading.

## Operator information architecture

Use five real pages with a shared scope and time bar:

1. **Fleet Overview** (`/fleet`) — managed Desksides, protection coverage, AI execution mix, policy posture, and recent incidents.
2. **AI Usage** (`/usage`) — local versus cloud work, provider/model consumption, priced cloud spend, and top consumers.
3. **Budgets & Routing** (`/budgets`) — inherited limits, allowed models, local-first routing, and breach behavior.
4. **Agent Control** (`/agent-controls`) — workload-agent capabilities, exact command approvals, file boundaries, and network response.
5. **Incidents** (`/incidents`) — evidence and the DefenseClaw-to-ISE-to-C9350 enforcement timeline.

The scope bar should always answer: **which Desksides are affected, which policy version is desired, how many have applied it, and which data is live or simulated**.

## Tokenomics and model routing

Tokenomics covers workload-agent activity, not DefenseClaw's own control traffic. Operators should be able to view and control by fleet, group, device, employee, workload agent, task, provider, and model.

The core execution dimensions are:

- **AMD local:** on-device inference. Show tasks, tokens where meaningful, inference time, and hardware utilization. Do not label it as economically free merely because cloud API spend is `$0`.
- **OpenAI, Claude, and Gemini:** frontier cloud inference. Show priced spend, requests, tokens, and policy status.
- **Unknown or unpriced:** show `Unpriced`, never `$0.00`.

Routing controls should be phrased as operator intent:

- Prefer AMD local models.
- Keep restricted data on the Deskside.
- Allow approved frontier models for complex tasks.
- Ask for approval before an unapproved cloud route.
- On budget breach: switch to an approved local/lower-cost model, ask for approval, or stop the task.

Budget scope should support fleet, group, device, employee, workload agent, and task. Effective policy resolution should be visible. Mandatory enterprise protections cannot be weakened by a child scope; permitted settings may be specialized by group, device, or workload agent. Each policy change needs operator identity, reason, version, affected-device count, and resident-agent acknowledgements.

## Agent Control semantics

Security controls apply to workload agents and are enforced locally by the resident DefenseClaw instance.

- **Commands:** approvals match an exact normalized command. Approving `git status` does not approve `git push`. Dangerous-command rules always win.
- **Files:** separate the operation capability from the path boundary. An agent may be allowed to edit code only inside approved workspaces while system, credential, and secret paths remain blocked.
- **Control states:** use `Allowed`, `Ask first`, and `Blocked`. Low-level tool names such as `read`, `write`, `edit`, and `apply_patch` belong under Advanced details.
- **External access:** distinguish public web, approved APIs, enterprise applications, cloud-model egress, and local-only data classes.
- **Policy precedence:** immutable platform protections, then enterprise baseline, then permitted group/device/agent specialization. The UI must identify inherited controls and exceptions.

Plain-language labels should lead, with technical terms secondary: **Stop the task** (`deny`), **Switch models** (`steer`), **Remove limit** (`release policy`), and **Isolate from the enterprise network** (`quarantine`).

## Budget versus security response

Cost pressure and security risk are separate signals. A token or dollar limit must not, by itself, quarantine a Deskside.

| Condition | Local workload response | Cloud Control response | Network response |
|---|---|---|---|
| Near budget limit | Continue or prefer local | Notify and show forecast | None |
| Token or cost limit exceeded | Switch model, ask, or stop the task | Budget alert | None; keep device connected |
| Unapproved command or model | Ask or block action | Security event | None by default |
| Sensitive-path or data-boundary attempt | Block action; optionally suspend workload agent | High-severity incident | None unless promoted by a critical policy/correlation |
| Critical tampering, credential exfiltration, or repeated critical behavior | Block and suspend affected workload agents | Critical incident | Automatic isolation when explicitly enabled |
| Operator selects **Isolate now** | Stop or contain workload activity | Audited manual action | Request ISE ANC quarantine |

## Automatic isolation behavior

The featured toggle should be **Automatically isolate critical security breaches**. Its safe default is **Off / Monitor**.

Enabling it must:

1. Show scope and affected count.
2. Explain that critical security incidents can restrict enterprise access while preserving remediation and Cloud Control connectivity.
3. Require confirmation, operator identity, and a reason.
4. Update a versioned desired policy and show resident-agent/ISE readiness acknowledgements.

For the demo, the threshold is fixed at `CRITICAL`. Enabling the toggle affects future qualifying incidents; it does not retroactively isolate devices already awaiting review. Those retain an explicit **Isolate now** action. Disabling the toggle prevents future automatic isolation and **does not restore devices already isolated**. Restoration is a separate, confirmed, audited action after remediation.

Never render a live-success state optimistically. Distinguish `Monitor`, `Policy pushing`, `Armed`, `Isolation requested`, `ISE accepted`, `C9350 enforced`, `Partially applied`, and `Failed`.

## Cisco ISE ANC and C9350 enforcement

Cloud Control does not directly configure a switch for each incident. The intended enforcement chain is:

```text
Workload-agent violation
        ↓
Resident DefenseClaw blocks locally and emits signed evidence
        ↓
Cloud Control evaluates the fleet response policy
        ↓
Cisco ISE ANC assigns the quarantine policy to the endpoint/session
        ↓
ISE sends RADIUS Change of Authorization to the C9350 NAD
        ↓
C9350 reauthorizes the endpoint and applies restricted access
        ↓
Acknowledgements update the Cloud Control incident timeline
```

The ISE authorization result may use a downloadable ACL, SGT/TrustSec policy, VLAN, or another deployment-specific profile. The product contract is **remediation-only access**, not one hard-coded switch mechanism. Endpoint resolution should use the managed device identity plus current ISE session observations such as MAC, NAS, switch, and port.

Restoration is the symmetric flow: Cloud Control requests restore, ISE removes or replaces the ANC policy, ISE issues CoA, C9350 reapplies standard authorization, and Cloud Control records observed enforcement. The UI may say **Isolated** only after authoritative acknowledgement; before that it says **Isolation requested** or **Pending network enforcement**.

## Three-vignette demo contract

The demo should tell one continuous story in three vignettes. Each vignette must retain its own evidence and provenance instead of combining physical topology, modeled economics, blueprint claims, and live DefenseClaw observations into one apparent live dataset.

### 1. Physical AMD Deskside and Cisco network

Lead with the physical environment: an **AMD Ryzen AI Halo** Deskside runs employee workload agents and one resident DefenseClaw instance, and reaches the enterprise through a **Cisco C9350 campus access switch** and **Cisco C9550 core/aggregation layer**. This establishes that local inference and network enforcement are attached to a real endpoint rather than an abstract cloud agent.

The operator story is:

1. Workload agents perform assistant, code, and research tasks on the Deskside.
2. AMD local models handle suitable work without sending it to a frontier provider.
3. The resident DefenseClaw instance observes and enforces all workload-agent actions on that Deskside.
4. Cloud Control associates the durable `device_id` with current ISE session and C9350 attachment observations.
5. ISE remains the network policy decision point and C9350 remains the network enforcement point.

The UI may name the physical Ryzen AI Halo, Cisco C9350 access, and Cisco C9550 core hardware as the **demo topology**. It may call their health, utilization, port state, or packet telemetry live only when those sources are actually connected.

### 2. Lemonade semantic routing and tokenomics

The **Lemonade semantic routing** vignette demonstrates why a task runs locally or on an approved frontier model. Cloud Control supplies fleet intent, Lemonade selects an eligible route using task fit and policy, DefenseClaw enforces and records the route, and Tokenomics explains the outcome.

The route explanation should expose:

- Data sensitivity: local-only, cloud-eligible, or approval required.
- Task fit: routine/local, code/long-context, or complex frontier reasoning.
- Budget state: within budget, near limit, rerouted, or stopped.
- Selected destination: AMD local, OpenAI, Claude, or Gemini.
- Decision reason and the effective policy version.

All routing percentages, task counts, provider costs, and estimated savings used to make this vignette visually rich are **modeled scenario values** unless derived from connected fleet telemetry. For example, the current demo's `68% local` and `$842.18 estimated cloud cost avoided` values must appear inside a panel labeled **Lemonade routing scenario**, not in a card labeled live fleet telemetry. The estimate also needs a visible methodology note.

If live DefenseClaw data is shown in the same session, present it in a separate **Live DefenseClaw telemetry** panel with its own scope and timestamp. Never project one live Deskside's token count across the modeled 24-device fleet.

### 3. Malicious skill, local containment, and network isolation

The security vignette shows defense in depth rather than one oversized “blocked” event:

```text
Malicious skill runs in the AMD AXIS sandbox
        ↓
Sandbox contains the workload execution
        ↓
DefenseClaw tool-call policy denies the dangerous action
        ↓
Resident DefenseClaw emits a correlated critical incident
        ↓
Cloud Control critical-isolation policy evaluates the device
        ↓
ISE ANC assigns quarantine and C9350 restricts network access
```

The incident timeline must identify each boundary independently: AXIS sandbox result, DefenseClaw tool-call decision, workload-agent suspension, Cloud Control response decision, ISE ANC assignment, CoA result, and C9350 observed authorization. Local skill/file quarantine and endpoint network isolation are different actions and should not share an ambiguous `Quarantined` status.

The current ISE/C9350 steps remain **Simulated ISE/C9350 workflow** until a production integration returns authoritative acknowledgements. The AXIS and DefenseClaw steps likewise say **Live**, **Scripted replay**, or **Demo** according to their actual source.

The supplied performance values belong in a visibly separate callout:

> **Blueprint benchmark — not live telemetry:** 1.739 ms sandboxed versus 1.702 ms baseline. The blueprint also states that the sandbox is 15–20× faster than Firecracker.

These are blueprint benchmark claims, not measurements taken by this app, the current Deskside, or the current demo run. Preserve the benchmark's metric labels and source when they are available; do not convert the values into a live KPI, current timestamp, health state, or fleet aggregate. The UI/API should use `source_mode: "blueprint_benchmark"` for this callout.

### Optional infrastructure observability

Infrastructure observability is **optional/open**, not a prerequisite for the three-vignette story and not a completed integration claim. Connected sources could later add Ryzen AI utilization, thermal or inference telemetry, ISE session health, C9350 interface state, CoA latency, and packet/network evidence. Until connected, the UI should show **Optional integration** or **Not connected**, and the demo should rely only on endpoint, policy, and enforcement evidence whose source is known.

## Truthful demo and live-data labels

Every response and event must carry its provenance. The UI should use these exact meanings:

- **Live DefenseClaw telemetry:** usage or enforcement evidence read from an enrolled resident DefenseClaw instance.
- **Demo fleet inventory:** fixture devices, employees, or fleet totals.
- **Simulated ISE/C9350 workflow:** no production ISE ANC request or C9350 CoA/enforcement occurred.
- **Live network enforcement:** ISE accepted the action and observed network state was returned through an integrated source.
- **Lemonade routing scenario:** scenario-only routing mix, costs, and savings; not derived from live fleet activity.
- **Blueprint benchmark:** supplied reference measurements or comparison claims; not measured during this demo.
- **Scripted replay:** a deterministic previously defined event sequence, not a currently occurring incident.
- **Stale** or **Unavailable:** the source has exceeded its freshness threshold or cannot be reached.

Mixed mode is allowed, but sources must not be blended invisibly. In particular, live single-Deskside token totals must not be presented as totals for a fixture fleet. Simulated timeline rows and device states should say **Simulated**, and an integration must not appear `Connected` merely because a demo endpoint can return a successful fixture mutation.

## Suggested API contract

Keep the existing `/v1/c3/agent-tokenomics` root and add fleet-scoped resources:

```text
GET   /fleet/summary?scope_type=&scope_id=&window=
GET   /fleet/devices?scope_type=&scope_id=&status=&cursor=
GET   /fleet/devices/{device_id}
GET   /security/policies/effective?scope_type=&scope_id=
PATCH /security/policies/{policy_id}
GET   /security/incidents?scope_type=&scope_id=&status=&cursor=
POST  /fleet/devices/{device_id}/network-actions
GET   /network/actions/{action_id}
GET   /integrations/network/status
```

Policy mutation:

```json
{
  "expected_version": 12,
  "auto_isolate": {
    "enabled": true,
    "severity_threshold": "CRITICAL",
    "scope": { "type": "fleet", "id": "amd-deskside-enterprise-pilot" }
  },
  "reason": "Enable critical-event containment",
  "requested_by": "operator-subject-id"
}
```

Network action mutation:

```json
{
  "action": "isolate",
  "reason": "Critical credential-exfiltration incident",
  "incident_id": "inc-01842",
  "idempotency_key": "network-action-inc-01842-isolate"
}
```

The server, not the browser, resolves MAC, ISE endpoint/session, NAS, switch, and port. A mutation returns `action_id`, `state: requested`, policy version, source mode, and links to status; it does not claim immediate enforcement.

Security and network events need a common envelope:

```json
{
  "schema_version": "c3.amd_deskside_event.v1",
  "event_id": "evt-...",
  "event_type": "catalyst.authorization.enforced",
  "correlation_id": "inc-01842",
  "action_id": "neta-...",
  "occurred_at": "2026-07-08T21:42:15Z",
  "received_at": "2026-07-08T21:42:16Z",
  "tenant_id": "tenant-...",
  "fleet_id": "amd-deskside-enterprise-pilot",
  "device_id": "DSK-SJC-022",
  "defenseclaw_instance_id": "dc-...",
  "workload_agent_id": "code-builder",
  "session_id": "sess-...",
  "trace_id": "trace-...",
  "policy_id": "amd-deskside-critical-quarantine",
  "policy_version": 12,
  "severity": "CRITICAL",
  "decision": "isolate",
  "reason_code": "credential_exfiltration",
  "source_mode": "live",
  "network": {
    "ise_policy": "AMD-DESKSIDE-QUARANTINE",
    "nad_id": "C9350-SJC-03",
    "port": "Gi1/0/22",
    "coa_result": "accepted",
    "enforcement_state": "remediation_only"
  }
}
```

Events must be durable, idempotent, ordered by correlation/action rather than wall-clock assumptions, and able to represent requested, accepted, enforced, failed, timed-out, and restored states.

For UI-facing responses and events, `source_mode` should distinguish at least `live`, `fixture`, `illustrative`, `scripted_replay`, `simulated`, and `blueprint_benchmark`. A source mode is attached to each datum or coherent panel, not only once at page level.

## Four-minute demo workflow

1. **0:00 — Physical fleet:** begin on Fleet Overview with the AMD Ryzen AI Halo Deskside and Cisco C9550 core / C9350 access demo topology. Show 24 managed Desksides, 24 resident DefenseClaw protections, and 67 active workload agents; explain that the resident agent protects the other agents.
2. **0:40 — Lemonade routing:** open AI Usage and route a representative employee task. Explain the local-versus-frontier decision and keep `68% local`, provider costs, and estimated savings inside the visibly labeled **Lemonade routing scenario**.
3. **1:30 — Budget behavior:** enable the 100K chat stop and explain that budget pressure reroutes or stops the workload session but never isolates the Deskside from the network.
4. **2:00 — Malicious skill:** replay or execute the malicious-skill vignette. Show AMD AXIS containment followed by the DefenseClaw tool-call denial. If the benchmark callout is shown, label 1.739 ms versus 1.702 ms and the blueprint's 15–20× faster-than-Firecracker claim as **Blueprint benchmark — not live telemetry**.
5. **2:50 — Network response:** enable **Automatically isolate critical security breaches**, confirm the 24-device scope, then use the critical incident's explicit **Isolate now** action because the toggle is not retroactive. Show the separately labeled simulated ISE ANC, RADIUS CoA, and C9350 remediation-only steps.
6. **3:40 — Close the loop:** show the complete correlated timeline and restore the simulated device or return to Fleet Overview. Mention infrastructure observability as an optional future integration, not as a dependency or live claim.

## Production gaps

The current demo proves the UX and mutation contract, not production fleet enforcement. Production still requires:

- Device enrollment, certificate identity, and a durable one-resident-agent-per-Deskside registry.
- Secure policy distribution with desired/applied versions, acknowledgements, offline reconciliation, staged rollout, and rollback.
- Device-to-employee, workload-agent, usage, and current ISE-session correlation.
- Fleet-scoped policy storage, inheritance, exceptions, and conflict handling.
- Real ISE ANC authentication, endpoint lookup, idempotent assignment/removal, retry, and rate-limit behavior.
- Authoritative C9350 enforcement evidence and timeout/failure reconciliation.
- Durable incident/action state machines, event deduplication, replay protection, and high availability.
- RBAC, separation of duties, approval workflows, immutable audit, and reason capture for fleet or network changes.
- Remediation verification before restore and safeguards that preserve the management/remediation plane.
- Provider pricing/version metadata and truthful on-device compute accounting.
- Privacy, retention, and regional controls for employee, prompt, code, and incident evidence.
- End-to-end validation against an ISE/C9350 lab, including CoA failure, stale sessions, endpoint movement, offline Desksides, and partial fleet rollout.
