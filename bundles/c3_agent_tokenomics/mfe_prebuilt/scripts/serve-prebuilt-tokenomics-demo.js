const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { randomUUID } = require("crypto");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const shellDir = path.join(rootDir, "shell");
const embeddedLiveDir = path.join(rootDir, "embedded_live");
const fixturePath = process.env.TOKENOMICS_FIXTURE_PATH
  ? path.resolve(process.env.TOKENOMICS_FIXTURE_PATH)
  : path.join(rootDir, "fixtures", "tokenomics-summary-runtime-governance.json");
const fleetFixturePath = process.env.TOKENOMICS_FLEET_FIXTURE_PATH
  ? path.resolve(process.env.TOKENOMICS_FLEET_FIXTURE_PATH)
  : path.join(rootDir, "fixtures", "amd-deskside-fleet.json");
const fleetAnalyticsFixturePath = process.env.TOKENOMICS_FLEET_ANALYTICS_FIXTURE_PATH
  ? path.resolve(process.env.TOKENOMICS_FLEET_ANALYTICS_FIXTURE_PATH)
  : path.join(rootDir, "fixtures", "tokenomics-fleet-analytics.json");
const fleetInfrastructureFixturePath = process.env.TOKENOMICS_FLEET_INFRASTRUCTURE_FIXTURE_PATH
  ? path.resolve(process.env.TOKENOMICS_FLEET_INFRASTRUCTURE_FIXTURE_PATH)
  : path.join(rootDir, "fixtures", "splunk-o11y-infrastructure.json");
const rowFixturePath = process.env.TOKENOMICS_ROWS_FIXTURE_PATH
  ? path.resolve(process.env.TOKENOMICS_ROWS_FIXTURE_PATH)
  : fs.existsSync(path.join(rootDir, "samples", "o11y_token_metric_rows.json"))
    ? path.join(rootDir, "samples", "o11y_token_metric_rows.json")
    : path.resolve(rootDir, "..", "samples", "o11y_token_metric_rows.json");
const tokenomicsBffUrl = process.env.TOKENOMICS_BFF_URL ? new URL(process.env.TOKENOMICS_BFF_URL) : null;
const host = process.env.HOST || "127.0.0.1";
const appPort = Number(process.env.MFE_PORT || 3001);
const apiPort = Number(process.env.API_PORT || 8787);
const configuredBffTimeoutMs = Number(process.env.TOKENOMICS_BFF_TIMEOUT_MS || 7000);
const tokenomicsBffTimeoutMs = Number.isFinite(configuredBffTimeoutMs)
  ? Math.min(Math.max(configuredBffTimeoutMs, 100), 30000)
  : 7000;
const configuredPolicyStudioBffTimeoutMs = Number(process.env.POLICY_STUDIO_BFF_TIMEOUT_MS || 30000);
const policyStudioBffTimeoutMs = Number.isFinite(configuredPolicyStudioBffTimeoutMs)
  ? Math.min(Math.max(configuredPolicyStudioBffTimeoutMs, 1000), 30000)
  : 30000;
const fixtureControlState = {
  alerts: [],
  allowed: [
    { id: "fixture-command-git-status", target_type: "command", target_name: "git status", reason: "Read-only repository status", updated_at: new Date().toISOString() },
    { id: "fixture-command-git-diff", target_type: "command", target_name: "git diff", reason: "Read-only repository changes", updated_at: new Date().toISOString() },
    { id: "fixture-tool-read", target_type: "tool", target_name: "read", reason: "Read workspace files", updated_at: new Date().toISOString() },
    { id: "fixture-tool-edit", target_type: "tool", target_name: "edit", reason: "Edit workspace files", updated_at: new Date().toISOString() },
  ],
  policies: [],
};
const fleetOverviewPath = "/v1/c3/agent-tokenomics/fleet/overview";
const fleetAnalyticsPath = "/v1/c3/agent-tokenomics/fleet/analytics";
const fleetInfrastructurePath = "/v1/c3/agent-tokenomics/fleet/infrastructure";
const fleetDemoResetPath = "/v1/c3/agent-tokenomics/fleet/demo/reset";
const securityPolicyPath = "/v1/c3/agent-tokenomics/security/policy";
const policyStudioDraftPath = "/v1/c3/agent-tokenomics/policy-studio/drafts";
const policyStudioApplyPattern = /^\/v1\/c3\/agent-tokenomics\/policy-studio\/drafts\/([^/]+)\/apply$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const desksideActionPattern = /^\/v1\/c3\/agent-tokenomics\/fleet\/desksides\/([^/]+)\/network-action$/;
const infrastructureWindows = new Map([["-1h", 1], ["-6h", 6], ["-24h", 24]]);
const infrastructureResolutions = new Map([["1h", 1], ["6h", 6]]);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "access-control-allow-headers": "authorization,content-type,x-c3-tenant,x-c3-token-stage",
    "access-control-allow-methods": "GET,OPTIONS,POST",
    "access-control-allow-origin": "*",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body, null, 2));
}

