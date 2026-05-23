Incident INC-TEASTORE-001 - Degraded teaStore web UI (teastore-webui)

Executive summary
- On-call alert tied to teastore-webui degradation. Validated with read-only checks across Splunk Observability Cloud (O11y), Kubernetes namespace, and ThousandEyes (TE) evidence. No changes were made. Any remediation would require explicit operator approval.

1) Splunk O11y evidence
- Environment: teastore (APM scope confirmed)
- Services (teastore namespace):
  - teastore-webui-v1
    - Health: Ok
    - Requests: ~2,485,911 in last 24h
    - Errors: 503 total
    - Latency (P50): ~9.2 ms; P90: ~36.9 ms; P99: ~157 ms
    - Trace Analyzer link available for deeper trace exploration around teastore-webui-v1
  - teastore-image-v1
    - Health: Ok
    - Requests: ~3,395,926
    - Errors: 101
    - Latency: P50 ~0.69 ms; P90 ~1.55 ms
  - teastore-auth
    - Health: Ok
    - Requests: ~1,890,259
    - Errors: 0
  - teastore-persistence
    - Health: Ok
    - Requests: ~9,952,049
  - teastore-recommender
    - Health: Ok
    - Requests: ~965,983
  - teastore-registry
    - Health: Ok
    - Requests: ~1,799,286
- Observations from O11y:
  - teastore-webui-v1 carries non-zero error count (503) but overall service health is reported as Ok.
  - The other core services show healthy latency and zero or low error counts.
  - There is a Trace Analyzer linkage to further inspect traces for teastore-webui-v1 and other services in the teastore environment.
- APM overview link for teastore environment is present (APM dashboard).

2) Kubernetes evidence
- Namespace: teastore (assumed from on-call scope)
- Pods (teastore namespace status snapshot):
  - teastore-auth-5dcb6f9c5b-w8q6z — Running, ready 1/1, age 8d
  - teastore-db-55799888-ghdt4 — Running
  - teastore-image-v1-66d9fd4bd5-455sz — Running
  - teastore-loadgen-6d5b6999bd-hrwcx — Running
  - teastore-persistence-5c8d998b64-hpsv5 — Running
  - teastore-recommender-8d56bd6bf-h8czk — Running
  - teastore-registry-7c56d7866b-l7l7h — Running
  - teastore-webui-v1-56cbff64cf-xq9l8 — Running
- Observations:
  - teastore-webui-v1 pods are running with a long RPO (131-138 restarts historically for some pods). The web UI pod shows 131 restarts, indicating instability or rollouts but currently running. This could be relevant to degraded UI perception; need to correlate with request errors and latency.
  - Overall pod health appears Running for critical components, but the elevated restart count on webui pod is notable.
- Note: No mutating actions performed; all checks were read-only.

3) ThousandEyes evidence
- ThousandEyes built-in dashboards observed:
  - Agent Alerts
  - Network Layer
  - HTTP Server
  - Page Load
  - General ThousandEyes built-in
  - Internet Insights built-in
- teastore-related signals from TE (24h window, matching environment teastore):
  - teastore-webui-v1 similar service observed in O11y
  - teastore-webui-v1: Throughput and latency reasonable (P50 ~9.22 ms; P90 ~36.89 ms); error count detected (503) in O11y aligns with possible TE alerts if configured for teastore-webui-v1
  - teastore-image-v1, teastore-auth, teastore-persistence, and others show healthy metrics with low error rates in TE traces
- Trace and path data:
  - Trace Analyzer links exist per service to inspect traces around teastore-webui-v1, teastore-image-v1, etc.
- Observations:
  - TE dashboards show normal functioning for most services, but the teastore-webui-v1 path may have intermittent issues manifesting as 503 errors in O11y.
  - No TE tests or agents explicitly reported as down in the snapshot; more granular path or test-level data could reveal intermittent problems in specific routes.

4) Recommended next step (read-only)
- Break down the teastore-webui degradation:
  - Use O11y Trace Analyzer for teastore-webui-v1 with the existing trace filters to identify latency contributors, error traces, and failed spans around the 503 error instances.
  - Correlate 503 errors with specific endpoints of teastore-webui-v1 (e.g., login, dashboard load, assets API calls) to identify whether backend calls fail or time out.
  - Check pod restart history for teastore-webui-v1 to see if restarts align with spikes in error counts; review recent rollout or image changes in the web UI deployment.
  - Inspect the teastore-persistence and teastore-auth services for bottlenecks or transient timeouts that could cascade into the UI.
- Cross-check Kubernetes-level signals (read-only):
  - Confirm CPU/memory pressure on the teastore-webui-v1 deployment and its replica set; consider investigating HPA configuration and resource requests/limits if restart frequency correlates with load.
- ThousandEyes follow-up (read-only):
  - Review any recent endpoint-to-server or HTTP-server anomalies for teastore-webui-v1 in TE dashboards, particularly around the 24h window when 503s occurred.
  - Look for recent synthetic test results or alerts tied to teastore-webui-v1 that could indicate performance regressions or network issues.
- If degradation persists after correlating traces and path data, proceed with written action only after operator approval.

5) Approval-gated actions (proposed but not executed)
- If remediation seems necessary, the following actions would require operator approval:
  - Action: Scale out/in the teastore-webui-v1 deployment (e.g., adjust replicas) to address perceived load-related degradation.
    - Why: If high restart rate or saturation is suspected, additional instances may relieve pressure.
  - Action: Roll back a recent teastore-webui-v1 deployment image or rollback a recent change.
    - Why: If a recent deployment introduced instability or increased error rate.
  - Action: Patch or reconfigure the teastore-webui-v1 deployment (resource requests/limits, readiness/liveness probes, or temporary feature flags) to stabilize behavior.
    - Why: To address suspected misconfig or resource contention.
  - Action: Explicitly scale or modify related backend services (teastore-auth or teastore-persistence) if traces indicate backend latency or timeouts impacting UI path.
    - Why: To alleviate chain of latency/errors causing UI degradation.
- Note: I have not executed any of these; I will present exact commands/plan_hashes for operator approval if you want to proceed. Examples of exact planned steps would be provided in the form of dry-run plan hashes and the exact Kubernetes/CI commands to apply, along with the necessary safety checks and confirmation.

Concise incident report wrap-up
- Splunk O11y evidence: 503 errors detected for teastore-webui-v1 with P50 latency ~9 ms and P90 ~37 ms; trace analyzer available; multiple services healthy overall; teastore-webui-v1 shows restart activity in pods.
- Kubernetes evidence: teastore namespace present; teastore-webui-v1 pod has a notable restart history; other core pods Running; no mutating changes performed in read-only mode.
- ThousandEyes evidence: TE dashboards indicate normal service health for most components; potential alignment between 503s and UI path; path visualization and trace tools available for deeper dive.
- Recommended next step (read-only): perform targeted trace/path analysis for teastore-webui-v1, correlate 503s with backend services, and review recent pod restart history; continue to monitor TE observations and O11y traces.
- Approval-gated actions: if remediation is deemed necessary, provide explicit plan_hash-based commands for operator approval before execution (scaling, rollback, resource adjustments, probes, or backend reconfig).

If you’d like, I can draft a precise plan_hash-based write plan for any of the approval-gated actions (e.g., “scale deployment teastore-webui-v1 to 3 replicas,” or “rollback teastore-webui-v1 to previous image”) and present it for operator approval.
