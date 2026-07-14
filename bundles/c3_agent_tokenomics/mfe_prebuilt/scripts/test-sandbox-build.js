const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const serverScript = path.join(__dirname, "serve-prebuilt-tokenomics-demo.js");

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

async function waitFor(url, child, stderr) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`prebuilt server exited early (${child.exitCode}): ${stderr.join("")}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(250) });
      if (response.ok) return;
    } catch (_error) {
      // The child has not bound its ports yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${url}: ${stderr.join("")}`);
}

async function main() {
  const requiredFiles = [
    "dist/index.html",
    "dist/main.js",
    "dist/remoteEntry.js",
    "embedded_live/app.css",
    "embedded_live/app.js",
    "embedded_live/index.html",
    "fixtures/amd-deskside-fleet.json",
    "fixtures/splunk-o11y-infrastructure.json",
    "fixtures/tokenomics-fleet-analytics.json",
    "fixtures/tokenomics-summary-runtime-governance.json",
    "shell/app.css",
    "shell/app.js",
    "shell/assets/amd-ryzen-ai-halo.png",
    "shell/assets/cisco-c9350.png",
    "shell/assets/cisco-c9550.png",
    "shell/index.html",
  ];
  for (const relativePath of requiredFiles) {
    assert.equal(fs.existsSync(path.join(rootDir, relativePath)), true, `missing ${relativePath}`);
  }
  const productGraphicHashes = {
    "shell/assets/amd-ryzen-ai-halo.png": "b3bdbf01deac9ff931021e8ac820c98238e1045f929029a3f71729ccce60b344",
    "shell/assets/cisco-c9350.png": "6bfcaf47209aa753d35cbc46c2f3c6357d8a30bf519a01ad98114555aa24f5ca",
    "shell/assets/cisco-c9550.png": "c6891673739031961cdedd7dc1f8b7b85d6eab188532e94d64cc20e72f5a6938",
  };
  for (const [relativePath, expectedHash] of Object.entries(productGraphicHashes)) {
    const actualHash = crypto.createHash("sha256").update(fs.readFileSync(path.join(rootDir, relativePath))).digest("hex");
    assert.equal(actualHash, expectedHash, `${relativePath} product graphic changed unexpectedly`);
  }

  const remoteEntry = fs.readFileSync(path.join(rootDir, "dist/remoteEntry.js"), "utf8");
  assert.match(remoteEntry, /"\.\/App"/);
  assert.match(remoteEntry, /"\.\/DefenseClawTokenomics"/);

  const shellHtml = fs.readFileSync(path.join(rootDir, "shell", "index.html"), "utf8");
  const shellCss = fs.readFileSync(path.join(rootDir, "shell", "app.css"), "utf8");
  const shellScript = fs.readFileSync(path.join(rootDir, "shell", "app.js"), "utf8");
  const capabilityCardHtml = shellHtml.match(
    /<article class="card control-card agent-capabilities-card">[\s\S]*?<\/article>/,
  )?.[0] || "";
  const embeddedHtml = fs.readFileSync(path.join(rootDir, "embedded_live", "index.html"), "utf8");
  const infrastructureFixture = fs.readFileSync(
    path.join(rootDir, "fixtures", "splunk-o11y-infrastructure.json"),
    "utf8",
  );
  const embeddedScript = fs.readFileSync(path.join(rootDir, "embedded_live", "app.js"), "utf8");
  assert.match(shellHtml, /Cloud Control/);
  assert.match(shellHtml, /<title>Fleet Overview \| Deskside AI Resilience \| Cloud Control<\/title>/);
  assert.match(shellHtml, /<span>Deskside AI Resilience<\/span>/);
  assert.match(shellScript, /Deskside AI Resilience/);
  assert.match(shellScript, /const apiBase = "\/v1\/c3\/agent-tokenomics"/);
  assert.doesNotMatch(shellScript, /url\.port\s*=\s*"8787"/);
  assert.match(embeddedHtml, /<title>Deskside AI Resilience<\/title>/);
  assert.match(embeddedHtml, /<h1>Deskside AI Resilience<\/h1>/);
  assert.deepEqual(
    Array.from(shellHtml.matchAll(/data-shell-nav="([^"]+)"/g), (match) => match[1]),
    ["fleet", "infrastructure", "budget", "controls", "network"],
  );
  assert.match(shellHtml, /id="policy-form"/);
  assert.match(shellHtml, /id="budget-page"/);
  assert.match(shellHtml, /id="alerts-list"/);
  assert.doesNotMatch(shellHtml, /href="\/budgets#alerts-list"/);
  assert.match(shellHtml, /id="fleet-page"/);
  assert.match(shellHtml, /id="fleet-summary-grid"/);
  assert.match(shellHtml, /id="fleet-network-identity"/);
  assert.match(shellHtml, /id="fleet-agent-identities"/);
  assert.match(shellHtml, /id="fleet-inventory-summary"/);
  assert.match(shellHtml, /id="fleet-inventory-view-toggle"/);
  assert.match(shellHtml, /data-fleet-view="inventory"/);
  assert.match(shellHtml, /data-fleet-view="infrastructure"/);
  assert.match(shellHtml, /href="\/infrastructure"[^>]*data-shell-nav="infrastructure"/);
  assert.match(shellHtml, /id="infrastructure-page"/);
  assert.match(shellHtml, /data-shell-page="infrastructure"/);
  assert.doesNotMatch(shellHtml, /id="hardware-story"/);
  assert.doesNotMatch(shellHtml, /id="keynote-architecture"/);
  assert.match(shellHtml, /id="provider-usage"/);
  assert.match(shellHtml, /id="agent-behavior-page"/);
  assert.match(shellHtml, /id="behavior-agent-table"/);
  assert.match(shellHtml, /id="agent-controls-page"/);
  assert.match(shellHtml, /href="\/agent-controls"[^>]*data-shell-nav="controls"/);
  assert.doesNotMatch(shellHtml, /data-shell-nav="(?:behavior|studio)"/);
  assert.doesNotMatch(shellHtml, /data-shell-page="(?:behavior|studio)"/);
  assert.match(shellHtml, /id="agent-control-tabs"[^>]*class="[^"]*tokenomics-tabs[^"]*"[^>]*role="tablist"/);
  for (const [tab, panel] of [
    ["controls", "agent-controls-panel"],
    ["studio", "policy-studio-page"],
    ["behavior", "agent-behavior-page"],
  ]) {
    assert.match(shellHtml, new RegExp(`id="agent-control-tab-${tab}"[^>]*role="tab"`));
    assert.match(shellHtml, new RegExp(`data-agent-control-tab="${tab}"`));
    assert.match(shellHtml, new RegExp(`aria-controls="${panel}"`));
    assert.match(shellHtml, new RegExp(`id="${panel}"[^>]*role="tabpanel"`));
    assert.match(shellHtml, new RegExp(`data-agent-control-panel="${tab}"`));
  }
  assert.match(shellHtml, /id="policy-studio-page"/);
  assert.match(shellHtml, /id="policy-studio-form"/);
  assert.match(shellHtml, /id="policy-studio-review-confirmed"/);
  assert.match(shellHtml, /Stage reviewed guardrail/);
  assert.match(shellHtml, /Separate deployment workflow/);
  assert.match(shellHtml, /id="approved-workspaces-list"/);
  assert.match(shellHtml, /id="guardrail-policy-catalog"/);
  assert.match(shellHtml, /id="jira-delete-guardrail"/);
  assert.match(shellHtml, /id="jira-guardrail-demo-button"/);
  assert.match(shellHtml, /id="model-provenance-guardrail"/);
  assert.doesNotMatch(shellHtml, /id="model-provider-controls"/);
  assert.match(shellHtml, /id="network-security-page"/);
  assert.match(shellHtml, /id="network-topology"/);
  assert.match(shellHtml, /id="network-topology-summary"/);
  assert.match(shellScript, /id="network-topology-map"/);
  assert.match(shellScript, /data-topology-device-id/);
  assert.match(shellScript, /topology-pdf-layout/);
  assert.match(shellScript, /id="network-policy-enforcement"/);
  assert.match(shellScript, /id="network-enforcement-flow"/);
  assert.match(shellScript, /topology-endpoint-port/);
  assert.doesNotMatch(shellScript, /topology-capability-sidebar/);
  assert.match(shellScript, /Smart aggregation switch/);
  assert.match(shellScript, /AMD Ryzen AI Halo/);
  assert.ok(
    shellHtml.indexOf('class="card network-topology-card"') < shellHtml.indexOf('id="network-security-banner"'),
    "network topology should be the first pane after the Network Security header",
  );
  assert.match(shellHtml, /id="auto-quarantine-toggle"/);
  assert.match(shellHtml, /id="routing-demo"/);
  assert.match(shellHtml, /id="lemonade-routing-toggle"/);
  assert.match(shellHtml, /id="tokenomics-tab-adoption"/);
  assert.match(shellHtml, /id="tokenomics-tab-cost"/);
  assert.doesNotMatch(shellHtml, /id="tokenomics-tab-infrastructure"/);
  assert.match(shellHtml, /id="tokenomics-tab-budget"/);
  assert.doesNotMatch(shellHtml, /id="tokenomics-tab-overview"/);
  assert.match(shellHtml, /<span>Model<\/span>\s*<select id="tokenomics-model-filter">/);
  assert.doesNotMatch(shellHtml, /id="tokenomics-provider-filter"/);
  assert.match(shellScript, /initialSearchParams\.get\("model"\)/);
  assert.match(shellScript, /row\.model_id === state\.analyticsModel/);
  assert.match(shellHtml, /id="tokenomics-agent-filter"/);
  assert.match(shellHtml, /id="agent-economics-table"/);
  assert.match(shellHtml, /id="adoption-trend-chart"/);
  assert.match(shellHtml, /id="adoption-team-matrix"/);
  assert.match(shellHtml, /id="cost-breakdown-bars"/);
  assert.match(shellHtml, /id="usage-detail-table"/);
  assert.match(shellHtml, /id="tokenomics-opportunities"/);
  assert.match(shellHtml, /id="tokenomics-opportunity-list"/);
  assert.doesNotMatch(shellHtml, /id="tokenomics-infrastructure-panel"/);
  assert.match(shellHtml, /id="infrastructure-disclosure"/);
  assert.match(shellHtml, /id="infrastructure-summary-grid"/);
  assert.match(shellHtml, /id="infrastructure-utilization-chart"/);
  assert.match(shellHtml, /id="infrastructure-efficiency-list"/);
  assert.match(shellHtml, /id="infrastructure-device-table"/);
  assert.match(shellHtml, /Demo data/);
  assert.doesNotMatch(shellHtml, /Illustrative/);
  assert.doesNotMatch(shellScript, /Illustrative/);
  assert.match(shellHtml, /id="restricted-model-demo"/);
  assert.match(shellHtml, /data-incident-state="setup-required"/);
  assert.match(shellHtml, /id="restricted-model-demo-button"/);
  assert.match(shellHtml, /id="restricted-model-notification"/);
  assert.match(shellHtml, /id="restricted-model-endpoint"/);
  assert.match(shellHtml, /id="restricted-model-evidence"/);
  assert.match(shellHtml, /id="restricted-model-response"/);
  assert.match(shellHtml, /id="restricted-model-notification-preview"/);
  assert.match(shellHtml, /id="restricted-model-demo-state" role="status" aria-live="polite"/);
  assert.match(shellHtml, /aria-describedby="restricted-model-demo-state restricted-model-demo-consequence"/);
  assert.match(shellHtml, /Synthetic only/);
  assert.doesNotMatch(shellHtml, /class="skill-policy-trace"/);
  assert.doesNotMatch(shellHtml, /id="model-provenance-state"/);
  assert.doesNotMatch(shellHtml, /id="model-defenseclaw-state"/);
  assert.doesNotMatch(shellHtml, /id="model-network-state"/);
  assert.doesNotMatch(shellHtml, /id="malicious-skill-demo"/);
  assert.doesNotMatch(shellHtml, /class="[^"]*malicious-skill-card/);
  assert.doesNotMatch(shellHtml, /id="network-security-events"/);
  assert.match(shellHtml, /id="chat-budget-toggle"/);
  assert.match(shellHtml, /id="approved-command-form"/);
  assert.match(shellHtml, /id="tool-exceptions-list"/);
  assert.match(shellHtml, />Agent capabilities</);
  assert.match(shellHtml, />Read approved data</);
  assert.match(shellHtml, />Run code and commands</);
  assert.match(shellHtml, />Use web and connected apps</);
  assert.ok(capabilityCardHtml);
  assert.equal((capabilityCardHtml.match(/role="switch"/g) || []).length, 7);
  assert.equal((capabilityCardHtml.match(/data-capability-toggle=/g) || []).length, 7);
  assert.equal((capabilityCardHtml.match(/aria-checked="true"/g) || []).length, 2);
  assert.equal((capabilityCardHtml.match(/aria-checked="false"/g) || []).length, 5);
  assert.equal((capabilityCardHtml.match(/<b>(?:Enabled|Disabled)<\/b>/g) || []).length, 7);
  assert.doesNotMatch(capabilityCardHtml, />(?:Allowed|Ask first|Blocked · locked)</);
  assert.match(shellScript, /toggleCapabilityPreview/);
  assert.doesNotMatch(shellHtml, /<iframe|embedded-frame|tokenomics-embedded/);
  assert.match(shellHtml, /id="advanced-tool-exceptions"/);
  assert.match(shellHtml, /Exact-name scan bypass/);
  assert.doesNotMatch(shellHtml, /data-tool-toggle=/);
  assert.match(shellCss, /--tok-blue:\s*#2487ff/);
  assert.match(shellCss, /\.control-switch\[aria-checked="true"\]/);
  assert.match(shellCss, /\.policy-studio-workspace/);
  assert.match(shellCss, /\.agent-economics-table/);
  assert.match(shellScript, /policy-studio\/drafts/);
  assert.match(shellScript, /analyticsAgent/);
  assert.match(shellScript, /review_confirmed:\s*true/);
  for (const source of [shellHtml, shellCss, shellScript, infrastructureFixture]) {
    assert.doesNotMatch(source, /(?:co2|carbon)/i);
  }
  assert.match(embeddedScript, /const initialView =/);
  assert.match(embeddedScript, /const summaryUrl = `\/v1\/c3\/agent-tokenomics\/summary/);
  assert.doesNotMatch(embeddedScript, /url\.port\s*=\s*"8787"/);

  const apiPort = await freePort();
  const appPort = await freePort();
  const stderr = [];
  const child = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      API_PORT: String(apiPort),
      HOST: "127.0.0.1",
      MFE_PORT: String(appPort),
      TOKENOMICS_BFF_URL: "",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString("utf8")));

  try {
    await waitFor(`http://127.0.0.1:${apiPort}/healthz`, child, stderr);
    const appResponse = await fetch(`http://127.0.0.1:${appPort}/`);
    assert.equal(appResponse.status, 200);
    assert.match(await appResponse.text(), /id="fleet-page"/);

    const sameOriginHealthResponse = await fetch(`http://127.0.0.1:${appPort}/healthz`);
    assert.equal(sameOriginHealthResponse.status, 200);
    assert.equal((await sameOriginHealthResponse.json()).status, "ok");

    const sameOriginReadyResponse = await fetch(`http://127.0.0.1:${appPort}/readyz`);
    assert.equal(sameOriginReadyResponse.status, 200);
    assert.deepEqual(await sameOriginReadyResponse.json(), { mode: "fixture", status: "ready" });

    const fleetPageResponse = await fetch(`http://127.0.0.1:${appPort}/fleet`);
    assert.equal(fleetPageResponse.status, 200);
    assert.match(await fleetPageResponse.text(), /id="fleet-summary-grid"/);

    const budgetsPageResponse = await fetch(`http://127.0.0.1:${appPort}/budgets`);
    assert.equal(budgetsPageResponse.status, 200);
    assert.match(await budgetsPageResponse.text(), /id="budget-page"/);

    const infrastructurePageResponse = await fetch(`http://127.0.0.1:${appPort}/infrastructure`);
    assert.equal(infrastructurePageResponse.status, 200);
    assert.match(await infrastructurePageResponse.text(), /id="infrastructure-page"/);

    const behaviorPageResponse = await fetch(`http://127.0.0.1:${appPort}/agent-behavior`);
    assert.equal(behaviorPageResponse.status, 200);
    assert.match(await behaviorPageResponse.text(), /id="agent-behavior-page"/);

    const controlsPageResponse = await fetch(`http://127.0.0.1:${appPort}/agent-controls`);
    assert.equal(controlsPageResponse.status, 200);
    assert.match(await controlsPageResponse.text(), /id="agent-controls-page"/);

    const policyStudioPageResponse = await fetch(`http://127.0.0.1:${appPort}/policy-studio`);
    assert.equal(policyStudioPageResponse.status, 200);
    assert.match(await policyStudioPageResponse.text(), /id="policy-studio-page"/);

    const networkPageResponse = await fetch(`http://127.0.0.1:${appPort}/network-security`);
    assert.equal(networkPageResponse.status, 200);
    assert.match(await networkPageResponse.text(), /id="network-security-page"/);

    const summaryResponse = await fetch(`http://127.0.0.1:${appPort}/v1/c3/agent-tokenomics/summary`);
    assert.equal(summaryResponse.status, 200);
    const summary = await summaryResponse.json();
    assert.equal(summary.debug.fixture_backed, true);

    const rowsResponse = await fetch(`http://127.0.0.1:${appPort}/v1/c3/agent-tokenomics/usage/rows`);
    assert.equal(rowsResponse.status, 200);
    const rows = await rowsResponse.json();
    assert.equal(rows.debug.fixture_backed, true);
    assert.ok(Array.isArray(rows.rows) && rows.rows.length > 0);

    const policyStudioDraftsUrl =
      `http://127.0.0.1:${appPort}/v1/c3/agent-tokenomics/policy-studio/drafts`;
    const policyStudioCreateResponse = await fetch(policyStudioDraftsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Block credential access and require approval before restricted data goes to public AI models.",
      }),
    });
    assert.equal(policyStudioCreateResponse.status, 201);
    const policyStudioCreated = await policyStudioCreateResponse.json();
    assert.equal(policyStudioCreated.draft.status, "generated");
    assert.equal(policyStudioCreated.draft.generation.mode, "fallback");
    assert.equal(policyStudioCreated.draft.policy.kind, "AgentGuardrailDraft");
    assert.ok(policyStudioCreated.draft.rules.some((rule) => rule.category === "data_protection"));
    assert.doesNotMatch(JSON.stringify(policyStudioCreated), /rego|policy\.apply/i);

    const policyStudioStageUrl =
      `${policyStudioDraftsUrl}/${policyStudioCreated.draft.id}/apply`;
    const unreviewedStageResponse = await fetch(policyStudioStageUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expected_version: 1 }),
    });
    assert.equal(unreviewedStageResponse.status, 400);
    assert.match((await unreviewedStageResponse.json()).error, /review_confirmed/);

    const policyStudioStageResponse = await fetch(policyStudioStageUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expected_version: 1,
        review_confirmed: true,
        reviewed_by: "sandbox-test-reviewer",
      }),
    });
    assert.equal(policyStudioStageResponse.status, 200);
    const policyStudioStaged = await policyStudioStageResponse.json();
    assert.equal(policyStudioStaged.draft.status, "staged");
    assert.equal(policyStudioStaged.draft.version, 2);
    assert.equal(policyStudioStaged.application.enforcement_status, "not_enforced");
    assert.equal(policyStudioStaged.application.persistence, "ephemeral");

    const fleetOverviewUrl = `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/fleet/overview`;
    const securityPolicyUrl = `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/security/policy`;
    const desksideActionUrl =
      `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/fleet/desksides/DSK-AUS-017/network-action`;
    const initialFleetResponse = await fetch(fleetOverviewUrl);
    assert.equal(initialFleetResponse.status, 200);
    const initialFleet = await initialFleetResponse.json();
    assert.equal(initialFleet.demo.inventory_is_fixture, true);
    assert.equal(initialFleet.demo.network_actions_are_simulated, true);
    assert.equal(initialFleet.security_policy.auto_quarantine, false);
    assert.equal(initialFleet.security_policy.version, 1);
    assert.equal(initialFleet.behavior.status, "illustrative");
    assert.equal(initialFleet.behavior.outcomes_met_percent, 94);
    assert.equal(initialFleet.behavior.outcomes_met_tasks + initialFleet.behavior.exception_tasks, initialFleet.fleet.tasks_today);
    assert.equal(initialFleet.network_topology.architecture, "reference-campus");
    assert.equal(initialFleet.network_topology.core.display_name, "Cisco C9550");
    assert.equal(initialFleet.network_topology.core.official_model, "Cisco C9550 Series Smart Switches");
    assert.equal(initialFleet.network_topology.core.role, "Core + aggregation");
    assert.equal(initialFleet.network_topology.core.deployment, "Logical core pair");
    assert.equal(initialFleet.network_topology.core.message, "Campus backbone for agentic AI");
    assert.deepEqual(initialFleet.network_topology.core.capabilities, {
      switching_capacity: { label: "Up to 6.4 Tbps", basis: "series-maximum" },
      uplink_speed: { label: "Up to 400G", basis: "series-maximum" },
    });
    assert.equal(initialFleet.network_topology.access.display_name, "Cisco C9350");
    assert.equal(initialFleet.network_topology.access.official_model, "Cisco C9350 Series Smart Switches");
    assert.equal(initialFleet.network_topology.access.role, "Fixed campus access");
    assert.equal(initialFleet.network_topology.access.switch_count, 5);
    assert.deepEqual(initialFleet.network_topology.access.capabilities, {
      uplink_speed: { label: "Up to 100G", basis: "series-maximum" },
    });
    const ciscoNetworkIntegration = initialFleet.integrations.find((row) => row.id === "cisco_network");
    assert.equal(ciscoNetworkIntegration.name, "Cisco C9550 / C9350 campus fabric");
    assert.equal(ciscoNetworkIntegration.detail, "1 C9550 logical core pair · 5 C9350 access switches");
    assert.equal(initialFleet.integrations.some((row) => row.id === "catalyst"), false);
    assert.doesNotMatch(JSON.stringify(initialFleet), /CAT9K/);
    const initialQuarantined = initialFleet.fleet.quarantined_devices;
    const initialTimeline = initialFleet.enforcement_events.length;
    const initialAusDeskside = initialFleet.devices.find((row) => row.device_id === "DSK-AUS-017");
    assert.equal(initialAusDeskside.switch_name, "C9350-AUS-02");
    assert.equal(initialAusDeskside.switch_port, "Gi1/0/17");
    assert.equal(initialAusDeskside.network_access, "Full access");
    assert.equal(initialAusDeskside.agent_names.includes("DefenseClaw"), true);

    const fleetAnalyticsResponse = await fetch(
      `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/fleet/analytics`,
    );
    assert.equal(fleetAnalyticsResponse.status, 200);
    const fleetAnalytics = await fleetAnalyticsResponse.json();
    const expectedFleetAnalytics = JSON.parse(
      fs.readFileSync(path.join(rootDir, "fixtures", "tokenomics-fleet-analytics.json"), "utf8"),
    );
    assert.deepEqual(fleetAnalytics, expectedFleetAnalytics);
    assert.equal(fleetAnalytics.source, "amd_deskside_demo_scenario");
    assert.equal(fleetAnalytics.debug.fixture_backed, true);
    assert.equal(fleetAnalytics.disclosure.status, "illustrative");
    assert.equal(fleetAnalytics.adoption.status, "illustrative");
    assert.equal(fleetAnalytics.cost.status, "illustrative");
    const detailTotals = fleetAnalytics.cost.detail_rows.reduce(
      (totals, row) => ({
        tasks: totals.tasks + row.tasks,
        tokens: totals.tokens + row.total_tokens,
        cost: totals.cost + row.estimated_cost_usd,
      }),
      { tasks: 0, tokens: 0, cost: 0 },
    );
    assert.equal(detailTotals.tasks, 1842);
    assert.equal(detailTotals.tokens, fleetAnalytics.cost.summary.total_tokens);
    assert.equal(Math.round(detailTotals.cost * 100), Math.round(fleetAnalytics.cost.summary.estimated_cloud_cost_usd * 100));
    const modelsById = new Map(fleetAnalytics.dimensions.models.map((row) => [row.model_id, row]));
    assert.equal(modelsById.size, fleetAnalytics.dimensions.models.length);
    assert.deepEqual(
      new Set(fleetAnalytics.cost.detail_rows.map((row) => row.model_id)),
      new Set(modelsById.keys()),
    );
    assert.ok(
      fleetAnalytics.cost.detail_rows.every((row) => {
        const model = modelsById.get(row.model_id);
        return model && model.provider_id === row.provider_id;
      }),
    );
    const modelCostsInCents = Object.fromEntries(
      Array.from(modelsById.keys()).map((modelId) => [
        modelId,
        Math.round(
          fleetAnalytics.cost.detail_rows
            .filter((row) => row.model_id === modelId)
            .reduce((total, row) => total + row.estimated_cost_usd, 0) * 100,
        ),
      ]),
    );
    assert.deepEqual(modelCostsInCents, {
      "amd-local-default": 0,
      "gpt-4o-mini": 1520,
      "gpt-4.1-mini": 3402,
      "gpt-5.4-mini": 1900,
      "gpt-5.4": 3000,
      "gpt-5.5": 861000,
      "claude-sonnet-4-5": 68800,
      "claude-sonnet-4-6": 4560,
      "claude-opus-4-8": 180000,
      "claude-haiku-4-5-20251001": 60000,
      "gemini-2.5-flash": 474,
      "gemini-3.5-flash": 700,
      "gemini-3.1-pro-preview": 1000,
    });
    assert.equal(
      fleetAnalytics.cost.summary.local_tokens + fleetAnalytics.cost.summary.cloud_tokens,
      fleetAnalytics.cost.summary.total_tokens,
    );
    assert.equal(fleetAnalytics.cost.organization_projection.modeled_non_halo_cloud_tokens, 1200000000);
    assert.equal(fleetAnalytics.cost.organization_projection.modeled_non_halo_estimated_cost_usd, 209000);
    assert.equal(fleetAnalytics.cost.organization_projection.annualization_weeks, 52);
    const agentIds = new Set(fleetAnalytics.dimensions.agents.map((row) => row.agent_id));
    assert.ok(fleetAnalytics.cost.detail_rows.every((row) => agentIds.has(row.agent_id)));
    const codeBuilderRows = fleetAnalytics.cost.detail_rows.filter((row) => row.agent_id === "code-builder");
    assert.equal(codeBuilderRows.reduce((total, row) => total + row.tasks, 0), 230);
    assert.equal(codeBuilderRows.reduce((total, row) => total + row.requests, 0), 337);
    assert.equal(codeBuilderRows.reduce((total, row) => total + row.total_tokens, 0), 660000);
    assert.equal(Math.round(codeBuilderRows.reduce((total, row) => total + row.estimated_cost_usd, 0) * 100), 10980);
    const dailyCost = fleetAnalytics.cost.daily_provider_cost.reduce(
      (total, row) => total + row.estimated_cost_usd,
      0,
    );
    assert.equal(Math.round(dailyCost * 100), Math.round(fleetAnalytics.cost.summary.estimated_cloud_cost_usd * 100));

    const fleetAnalyticsPostResponse = await fetch(
      `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/fleet/analytics`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(fleetAnalyticsPostResponse.status, 404);

    const fleetInfrastructureUrl =
      `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/fleet/infrastructure`;
    const fleetInfrastructureResponse = await fetch(fleetInfrastructureUrl);
    assert.equal(fleetInfrastructureResponse.status, 200);
    const fleetInfrastructure = await fleetInfrastructureResponse.json();
    assert.equal(fleetInfrastructure.source, "splunk_o11y_synthetic_demo");
    assert.equal(fleetInfrastructure.debug.fixture_backed, true);
    assert.equal(fleetInfrastructure.debug.synthetic, true);
    assert.equal(fleetInfrastructure.disclosure.status, "synthetic");
    assert.deepEqual(fleetInfrastructure.debug.requested_filters, {
      window: "-24h",
      resolution: "1h",
      device_id: null,
    });
    assert.equal(fleetInfrastructure.fleet_summary.avg_cpu_utilization.value, 39.75);
    assert.equal(fleetInfrastructure.fleet_summary.avg_memory_utilization.value, 66.5);
    assert.equal(fleetInfrastructure.fleet_summary.avg_gpu_utilization.value, 40.5);
    assert.equal(fleetInfrastructure.fleet_summary.total_network_receive.value, 366.4);
    assert.equal(fleetInfrastructure.fleet_summary.current_power.value, 375);
    assert.equal(fleetInfrastructure.fleet_summary.energy_7d.value, 62.3);
    assert.equal(fleetInfrastructure.fleet_summary.reporting_devices, 4);
    assert.equal(fleetInfrastructure.fleet_summary.stale_devices, 1);
    assert.equal(fleetInfrastructure.devices.length, 5);
    assert.equal(fleetInfrastructure.series.cpu_utilization.length, 25);
    assert.equal(fleetInfrastructure.series.cpu_utilization.at(-1).value, 39.75);
    assert.doesNotMatch(JSON.stringify(fleetInfrastructure), /(?:co2|carbon)/i);
    const nycInfrastructure = fleetInfrastructure.devices.find((row) => row.device_id === "DSK-NYC-014");
    assert.equal(nycInfrastructure.context.tokens_7d, 1280000);
    assert.equal(nycInfrastructure.metrics.network_link_speed.value, 1000);
    assert.equal(nycInfrastructure.metrics.network_link_speed.unit, "Mbps");
    assert.match(nycInfrastructure.metrics.gpu_utilization.source, /^splunk_o11y_/);
    const rtpInfrastructure = fleetInfrastructure.devices.find((row) => row.device_id === "DSK-RTP-006");
    assert.equal(rtpInfrastructure.stale, true);
    for (const metric of [
      "cpu_utilization",
      "memory_utilization",
      "gpu_utilization",
      "network_receive",
      "network_transmit",
      "network_link_utilization",
      "power",
    ]) {
      assert.equal(rtpInfrastructure.metrics[metric].value, null, `${metric} must remain unavailable`);
      assert.equal(rtpInfrastructure.metrics[metric].quality, "unavailable");
    }
    assert.equal(rtpInfrastructure.metrics.energy_24h.value, 0.78);
    assert.equal(rtpInfrastructure.metrics.energy_7d.value, 5.6);
    assert.equal(rtpInfrastructure.metrics.energy_7d.coverage, "partial");

    const selectedInfrastructureResponse = await fetch(
      `${fleetInfrastructureUrl}?window=-6h&resolution=6h&device_id=DSK-NYC-014`,
    );
    assert.equal(selectedInfrastructureResponse.status, 200);
    const selectedInfrastructure = await selectedInfrastructureResponse.json();
    assert.equal(selectedInfrastructure.devices.length, 1);
    assert.equal(selectedInfrastructure.devices[0].device_id, "DSK-NYC-014");
    assert.equal(selectedInfrastructure.scope.device_id, "DSK-NYC-014");
    assert.equal(selectedInfrastructure.fleet_summary.avg_cpu_utilization.value, 48);
    assert.equal(selectedInfrastructure.series.cpu_utilization.length, 2);
    assert.equal(selectedInfrastructure.series.cpu_utilization.at(-1).value, 48);

    for (const query of ["window=-7d", "resolution=5m", "device_id=bad%2Fdevice", "window=-1h&window=-6h"]) {
      const invalidResponse = await fetch(`${fleetInfrastructureUrl}?${query}`);
      assert.equal(invalidResponse.status, 400);
      assert.equal((await invalidResponse.json()).error, "invalid_request");
    }
    const missingInfrastructureResponse = await fetch(
      `${fleetInfrastructureUrl}?device_id=DSK-NOT-FOUND`,
    );
    assert.equal(missingInfrastructureResponse.status, 404);
    assert.deepEqual(await missingInfrastructureResponse.json(), {
      error: "infrastructure device not found",
      device_id: "DSK-NOT-FOUND",
    });

    const invalidPolicyResponse = await fetch(securityPolicyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: "true" }),
    });
    assert.equal(invalidPolicyResponse.status, 400);
    assert.match((await invalidPolicyResponse.json()).detail, /enabled must be a boolean/);

    const enablePolicyResponse = await fetch(securityPolicyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, expected_version: 1, reason: "arm critical response" }),
    });
    assert.equal(enablePolicyResponse.status, 200);
    const enabledPolicy = await enablePolicyResponse.json();
    assert.equal(enabledPolicy.auto_quarantine, true);
    assert.equal(enabledPolicy.changed, true);
    assert.equal(enabledPolicy.simulated, true);
    assert.equal(enabledPolicy.version, 2);

    const quarantineResponse = await fetch(desksideActionUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "quarantine", reason: "fixture critical breach" }),
    });
    assert.equal(quarantineResponse.status, 200);
    const quarantined = await quarantineResponse.json();
    assert.equal(quarantined.changed, true);
    assert.equal(quarantined.network_actions_are_simulated, true);
    assert.equal(quarantined.device.quarantined, true);
    assert.equal(quarantined.fleet.quarantined_devices, initialQuarantined + 1);
    assert.equal(quarantined.events.length, 4);
    assert.equal(quarantined.events.at(-1).title, "C9350 restricted access");
    assert.match(quarantined.events.find((event) => event.stage === "coa").detail, /^C9350-AUS-02 /);
    assert.equal(quarantined.timeline_count, initialTimeline + 4);

    const repeatedQuarantineResponse = await fetch(desksideActionUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "quarantine" }),
    });
    assert.equal(repeatedQuarantineResponse.status, 200);
    const repeatedQuarantine = await repeatedQuarantineResponse.json();
    assert.equal(repeatedQuarantine.changed, false);
    assert.deepEqual(repeatedQuarantine.events, []);
    assert.equal(repeatedQuarantine.timeline_count, initialTimeline + 4);

    const disablePolicyResponse = await fetch(securityPolicyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false, expected_version: 2, reason: "monitor only" }),
    });
    assert.equal(disablePolicyResponse.status, 200);
    const disabledPolicy = await disablePolicyResponse.json();
    assert.equal(disabledPolicy.auto_quarantine, false);
    assert.equal(disabledPolicy.existing_quarantines_released, false);
    assert.equal(disabledPolicy.version, 3);

    const afterDisableFleetResponse = await fetch(fleetOverviewUrl);
    assert.equal(afterDisableFleetResponse.status, 200);
    const afterDisableFleet = await afterDisableFleetResponse.json();
    const stillQuarantined = afterDisableFleet.devices.find((row) => row.device_id === "DSK-AUS-017");
    assert.equal(stillQuarantined.quarantined, true);
    assert.equal(afterDisableFleet.fleet.quarantined_devices, initialQuarantined + 1);

    const restoreResponse = await fetch(desksideActionUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "restore", reason: "fixture recovery" }),
    });
    assert.equal(restoreResponse.status, 200);
    const restored = await restoreResponse.json();
    assert.equal(restored.changed, true);
    assert.equal(restored.device.quarantined, false);
    assert.equal(restored.fleet.quarantined_devices, initialQuarantined);
    assert.equal(restored.events.length, 4);
    assert.equal(restored.events.at(-1).title, "C9350 restored access");
    assert.equal(restored.timeline_count, initialTimeline + 8);

    const repeatedRestoreResponse = await fetch(desksideActionUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "restore" }),
    });
    assert.equal(repeatedRestoreResponse.status, 200);
    const repeatedRestore = await repeatedRestoreResponse.json();
    assert.equal(repeatedRestore.changed, false);
    assert.deepEqual(repeatedRestore.events, []);
    assert.equal(repeatedRestore.timeline_count, initialTimeline + 8);

    const quarantineBeforeResetResponse = await fetch(desksideActionUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "quarantine", reason: "leave mutated before reset" }),
    });
    assert.equal(quarantineBeforeResetResponse.status, 200);
    assert.equal((await quarantineBeforeResetResponse.json()).changed, true);

    const fleetResetUrl = `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/fleet/demo/reset`;
    const invalidResetResponse = await fetch(fleetResetUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "bad\nreason" }),
    });
    assert.equal(invalidResetResponse.status, 400);
    assert.match((await invalidResetResponse.json()).detail, /must be one line/);

    const resetResponse = await fetch(fleetResetUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "prepare the next presenter run" }),
    });
    assert.equal(resetResponse.status, 200);
    const reset = await resetResponse.json();
    assert.deepEqual(reset.reset, {
      completed: true,
      reason: "prepare the next presenter run",
      simulated: true,
    });
    assert.deepEqual(reset.security_policy, initialFleet.security_policy);
    assert.equal(reset.fleet.quarantined_devices, initialQuarantined);
    assert.equal(reset.fleet.network_action_count, initialFleet.fleet.network_action_count);
    assert.deepEqual(reset.enforcement_events, initialFleet.enforcement_events);
    assert.deepEqual(
      reset.devices.find((row) => row.device_id === "DSK-AUS-017"),
      initialAusDeskside,
    );

    const afterResetResponse = await fetch(fleetOverviewUrl);
    assert.equal(afterResetResponse.status, 200);
    assert.deepEqual(await afterResetResponse.json(), initialFleet);

    const restoreAfterResetResponse = await fetch(desksideActionUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "restore" }),
    });
    assert.equal(restoreAfterResetResponse.status, 200);
    const restoreAfterReset = await restoreAfterResetResponse.json();
    assert.equal(restoreAfterReset.changed, false);
    assert.deepEqual(restoreAfterReset.events, []);
    const finalFleetResponse = await fetch(fleetOverviewUrl);
    assert.equal(finalFleetResponse.status, 200);
    assert.deepEqual(await finalFleetResponse.json(), initialFleet);

    const controlResponse = await fetch(
      `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/controls/apply`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: "*", session_token_budget: 100000, action: "deny" }),
      },
    );
    assert.equal(controlResponse.status, 200);
    const control = await controlResponse.json();
    assert.equal(control.session_token_budget, 100000);
    assert.equal(control.fixture_backed, true);

    const policiesResponse = await fetch(
      `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/policies/effective?agent_id=*`,
    );
    assert.equal(policiesResponse.status, 200);
    const policies = await policiesResponse.json();
    assert.equal(policies.length, 1);
    assert.equal(policies[0].action, "deny");

    const allowResponse = await fetch(
      `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/agent-controls/allow`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target_type: "command", target_name: "npm test", reason: "fixture smoke" }),
      },
    );
    assert.equal(allowResponse.status, 200);
    const allowedResponse = await fetch(
      `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/agent-controls/allowed`,
    );
    assert.equal(allowedResponse.status, 200);
    const allowed = await allowedResponse.json();
    assert.ok(allowed.some((row) => row.target_type === "command" && row.target_name === "npm test"));

    const removeResponse = await fetch(
      `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/agent-controls/remove`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target_type: "command", target_name: "npm test" }),
      },
    );
    assert.equal(removeResponse.status, 200);
    const allowedAfterRemoveResponse = await fetch(
      `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/agent-controls/allowed`,
    );
    assert.equal(allowedAfterRemoveResponse.status, 200);
    const allowedAfterRemove = await allowedAfterRemoveResponse.json();
    assert.equal(
      allowedAfterRemove.some((row) => row.target_type === "command" && row.target_name === "npm test"),
      false,
    );

    const multilineControlResponse = await fetch(
      `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/agent-controls/allow`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target_type: "command", target_name: "git status\ngit push" }),
      },
    );
    assert.equal(multilineControlResponse.status, 400);
    assert.match((await multilineControlResponse.json()).error, /must be one line/);

    const releaseResponse = await fetch(
      `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/controls/release`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: "*" }),
      },
    );
    assert.equal(releaseResponse.status, 200);
    const policiesAfterReleaseResponse = await fetch(
      `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/policies/effective?agent_id=*`,
    );
    assert.equal(policiesAfterReleaseResponse.status, 200);
    assert.deepEqual(await policiesAfterReleaseResponse.json(), []);

    const traversalResponse = await fetch(`http://127.0.0.1:${appPort}/shell/..%2fpackage.json`);
    assert.equal(traversalResponse.status, 403);

    const malformedPathResponse = await fetch(`http://127.0.0.1:${appPort}/%E0%A4%A`);
    assert.equal(malformedPathResponse.status, 400);
    assert.equal(child.exitCode, null);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