function normalizeUuid(value, name) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(value || ""));
  } catch (_error) {
    throw policyStudioFixtureError(`${name} must be a valid UUID`);
  }
  if (!uuidPattern.test(decoded)) {
    throw policyStudioFixtureError(`${name} must be a valid UUID`);
  }
  return decoded.toLowerCase();
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    request.on("data", (chunk) => {
      if (settled) {
        return;
      }
      size += chunk.length;
      if (size > 64 * 1024) {
        settled = true;
        const error = new Error("request body exceeds 65536 bytes");
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) {
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        const value = JSON.parse(raw);
        settled = true;
        resolve(value && typeof value === "object" && !Array.isArray(value) ? value : {});
      } catch (error) {
        settled = true;
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function fixturePolicy(payload) {
  const agentId = String(payload.agent_id || "").trim();
  if (!agentId) {
    const error = new Error("agent_id is required");
    error.statusCode = 400;
    throw error;
  }
  return {
    policy_id: `fixture-budget:${agentId}`,
    agent_id: agentId,
    agent_name: String(payload.agent_name || agentId),
    session_token_budget: Number(payload.session_token_budget || 0),
    daily_token_budget: Number(payload.daily_token_budget || 0),
    session_cost_budget_usd: Number(payload.session_cost_budget_usd || 0),
    daily_cost_budget_usd: Number(payload.daily_cost_budget_usd || 0),
    action: payload.action === "steer" ? "steer" : "deny",
    updated_at: new Date().toISOString(),
    updated_by: String(payload.updated_by || "fixture-tokenomics-ui"),
    source: String(payload.source || "fixture-tokenomics-ui"),
    fixture_backed: true,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function utcNow() {
  return new Date().toISOString();
}

function loadFleetDemoState() {
  const state = JSON.parse(fs.readFileSync(fleetFixturePath, "utf8"));
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("AMD Deskside fleet fixture must be an object");
  }
  if (!state.security_policy || typeof state.security_policy !== "object" || Array.isArray(state.security_policy)) {
    throw new Error("AMD Deskside security policy fixture must be an object");
  }
  state.security_policy.policy_id ||= "amd-deskside-critical-quarantine";
  state.security_policy.version ||= 1;
  state.security_policy.simulated = true;
  state.security_policy.integration_state ||= "demo-ready";
  state.demo = state.demo && typeof state.demo === "object" && !Array.isArray(state.demo) ? state.demo : {};
  state.demo.inventory_is_fixture = true;
  state.demo.network_actions_are_simulated = true;
  state.fleet = state.fleet && typeof state.fleet === "object" && !Array.isArray(state.fleet) ? state.fleet : {};
  state.fleet.network_action_count ||= 0;
  state.devices = Array.isArray(state.devices) ? state.devices : [];
  state.enforcement_events = Array.isArray(state.enforcement_events) ? state.enforcement_events : [];
  return state;
}

function loadFleetAnalytics() {
  const payload = JSON.parse(fs.readFileSync(fleetAnalyticsFixturePath, "utf8"));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("fleet analytics fixture must be an object");
  }
  for (const name of ["debug", "scope", "disclosure", "dimensions", "adoption", "cost"]) {
    if (!payload[name] || typeof payload[name] !== "object" || Array.isArray(payload[name])) {
      throw new Error(`fleet analytics ${name} must be an object`);
    }
  }
  for (const [section, names] of [
    ["dimensions", ["providers", "models", "teams", "users", "agents"]],
    ["adoption", ["provider_totals", "daily_active_users", "team_provider_matrix"]],
    ["cost", ["daily_provider_cost", "detail_rows"]],
  ]) {
    for (const name of names) {
      const rows = payload[section][name];
      if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
        throw new Error(`fleet analytics ${section}.${name} must be an array of objects`);
      }
    }
  }
  for (const section of ["adoption", "cost"]) {
    const summary = payload[section].summary;
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
      throw new Error(`fleet analytics ${section}.summary must be an object`);
    }
  }
  const projection = payload.cost.organization_projection;
  if (!projection || typeof projection !== "object" || Array.isArray(projection)) {
    throw new Error("fleet analytics cost.organization_projection must be an object");
  }
  for (const name of [
    "basis_window_days",
    "annualization_weeks",
    "modeled_non_halo_developers",
    "modeled_non_halo_cloud_tokens",
    "modeled_non_halo_estimated_cost_usd",
  ]) {
    if (!Number.isFinite(projection[name])) {
      throw new Error(`fleet analytics cost.organization_projection.${name} must be numeric`);
    }
  }
  // Preserve an explicit boundary between modeled fleet analytics and
  // the live DefenseClaw gateway ledger exposed by the summary endpoints.
  payload.source = "amd_deskside_demo_scenario";
  payload.debug.fixture_backed = true;
  payload.disclosure.status = "illustrative";
  payload.adoption.status = "illustrative";
  payload.cost.status = "illustrative";
  return payload;
}

function loadFleetInfrastructure() {
  const payload = JSON.parse(fs.readFileSync(fleetInfrastructureFixturePath, "utf8"));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Splunk O11y infrastructure fixture must be an object");
  }
  for (const name of ["debug", "disclosure", "scope", "fleet_summary", "series"]) {
    if (!payload[name] || typeof payload[name] !== "object" || Array.isArray(payload[name])) {
      throw new Error(`Splunk O11y infrastructure ${name} must be an object`);
    }
  }
  if (!Array.isArray(payload.devices)) {
    throw new Error("Splunk O11y infrastructure devices must be an array");
  }
  for (const metric of [
    "cpu_utilization",
    "memory_utilization",
    "gpu_utilization",
    "network_receive",
    "network_transmit",
    "power",
  ]) {
    if (!Array.isArray(payload.series[metric])) {
      throw new Error(`Splunk O11y infrastructure series.${metric} must be an array`);
    }
  }
  payload.source = "splunk_o11y_synthetic_demo";
  payload.debug.fixture_backed = true;
  payload.debug.synthetic = true;
  payload.disclosure.status = "synthetic";
  return payload;
}

function oneInfrastructureQueryValue(searchParams, name, defaultValue) {
  const values = searchParams.getAll(name);
  if (values.length > 1) {
    const error = new Error(`${name} must be provided at most once`);
    error.statusCode = 400;
    throw error;
  }
  return values.length ? values[0].trim() : defaultValue;
}

function selectedInfrastructureSummary(device) {
  const metrics = device.metrics;
  const selected = (name, method) => ({
    ...cloneJson(metrics[name]),
    method,
    coverage: device.stale ? "selected device is stale" : "1 of 1 selected device",
  });
  return {
    avg_cpu_utilization: selected("cpu_utilization", "selected device current value"),
    avg_memory_utilization: selected("memory_utilization", "selected device current value"),
    avg_gpu_utilization: selected("gpu_utilization", "selected device current value"),
    avg_network_link_utilization: selected("network_link_utilization", "selected device current value"),
    total_network_receive: selected("network_receive", "selected device current value"),
    total_network_transmit: selected("network_transmit", "selected device current value"),
    current_power: selected("power", "selected device current value"),
    energy_24h: selected("energy_24h", "selected device historical total"),
    energy_7d: selected("energy_7d", "selected device historical total"),
    reporting_devices: device.stale ? 0 : 1,
    stale_devices: device.stale ? 1 : 0,
  };
}

function fleetInfrastructureResponse(baseline, searchParams) {
  const window = oneInfrastructureQueryValue(searchParams, "window", "-24h");
  const resolution = oneInfrastructureQueryValue(searchParams, "resolution", "1h");
  const deviceId = oneInfrastructureQueryValue(searchParams, "device_id", "");
  if (!infrastructureWindows.has(window)) {
    const error = new Error("window must be one of -1h, -6h, or -24h");
    error.statusCode = 400;
    throw error;
  }
  if (!infrastructureResolutions.has(resolution)) {
    const error = new Error("resolution must be 1h or 6h");
    error.statusCode = 400;
    throw error;
  }
  if (deviceId && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(deviceId)) {
    const error = new Error("device_id must be 1-128 letters, numbers, dots, underscores, or hyphens");
    error.statusCode = 400;
    throw error;
  }

  const payload = cloneJson(baseline);
  const selectedDevice = deviceId
    ? payload.devices.find((device) => device.device_id === deviceId)
    : null;
  if (deviceId && !selectedDevice) {
    const error = new Error("infrastructure device not found");
    error.statusCode = 404;
    error.responseBody = { error: error.message, device_id: deviceId };
    throw error;
  }

  payload.scope.window = window;
  payload.scope.resolution = resolution;
  payload.scope.device_id = deviceId || null;
  payload.debug.requested_filters = { window, resolution, device_id: deviceId || null };

  if (selectedDevice) {
    payload.devices = [selectedDevice];
    payload.fleet_summary = selectedInfrastructureSummary(selectedDevice);
    const currentBySeries = {
      cpu_utilization: "cpu_utilization",
      memory_utilization: "memory_utilization",
      gpu_utilization: "gpu_utilization",
      network_receive: "network_receive",
      network_transmit: "network_transmit",
      power: "power",
    };
    for (const [seriesName, metricName] of Object.entries(currentBySeries)) {
      const points = payload.series[seriesName];
      const currentFleetValue = points.length ? Number(points.at(-1).value) : 0;
      const currentDeviceValue = selectedDevice.metrics[metricName].value;
      payload.series[seriesName] = points.map((point) => ({
        timestamp: point.timestamp,
        value:
          currentDeviceValue === null || !Number.isFinite(currentFleetValue) || currentFleetValue === 0
            ? null
            : Math.round((Number(point.value) * Number(currentDeviceValue) / currentFleetValue) * 100) / 100,
      }));
    }
  }

  const cutoff = Date.parse(payload.generated_at) - infrastructureWindows.get(window) * 60 * 60 * 1000;
  const resolutionHours = infrastructureResolutions.get(resolution);
  for (const [seriesName, points] of Object.entries(payload.series)) {
    const withinWindow = points.filter((point) => Date.parse(point.timestamp) >= cutoff);
    payload.series[seriesName] = withinWindow
      .slice()
      .reverse()
      .filter((_point, index) => index % resolutionHours === 0)
      .reverse();
  }
  return payload;
}

function singleLineText(payload, name, defaultValue, maximum = 512) {
  if (payload[name] === undefined || payload[name] === null) return defaultValue;
  if (typeof payload[name] !== "string") {
    const error = new Error(`${name} must be a string`);
    error.statusCode = 400;
    throw error;
  }
  const value = payload[name].trim();
  if (/[\r\n\u0000]/.test(value)) {
    const error = new Error(`${name} must be one line and cannot contain NUL`);
    error.statusCode = 400;
    throw error;
  }
  if (value.length > maximum) {
    const error = new Error(`${name} must be ${maximum} characters or fewer`);
    error.statusCode = 400;
    throw error;
  }
  return value || defaultValue;
}

function rejectUnexpectedFields(payload, supported, resource) {
  const unexpected = Object.keys(payload).filter((key) => !supported.includes(key)).sort();
  if (unexpected.length) {
    const error = new Error(`unsupported ${resource} field: ${unexpected[0]}`);
    error.statusCode = 400;
    throw error;
  }
}

function policyStudioFixtureError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.responseBody = { error: message };
  return error;
}

function policyStudioFixtureShape(message) {
  const lowered = message.toLowerCase();
  const rules = [];
  if (["credential", "password", "secret", "token", "api key"].some((word) => lowered.includes(word))) {
    rules.push({
      category: "data_protection",
      condition: "An agent attempts to access, reveal, or transmit credentials or secrets.",
      decision: "block",
      severity: "critical",
      rationale: "Credentials must remain unavailable to untrusted agent actions and model context.",
    });
  }
  if (["delete", "jira", "issue", "destructive", "modify"].some((word) => lowered.includes(word))) {
    rules.push({
      category: "tool_safety",
      condition: "An agent requests a destructive or high-impact external tool action.",
      decision: ["block", "deny", "never", "delete"].some((word) => lowered.includes(word))
        ? "block"
        : "require_approval",
      severity: "high",
      rationale: "High-impact tool calls require an explicit least-privilege decision.",
    });
  }
  if (["model", "publisher", "signed", "signature", "denylist", "restricted"].some((word) => lowered.includes(word))) {
    rules.push({
      category: "model_trust",
      condition: "An agent selects a model that is unsigned, restricted, or from an unapproved publisher.",
      decision: "block",
      severity: "critical",
      rationale: "Only models with approved provenance should handle enterprise agent workloads.",
    });
  }
  if (["public", "external", "egress", "send", "transmit", "restricted data"].some((word) => lowered.includes(word))) {
    rules.push({
      category: "network_egress",
      condition: "An agent attempts to send restricted enterprise data to a public or unapproved destination.",
      decision: "require_approval",
      severity: "high",
      rationale: "External data transfer needs a human trust decision and approved destination.",
    });
  }
  if (["prompt injection", "jailbreak", "override instructions"].some((word) => lowered.includes(word))) {
    rules.push({
      category: "prompt_safety",
      condition: "Agent input attempts to override trusted policy or disclose protected instructions.",
      decision: "block",
      severity: "high",
      rationale: "Untrusted prompt content must not supersede enterprise policy.",
    });
  }
  if (!rules.length) {
    rules.push({
      category: "tool_safety",
      condition: "An agent attempts an action outside its approved operating scope.",
      decision: "require_approval",
      severity: "high",
      rationale: "Ambiguous or out-of-scope actions should pause for human review.",
    });
  }
  const uniqueRules = rules.filter(
    (rule, index, rows) => rows.findIndex((candidate) => candidate.category === rule.category) === index,
  );
  const critical = uniqueRules.some((rule) => rule.severity === "critical");
  const blocking = uniqueRules.some((rule) => rule.decision === "block");
  const names = {
    data_protection: "Credential and secret protection",
    model_trust: "Approved model provenance",
    network_egress: "Restricted data egress",
    prompt_safety: "Prompt integrity protection",
    tool_safety: "High-impact tool safety",
  };
  return {
    name: names[uniqueRules[0].category] || "Agent trust guardrail",
    summary: "Constrain agent behavior described by the operator and surface high-risk attempts for review.",
    scope: { type: "fleet", value: "AMD Deskside Pilot" },
    risk_level: critical ? "critical" : "high",
    mode: blocking ? "block" : "require_approval",
    rules: uniqueRules.slice(0, 6),
    exceptions: [],
  };
}

function createPolicyStudioFixtureDraft(payload, drafts) {
  rejectUnexpectedFields(payload, ["message", "conversation_id", "previous_draft_id"], "Policy Studio");
  if (typeof payload.message !== "string") {
    throw policyStudioFixtureError("message is required");
  }
  const message = payload.message.trim();
  if (!message) throw policyStudioFixtureError("message is required");
  if (message.includes("\u0000")) throw policyStudioFixtureError("message cannot contain NUL");
  if (message.length > 2000) throw policyStudioFixtureError("message must be 2000 characters or fewer");
  const conversationId = normalizeUuid(
    singleLineText(payload, "conversation_id", randomUUID(), 128),
    "conversation_id",
  );
  const previousDraftValue = singleLineText(payload, "previous_draft_id", "", 36);
  const previousDraftId = previousDraftValue
    ? normalizeUuid(previousDraftValue, "previous_draft_id")
    : "";
  if (previousDraftId) {
    const previous = drafts.get(previousDraftId);
    if (!previous) throw policyStudioFixtureError("previous Policy Studio draft not found", 404);
    if (previous.conversation_id !== conversationId) {
      throw policyStudioFixtureError("previous draft does not belong to this conversation", 409);
    }
  }
  const shape = policyStudioFixtureShape(message);
  const draftId = randomUUID();
  const draft = {
    id: draftId,
    conversation_id: conversationId,
    version: 1,
    status: "generated",
    created_at: utcNow(),
    ...shape,
    generation: {
      mode: "fallback",
      provider: "policy-studio-template",
      model: null,
      reason: "fixture_server",
    },
    warnings: [
      "Staging this draft does not change live DefenseClaw enforcement.",
      "The local demo uses a deterministic template; configure the approved model provider for live generation.",
    ],
  };
  draft.policy = {
    apiVersion: "cloudcontrol.cisco.com/v1alpha1",
    kind: "AgentGuardrailDraft",
    metadata: {
      name: shape.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 63),
      draftId,
    },
    spec: {
      scope: cloneJson(shape.scope),
      riskLevel: shape.risk_level,
      defaultDecision: shape.mode,
      rules: cloneJson(shape.rules),
      exceptions: [],
    },
  };
  if (drafts.size >= 100) drafts.delete(drafts.keys().next().value);
  drafts.set(draftId, cloneJson(draft));
  return {
    conversation_id: conversationId,
    assistant: {
      message: `I drafted “${draft.name}” with ${draft.rules.length} validated guardrail rule(s). Review the scope and decisions before staging it.`,
    },
    draft,
  };
}

function stagePolicyStudioFixtureDraft(draftId, payload, drafts) {
  rejectUnexpectedFields(
    payload,
    ["expected_version", "review_confirmed", "reviewed_by", "reason"],
    "Policy Studio",
  );
  if (payload.review_confirmed !== true) {
    throw policyStudioFixtureError("review_confirmed must be true before staging a guardrail");
  }
  if (!Number.isInteger(payload.expected_version) || payload.expected_version < 1) {
    throw policyStudioFixtureError("expected_version must be a positive integer");
  }
  const claimedReviewer = singleLineText(payload, "reviewed_by", "", 120);
  const reason = singleLineText(payload, "reason", "Reviewed in Policy Studio", 512);
  const draft = drafts.get(draftId);
  if (!draft) throw policyStudioFixtureError("Policy Studio draft not found", 404);
  if (draft.version !== payload.expected_version) {
    throw policyStudioFixtureError("Policy Studio draft version changed; review the latest draft", 409);
  }
  if (draft.status !== "generated") {
    throw policyStudioFixtureError("Policy Studio draft has already been staged", 409);
  }
  draft.status = "staged";
  draft.version += 1;
  draft.review = {
    confirmed: true,
    reviewed_at: utcNow(),
    reviewed_by: "Unauthenticated demo operator",
    claimed_reviewer: claimedReviewer || null,
    identity_verified: false,
    evidence_status: "demo_acknowledgement",
    reason,
  };
  drafts.set(draftId, cloneJson(draft));
  return {
    draft: cloneJson(draft),
    application: {
      status: "staged",
      enforcement_status: "not_enforced",
      persistence: "ephemeral",
      review_type: "demo_acknowledgement",
      message: "Demo acknowledgment recorded and guardrail staged for a future policy deployment workflow. No live DefenseClaw enforcement changed.",
    },
  };
}

function updateSecurityPolicy(state, payload) {
  rejectUnexpectedFields(payload, ["enabled", "expected_version", "version", "reason", "updated_by"], "security-policy");
  if (typeof payload.enabled !== "boolean") {
    const error = new Error("enabled must be a boolean");
    error.statusCode = 400;
    throw error;
  }
  const expectedVersion = payload.expected_version ?? payload.version;
  if (expectedVersion !== undefined && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
    const error = new Error("expected_version must be a positive integer");
    error.statusCode = 400;
    throw error;
  }
  const reason = singleLineText(
    payload,
    "reason",
    "Updated through Cloud Control AMD Deskside security policy",
  );
  const updatedBy = singleLineText(payload, "updated_by", "cloud-control-demo", 128);
  const policy = state.security_policy;
  const currentVersion = Number(policy.version || 1);
  if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
    const error = new Error(
      `security policy version conflict: expected ${expectedVersion}, current ${currentVersion}`,
    );
    error.statusCode = 409;
    throw error;
  }
  const changed = Boolean(policy.auto_quarantine) !== payload.enabled;
  if (changed) {
    policy.auto_quarantine = payload.enabled;
    policy.mode = payload.enabled ? "enforce" : "monitor";
    policy.version = currentVersion + 1;
    policy.updated_at = utcNow();
    policy.updated_by = updatedBy;
    policy.change_reason = reason;
  }
  policy.simulated = true;
  policy.integration_state = "demo-ready";
  return {
    ...cloneJson(policy),
    changed,
    existing_quarantines_released: false,
  };
}

function updateFleetCounts(state) {
  state.fleet.quarantined_devices = (state.devices || []).filter((device) => Boolean(device.quarantined)).length;
}

function networkActionEvents(state, device, action, reason, requestedBy) {
  const occurredAt = utcNow();
  const switchName = device.switch_name || "Cisco C9350 access switch";
  const switchPort = device.switch_port || "managed port";
  const quarantinePolicy = state.security_policy.policy_name || "AMD-DESKSIDE-QUARANTINE";
  const stages =
    action === "quarantine"
      ? [
          ["cloud-control", "Network quarantine requested", `${requestedBy} requested simulated quarantine: ${reason}`],
          ["ise", "ISE ANC policy assigned", `${quarantinePolicy} assigned to ${device.device_id}`],
          ["coa", "RADIUS CoA accepted", `${switchName} reauthorized ${switchPort}`],
          ["enforce", "C9350 restricted access", "Endpoint can reach only remediation services"],
        ]
      : [
          ["cloud-control", "Network restore requested", `${requestedBy} requested simulated restore: ${reason}`],
          ["ise", "ISE standard policy assigned", `Standard access policy assigned to ${device.device_id}`],
          ["coa", "RADIUS CoA accepted", `${switchName} reauthorized ${switchPort}`],
          ["enforce", "C9350 restored access", "Endpoint returned to its previous network access"],
        ];
  const created = [];
  for (const [stage, title, detail] of stages) {
    const event = {
      event_id: `evt-demo-${action}-${String(device.device_id).toLowerCase()}-${String(state.enforcement_events.length + 1).padStart(4, "0")}`,
      device_id: device.device_id,
      stage,
      status: "complete",
      title,
      detail,
      action,
      occurred_at: occurredAt,
      simulated: true,
    };
    state.enforcement_events.push(event);
    created.push(cloneJson(event));
  }
  return created;
}

function applyNetworkAction(state, restoreState, deviceId, payload) {
  rejectUnexpectedFields(payload, ["action", "reason", "requested_by"], "network-action");
  if (typeof payload.action !== "string" || !["quarantine", "restore"].includes(payload.action.trim().toLowerCase())) {
    const error = new Error("action must be quarantine or restore");
    error.statusCode = 400;
    throw error;
  }
  const action = payload.action.trim().toLowerCase();
  const reason = singleLineText(payload, "reason", `Simulated ${action} through Cloud Control`);
  const requestedBy = singleLineText(payload, "requested_by", "cloud-control-demo", 128);
  const device = (state.devices || []).find((row) => row.device_id === deviceId);
  if (!device) {
    const error = new Error("deskside not found");
    error.statusCode = 404;
    error.responseBody = { error: error.message, device_id: deviceId };
    throw error;
  }
  const changed =
    (action === "quarantine" && !device.quarantined) || (action === "restore" && Boolean(device.quarantined));
  let events = [];
  if (changed && action === "quarantine") {
    restoreState.set(deviceId, {
      status: device.status,
      risk: device.risk,
      model_route: device.model_route,
      ise_policy: device.ise_policy,
      network_access: device.network_access,
    });
    device.quarantined = true;
    device.status = "quarantined";
    device.risk = "quarantined";
    device.model_route = "Blocked";
    device.ise_policy = state.security_policy.policy_name || "AMD-DESKSIDE-QUARANTINE";
    device.network_access = "Remediation only";
    events = networkActionEvents(state, device, action, reason, requestedBy);
  } else if (changed) {
    const baseline = restoreState.get(deviceId) || {};
    restoreState.delete(deviceId);
    device.quarantined = false;
    device.status = baseline.status || "online";
    device.risk = baseline.risk || "review";
    device.model_route = baseline.model_route || "AMD local";
    device.ise_policy = baseline.ise_policy || "AMD-DESKSIDE-STANDARD";
    device.network_access = baseline.network_access || "Full access";
    events = networkActionEvents(state, device, action, reason, requestedBy);
  }
  updateFleetCounts(state);
  if (changed) {
    state.fleet.network_action_count = Number(state.fleet.network_action_count || 0) + 1;
    state.fleet.last_network_action_at = utcNow();
    state.generated_at = state.fleet.last_network_action_at;
  }
  return {
    action,
    changed,
    device: cloneJson(device),
    events,
    fleet: cloneJson(state.fleet),
    network_actions_are_simulated: true,
    timeline_count: state.enforcement_events.length,
  };
}

function safeResolve(baseDir, requestedPath) {
  const cleaned = requestedPath.replace(/^\/+/, "");
  const candidate = path.join(baseDir, path.normalize(cleaned));
  const relative = path.relative(baseDir, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}

function sendFile(response, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "content-type": "text/plain; charset=utf-8",
      });
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(data);
  });
}

function createFixtureApiHandler() {
  // Fleet/security mutations are intentionally process-local rehearsal state.
  // Starting a new fixture server reloads the immutable JSON baseline.
  let fleetControlState = loadFleetDemoState();
  const fleetAnalytics = loadFleetAnalytics();
  const fleetInfrastructure = loadFleetInfrastructure();
  const fleetRestoreState = new Map();
  const policyStudioDrafts = new Map();
  return async (request, response) => {
      const parsed = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);

      try {
        if (request.method === "OPTIONS") {
          writeJson(response, 204, {});
          return;
        }

        if (parsed.pathname === "/healthz") {
          writeJson(response, 200, {
            fixture: path.basename(fixturePath),
            policy_studio: { enabled: false, mode: "validated_template_fixture" },
            status: "ok",
          });
          return;
        }

        if (parsed.pathname === "/readyz") {
          writeJson(response, 200, { mode: "fixture", status: "ready" });
          return;
        }

        if (parsed.pathname === "/v1/c3/agent-tokenomics/summary") {
          const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
          fixture.debug = {
            ...(fixture.debug || {}),
            fixture_backed: true,
            requested_filters: {
              agent: parsed.searchParams.get("agent") || "*",
              environment: parsed.searchParams.get("environment") || "production",
              service: parsed.searchParams.get("service") || "defenseclaw",
              tenant: request.headers["x-c3-tenant"] || null,
              window: parsed.searchParams.get("window") || "-24h",
            },
          };
          writeJson(response, 200, fixture);
          return;
        }

        if (parsed.pathname === "/v1/c3/agent-tokenomics/usage/rows") {
          writeJson(response, 200, {
            debug: {
              fixture_backed: true,
              requested_filters: {
                window: parsed.searchParams.get("window") || "-24h",
              },
            },
            generated_at: new Date().toISOString(),
            rows: JSON.parse(fs.readFileSync(rowFixturePath, "utf8")),
            source: "fixture_rows",
          });
          return;
        }

        if (request.method === "GET" && parsed.pathname === fleetOverviewPath) {
          writeJson(response, 200, cloneJson(fleetControlState));
          return;
        }

        if (request.method === "GET" && parsed.pathname === fleetAnalyticsPath) {
          writeJson(response, 200, cloneJson(fleetAnalytics));
          return;
        }

        if (request.method === "GET" && parsed.pathname === fleetInfrastructurePath) {
          writeJson(response, 200, fleetInfrastructureResponse(fleetInfrastructure, parsed.searchParams));
          return;
        }

        if (request.method === "POST" && parsed.pathname === fleetDemoResetPath) {
          const payload = await readJsonBody(request);
          rejectUnexpectedFields(payload, ["reason"], "fleet-demo-reset");
          const reason = singleLineText(
            payload,
            "reason",
            "Reset AMD Deskside demo state through Cloud Control",
          );
          fleetControlState = loadFleetDemoState();
          fleetRestoreState.clear();
          writeJson(response, 200, {
            ...cloneJson(fleetControlState),
            reset: {
              completed: true,
              reason,
              simulated: true,
            },
          });
          return;
        }

        if (request.method === "POST" && parsed.pathname === securityPolicyPath) {
          const payload = await readJsonBody(request);
          writeJson(response, 200, updateSecurityPolicy(fleetControlState, payload));
          return;
        }

        if (request.method === "POST" && parsed.pathname === policyStudioDraftPath) {
          const payload = await readJsonBody(request);
          writeJson(response, 201, createPolicyStudioFixtureDraft(payload, policyStudioDrafts));
          return;
        }

        const policyStudioApplyMatch = parsed.pathname.match(policyStudioApplyPattern);
        if (request.method === "POST" && policyStudioApplyMatch) {
          const payload = await readJsonBody(request);
          const draftId = normalizeUuid(policyStudioApplyMatch[1], "draft_id");
          writeJson(
            response,
            200,
            stagePolicyStudioFixtureDraft(draftId, payload, policyStudioDrafts),
          );
          return;
        }

        const desksideActionMatch = parsed.pathname.match(desksideActionPattern);
        if (request.method === "POST" && desksideActionMatch) {
          let deviceId;
          try {
            deviceId = decodeURIComponent(desksideActionMatch[1]);
          } catch (_error) {
            const error = new Error("invalid device_id encoding");
            error.statusCode = 400;
            throw error;
          }
          if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(deviceId)) {
            const error = new Error("device_id must be 1-128 letters, numbers, dots, underscores, or hyphens");
            error.statusCode = 400;
            throw error;
          }
          const payload = await readJsonBody(request);
          writeJson(response, 200, applyNetworkAction(fleetControlState, fleetRestoreState, deviceId, payload));
          return;
        }

        if (parsed.pathname === "/v1/c3/agent-tokenomics/alerts") {
          writeJson(response, 200, fixtureControlState.alerts);
          return;
        }

        if (parsed.pathname === "/v1/c3/agent-tokenomics/policies/effective") {
          const agentId = parsed.searchParams.get("agent_id");
          const policies = agentId
            ? fixtureControlState.policies.filter((row) => row.agent_id === agentId)
            : fixtureControlState.policies;
          writeJson(response, 200, policies);
          return;
        }

        if (parsed.pathname === "/v1/c3/agent-tokenomics/agent-controls/allowed") {
          writeJson(response, 200, fixtureControlState.allowed);
          return;
        }

        if (
          request.method === "POST" &&
          (parsed.pathname === "/v1/c3/agent-tokenomics/controls/apply" ||
            parsed.pathname === "/v1/c3/agent-tokenomics/controls/release")
        ) {
          const payload = await readJsonBody(request);
          if (parsed.pathname.endsWith("/apply")) {
            const policy = fixturePolicy(payload);
            fixtureControlState.policies = fixtureControlState.policies.filter((row) => row.agent_id !== policy.agent_id);
            fixtureControlState.policies.push(policy);
            writeJson(response, 200, policy);
          } else {
            const agentId = String(payload.agent_id || "").trim();
            if (!agentId) {
              writeJson(response, 400, { error: "agent_id is required" });
              return;
            }
            fixtureControlState.policies = fixtureControlState.policies.filter((row) => row.agent_id !== agentId);
            writeJson(response, 200, { status: "released", agent_id: agentId, fixture_backed: true });
          }
          return;
        }

        if (
          request.method === "POST" &&
          (parsed.pathname === "/v1/c3/agent-tokenomics/agent-controls/allow" ||
            parsed.pathname === "/v1/c3/agent-tokenomics/agent-controls/remove")
        ) {
          const payload = await readJsonBody(request);
          const unexpectedFields = Object.keys(payload).filter(
            (key) => !["target_type", "target_name", "reason"].includes(key),
          );
          if (unexpectedFields.length) {
            writeJson(response, 400, { error: `unsupported agent-control field: ${unexpectedFields[0]}` });
            return;
          }
          const targetType = String(payload.target_type || "").trim().toLowerCase();
          const targetName = String(payload.target_name || "").trim();
          const reason = String(payload.reason || "").trim() || "Approved in fixture Agent Controls";
          if (!(["command", "tool"].includes(targetType)) || !targetName) {
            writeJson(response, 400, { error: "target_type command|tool and target_name are required" });
            return;
          }
          if (/[\r\n\u0000]/.test(targetName)) {
            writeJson(response, 400, { error: "target_name must be one line and cannot contain NUL" });
            return;
          }
          if (targetName.length > 512) {
            writeJson(response, 400, { error: "target_name must be 512 characters or fewer" });
            return;
          }
          if (reason.length > 512) {
            writeJson(response, 400, { error: "reason must be 512 characters or fewer" });
            return;
          }
          fixtureControlState.allowed = fixtureControlState.allowed.filter(
            (row) => !(row.target_type === targetType && row.target_name === targetName),
          );
          if (parsed.pathname.endsWith("/allow")) {
            const entry = {
              id: `fixture-${targetType}-${targetName}`,
              target_type: targetType,
              target_name: targetName,
              reason,
              updated_at: new Date().toISOString(),
              fixture_backed: true,
            };
            fixtureControlState.allowed.push(entry);
            writeJson(response, 200, entry);
          } else {
            writeJson(response, 200, { status: "removed", target_type: targetType, target_name: targetName, fixture_backed: true });
          }
          return;
        }

        writeJson(response, 404, {
          error: "not_found",
          paths: [
            "/healthz",
            "/v1/c3/agent-tokenomics/summary",
            "/v1/c3/agent-tokenomics/usage/rows",
            "/v1/c3/agent-tokenomics/alerts",
            "/v1/c3/agent-tokenomics/policies/effective",
            "/v1/c3/agent-tokenomics/agent-controls/allowed",
            "/v1/c3/agent-tokenomics/agent-controls/allow",
            "/v1/c3/agent-tokenomics/agent-controls/remove",
            fleetOverviewPath,
            fleetAnalyticsPath,
            fleetInfrastructurePath,
            fleetDemoResetPath,
            securityPolicyPath,
            policyStudioDraftPath,
            "/v1/c3/agent-tokenomics/policy-studio/drafts/{draft_id}/apply",
            "/v1/c3/agent-tokenomics/fleet/desksides/{device_id}/network-action",
          ],
        });
      } catch (error) {
        const statusCode = Number(error && error.statusCode) || 500;
        writeJson(
          response,
          statusCode,
          error && error.responseBody
            ? error.responseBody
            : {
                error: statusCode >= 500 ? "fixture_read_failed" : "invalid_request",
                detail: error instanceof Error ? error.message : String(error),
              },
        );
      }
    };
}

function createProxyApiHandler() {
  const transport = tokenomicsBffUrl.protocol === "https:" ? https : http;
  return (request, response) => {
      const parsed = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
      if (request.method === "OPTIONS") {
        writeJson(response, 204, {});
        return;
      }
      if (
        parsed.pathname !== "/healthz" &&
        parsed.pathname !== "/readyz" &&
        !parsed.pathname.startsWith("/v1/c3/agent-tokenomics/")
      ) {
        writeJson(response, 404, {
          error: "not_found",
          paths: ["/healthz", "/readyz", "/v1/c3/agent-tokenomics/*"],
        });
        return;
      }

      const upstream = new URL(`${parsed.pathname}${parsed.search}`, tokenomicsBffUrl);
      const upstreamTimeoutMs = parsed.pathname.startsWith(`${policyStudioDraftPath}/`) ||
        parsed.pathname === policyStudioDraftPath
        ? policyStudioBffTimeoutMs
        : tokenomicsBffTimeoutMs;
      const headers = { ...request.headers };
      delete headers.host;
      headers["x-forwarded-host"] = request.headers.host || "";
      headers["x-forwarded-proto"] = "http";

      let upstreamStarted = false;
      const proxyRequest = transport.request(
        upstream,
        {
          method: request.method,
          headers,
        },
        (proxyResponse) => {
          upstreamStarted = true;
          const proxyHeaders = { ...proxyResponse.headers };
          proxyHeaders["access-control-allow-origin"] = "*";
          proxyHeaders["access-control-allow-methods"] = "GET,OPTIONS,POST";
          response.writeHead(proxyResponse.statusCode || 502, proxyHeaders);
          proxyResponse.on("error", (error) => response.destroy(error));
          proxyResponse.pipe(response);
        },
      );

      proxyRequest.on("error", (error) => {
        if (upstreamStarted || response.headersSent) {
          response.destroy(error);
          return;
        }
        const timedOut = error && error.code === "ETIMEDOUT";
        writeJson(response, timedOut ? 504 : 502, {
          error: timedOut ? "tokenomics_bff_timeout" : "tokenomics_bff_unreachable",
          detail: error.message,
          upstream: tokenomicsBffUrl.toString(),
        });
      });
      proxyRequest.setTimeout(upstreamTimeoutMs, () => {
        const error = new Error(`Tokenomics BFF timed out after ${upstreamTimeoutMs}ms`);
        error.code = "ETIMEDOUT";
        proxyRequest.destroy(error);
      });

      request.pipe(proxyRequest);
    };
}

function startStaticApp(apiHandler) {
  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    console.error(`Missing prebuilt dist at ${distDir}`);
    console.error("This package should include dist/index.html. Ask for a rebuilt handoff zip.");
    process.exit(1);
  }
  if (!fs.existsSync(path.join(shellDir, "index.html"))) {
    console.error(`Missing control shell at ${shellDir}`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(embeddedLiveDir, "index.html"))) {
    console.error(`Missing live embedded page at ${embeddedLiveDir}`);
    process.exit(1);
  }

  http
    .createServer((request, response) => {
      const parsed = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
      if (
        parsed.pathname === "/healthz" ||
        parsed.pathname === "/readyz" ||
        parsed.pathname.startsWith("/v1/c3/agent-tokenomics/")
      ) {
        apiHandler(request, response);
        return;
      }
      let pathname;
      try {
        pathname = decodeURIComponent(parsed.pathname || "/");
      } catch (_error) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        response.end("Bad request");
        return;
      }

      if (pathname === "/" || pathname === "/index.html") {
        sendFile(response, path.join(shellDir, "index.html"));
        return;
      }

      if (pathname.startsWith("/shell/")) {
        const filePath = safeResolve(shellDir, pathname.replace(/^\/shell\//, ""));
        if (!filePath) {
          response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
          response.end("Forbidden");
          return;
        }
        sendFile(response, filePath);
        return;
      }

      if (pathname === "/embedded" || pathname === "/embedded/") {
        sendFile(response, path.join(distDir, "index.html"));
        return;
      }

      if (pathname === "/embedded-live" || pathname === "/embedded-live/") {
        sendFile(response, path.join(embeddedLiveDir, "index.html"));
        return;
      }

      if (pathname.startsWith("/embedded/")) {
        const innerPath = pathname.replace(/^\/embedded\//, "");
        const filePath = safeResolve(distDir, innerPath);
        if (!filePath) {
          response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
          response.end("Forbidden");
          return;
        }
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          sendFile(response, filePath);
          return;
        }
        sendFile(response, path.join(distDir, "index.html"));
        return;
      }

      if (pathname.startsWith("/embedded-live/")) {
        const innerPath = pathname.replace(/^\/embedded-live\//, "");
        const filePath = safeResolve(embeddedLiveDir, innerPath);
        if (!filePath) {
          response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
          response.end("Forbidden");
          return;
        }
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          sendFile(response, filePath);
          return;
        }
        sendFile(response, path.join(embeddedLiveDir, "index.html"));
        return;
      }

      const rootAsset = safeResolve(distDir, pathname);
      if (rootAsset && fs.existsSync(rootAsset) && fs.statSync(rootAsset).isFile()) {
        sendFile(response, rootAsset);
        return;
      }

      sendFile(response, path.join(shellDir, "index.html"));
    })
    .listen(appPort, host);
}

const apiHandler = tokenomicsBffUrl ? createProxyApiHandler() : createFixtureApiHandler();
http.createServer(apiHandler).listen(apiPort, host);
startStaticApp(apiHandler);

const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
console.log(`Tokenomics API:  http://${displayHost}:${apiPort}/v1/c3/agent-tokenomics/summary`);
console.log(`Same-origin API: http://${displayHost}:${appPort}/v1/c3/agent-tokenomics/summary`);
console.log(`Deskside AI Resilience: http://${displayHost}:${appPort}/`);
console.log(`Embedded MFE:    http://${displayHost}:${appPort}/embedded-live/?view=tokenomics`);
console.log("Press Ctrl+C to stop.");
