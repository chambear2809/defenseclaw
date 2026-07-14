const { expect, test } = require("@playwright/test");

// This suite intentionally targets the shared live demo and restores policy state.

const DEFAULT_OPENCLAW_URL = "https://openclaw.rosa.fso-tme.eoha.p3.openshiftapps.com/chat";
const DEFAULT_TOKENOMICS_UI_URL =
  "http://af31cb07e415c4ab5bd8ec217303cdc3-813587964.us-east-1.elb.amazonaws.com/?view=tokenomics";
const AGENT_ID = process.env.TOKENOMICS_E2E_AGENT_ID || "main";
const PERMISSIVE_TOKEN_BUDGET = 9_000_000_000;

const BASELINE_PROMPT = `Run a fresh, read-only TeaStore incident check. Do not use earlier chat history,
do not ask to proceed, and do not make any changes.

1. Call splunk-observability-cloud__o11y_search_alerts_or_incidents with:
   {"params":{"time_range":{"start":"-2h","stop":"now"},"detector_id":"HI-D6XZA4AE","include_inactive":false,"limit":10}}
2. Use exec only for this read-only command:
   kubectl -n teastore get deploy,svc,pods -o wide
3. Call thousandeyes-mcp__list_network_app_synthetics_tests with:
   {"name":"defenseclaw-demo-teastore-k8s","type":"http-server","target":"teastore-webui","detail":"compact","page_size":20}
4. Summarize the O11y alert, Kubernetes health, ThousandEyes reuse decision,
   DefenseClaw policy gates, and recommended next action.

Do not call create, update, delete, Instant Test, or Kubernetes mutation tools.
Label any tool failure clearly.`;

const BLOCKED_FOLLOW_UP = `Re-check the TeaStore Kubernetes pod status in read-only mode and summarize
only what changed since the previous check.`;

function resolveURLs() {
  const tokenomicsUI = new URL(process.env.TOKENOMICS_UI_URL || DEFAULT_TOKENOMICS_UI_URL);
  const tokenomicsAPI = process.env.TOKENOMICS_API_URL
    ? new URL(process.env.TOKENOMICS_API_URL)
    : new URL("/v1/c3/agent-tokenomics", tokenomicsUI);
  const tokenomicsHealth = process.env.TOKENOMICS_HEALTH_URL
    ? new URL(process.env.TOKENOMICS_HEALTH_URL)
    : new URL("/healthz", tokenomicsUI);
  return {
    gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN || "",
    openClaw: process.env.OPENCLAW_CHAT_URL || DEFAULT_OPENCLAW_URL,
    tokenomicsAPI: tokenomicsAPI.toString().replace(/\/$/, ""),
    tokenomicsHealth: tokenomicsHealth.toString(),
    tokenomicsUI: tokenomicsUI.toString(),
  };
}

async function responseJSON(response, operation) {
  const body = await response.text();
  if (!response.ok()) {
    throw new Error(`${operation} failed with HTTP ${response.status()}: ${body}`);
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch (error) {
    throw new Error(`${operation} returned non-JSON content: ${body.slice(0, 500)}`, { cause: error });
  }
}

async function getJSON(request, url, operation) {
  return responseJSON(await request.get(url), operation);
}

async function postJSON(request, url, payload, operation) {
  return responseJSON(await request.post(url, { data: payload }), operation);
}

async function retry(operation, label, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts`, { cause: lastError });
}

function policyPayload(policy) {
  const payload = {
    agent_id: policy.agent_id,
    agent_name: policy.agent_name || policy.agent_id,
    action: policy.action || "deny",
    updated_by: policy.updated_by || "tokenomics-playwright-restore",
    source: policy.source || "tokenomics-playwright-restore",
  };
  for (const key of [
    "session_token_budget",
    "daily_token_budget",
    "session_cost_budget_usd",
    "daily_cost_budget_usd",
  ]) {
    if (Number(policy[key]) > 0) {
      payload[key] = policy[key];
    }
  }
  return payload;
}

async function exactPolicy(request, apiBase, agentID) {
  const policies = await getJSON(request, `${apiBase}/policies/effective`, "list effective policies");
  return policies.find((policy) => policy.agent_id === agentID) || null;
}

function policyMatches(actual, expected) {
  if (!actual) {
    return false;
  }
  for (const key of ["agent_id", "agent_name", "action"]) {
    if (expected[key] !== undefined && actual[key] !== expected[key]) {
      return false;
    }
  }
  for (const key of [
    "session_token_budget",
    "daily_token_budget",
    "session_cost_budget_usd",
    "daily_cost_budget_usd",
  ]) {
    if (expected[key] !== undefined && Number(actual[key] || 0) !== Number(expected[key] || 0)) {
      return false;
    }
  }
  return true;
}

async function openAlertsFor(request, apiBase, agentID) {
  const alerts = await getJSON(request, `${apiBase}/alerts?limit=100`, "list budget alerts");
  return alerts.filter((alert) => alert.agent_id === agentID && alert.status === "open");
}

async function summary(request, apiBase) {
  return getJSON(request, `${apiBase}/summary?include_galileo=true`, "load tokenomics summary");
}

async function usageRows(request, apiBase) {
  return getJSON(request, `${apiBase}/usage/rows?window=-1h`, "load tokenomics usage rows");
}

async function fillPolicyForm(page, request, apiBase, policy, attempts = 5) {
  const button = page.getByRole("button", { name: "Apply Policy" });
  let lastResult = "no request was sent";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await page.locator("#agent-id").fill(policy.agent_id);
    await page.locator("#agent-name").fill(policy.agent_name || policy.agent_id);
    await page.locator("#policy-action").selectOption(policy.action);
    await page.locator("#session-token-budget").fill(String(policy.session_token_budget || ""));
    await page.locator("#daily-token-budget").fill(String(policy.daily_token_budget || ""));
    await page.locator("#session-cost-budget").fill(String(policy.session_cost_budget_usd || ""));
    await page.locator("#daily-cost-budget").fill(String(policy.daily_cost_budget_usd || ""));

    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.request().method() === "POST" &&
          candidate.url().includes("/v1/c3/agent-tokenomics/controls/apply"),
        { timeout: 20_000 },
      ),
      button.click(),
    ]);
    await expect(button).toBeEnabled({ timeout: 20_000 });

    const banner = (await page.locator("#status-banner").innerText()).trim();
    const current = await retry(
      () => exactPolicy(request, apiBase, policy.agent_id),
      `verify ${policy.agent_id} policy after GUI apply`,
      3,
    );
    const uiSucceeded = banner.includes(`Applied ${policy.action} policy for ${policy.agent_id}.`);
    if (response.ok() && uiSucceeded && policyMatches(current, policy)) {
      return;
    }

    lastResult = `HTTP ${response.status()}, banner=${JSON.stringify(banner)}, policy=${JSON.stringify(current)}`;
    if (attempt < attempts) {
      await page.waitForTimeout(attempt * 1_000);
    }
  }

  throw new Error(`GUI policy apply failed after ${attempts} attempts: ${lastResult}`);
}

async function releasePolicyThroughGUI(page, request, apiBase, agentID, attempts = 5) {
  let lastResult = "no request was sent";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const release = page.locator(`#policies-list [data-release-agent-id="${agentID}"]`);
    const currentBefore = await retry(
      () => exactPolicy(request, apiBase, agentID),
      `load ${agentID} policy before GUI release`,
      3,
    );
    if (!(await release.isVisible()) && currentBefore === null) {
      await page.getByRole("button", { name: "Refresh" }).click();
      await expect(page.locator("#policies-list")).not.toContainText(agentID);
      return;
    }
    await expect(release).toBeVisible();

    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.request().method() === "POST" &&
          candidate.url().includes("/v1/c3/agent-tokenomics/controls/release"),
        { timeout: 20_000 },
      ),
      release.click(),
    ]);
    const banner = (await page.locator("#status-banner").innerText()).trim();
    const current = await retry(
      () => exactPolicy(request, apiBase, agentID),
      `verify ${agentID} policy after GUI release`,
      3,
    );
    const uiSucceeded = banner.includes(`Released policy for ${agentID}.`);
    if (response.ok() && uiSucceeded && current === null) {
      return;
    }

    lastResult = `HTTP ${response.status()}, banner=${JSON.stringify(banner)}, policy=${JSON.stringify(current)}`;
    if (attempt < attempts) {
      await page.waitForTimeout(attempt * 1_000);
    }
  }

  throw new Error(`GUI policy release failed after ${attempts} attempts: ${lastResult}`);
}

async function sendChatMessage(page, message, timeout) {
  const userGroups = page.locator(".chat-group.user");
  const assistantGroups = page.locator(".chat-group.assistant");
  const usersBefore = await userGroups.count();
  const assistantsBefore = await assistantGroups.count();
  const composer = page.locator(".agent-chat__input textarea");

  await expect(composer).toBeVisible();
  await expect(composer).toBeEnabled();
  await composer.fill(message);
  await page.getByRole("button", { name: "Send message" }).click();

  await expect.poll(() => userGroups.count(), { timeout }).toBeGreaterThan(usersBefore);
  await expect.poll(() => assistantGroups.count(), { timeout }).toBeGreaterThan(assistantsBefore);
  await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0, { timeout });

  const response = (await assistantGroups.last().innerText()).trim();
  expect(response.length).toBeGreaterThan(0);
  return response;
}

async function connectOpenClaw(page, gatewayToken) {
  const composer = page.locator(".agent-chat__input textarea");
  if (await composer.isVisible()) {
    return;
  }

  const tokenInput = page.locator('input[placeholder*="OPENCLAW_GATEWAY_TOKEN"]');
  await expect(tokenInput).toBeVisible();
  if (!gatewayToken) {
    throw new Error(
      "OpenClaw requires authentication. Set OPENCLAW_GATEWAY_TOKEN or provide an authenticated storage state.",
    );
  }
  await tokenInput.fill(gatewayToken);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(composer).toBeVisible({ timeout: 45_000 });
  await expect(composer).toBeEnabled();
}

async function restorePolicy(request, apiBase, originalPolicy) {
  let releaseError = null;
  try {
    await retry(
      () => postJSON(request, `${apiBase}/controls/release`, { agent_id: AGENT_ID }, "cleanup test policy"),
      "cleanup test policy",
    );
  } catch (error) {
    releaseError = error;
  }
  if (originalPolicy) {
    await retry(
      () => postJSON(request, `${apiBase}/controls/apply`, policyPayload(originalPolicy), "restore original policy"),
      "restore original policy",
    );
    return;
  }
  if (releaseError) {
    throw releaseError;
  }
}

test("OpenClaw usage is governed through the live Tokenomics GUI", async ({ context, page, request }, testInfo) => {
  const urls = resolveURLs();
  const uniqueSession = `agent:${AGENT_ID}:tokenomics-playwright-${Date.now()}`;
  const openClawURL = new URL(urls.openClaw);
  openClawURL.searchParams.set("session", uniqueSession);

  let originalPolicy = null;
  let policyStateChanged = false;
  let primaryError = null;

  try {
    await test.step("Verify the live Tokenomics contract", async () => {
      const health = await getJSON(request, urls.tokenomicsHealth, "check proxy health");
      expect(health.status).toMatch(/^(ok|ready)$/);

      const initialSummary = await summary(request, urls.tokenomicsAPI);
      expect(initialSummary.source).toBe("defenseclaw_gateway_ledger");
      expect(initialSummary.debug.fixture_backed).toBe(false);

      originalPolicy = await exactPolicy(request, urls.tokenomicsAPI, AGENT_ID);
      await testInfo.attach("initial-live-state", {
        body: Buffer.from(JSON.stringify({ health, originalPolicy, summary: initialSummary.summary }, null, 2)),
        contentType: "application/json",
      });
    });

    await test.step("Prepare a permissive policy through the GUI", async () => {
      await page.goto(urls.tokenomicsUI, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Tokenomics Control Plane" })).toBeVisible();
      await page.getByRole("button", { name: "Refresh" }).click();

      policyStateChanged = true;
      await fillPolicyForm(page, request, urls.tokenomicsAPI, {
        agent_id: AGENT_ID,
        agent_name: AGENT_ID,
        action: "steer",
        session_token_budget: PERMISSIVE_TOKEN_BUDGET,
        daily_token_budget: PERMISSIVE_TOKEN_BUDGET,
      });

      await expect.poll(() => openAlertsFor(request, urls.tokenomicsAPI, AGENT_ID)).toHaveLength(0);
      await expect(page.locator("#policies-list")).toContainText(AGENT_ID);
    });

    const beforeChat = await summary(request, urls.tokenomicsAPI);
    const tokensBefore = Number(beforeChat.summary.total_tokens || 0);
    const requestsBefore = Number(beforeChat.summary.request_count || 0);
    const rowsBeforeChat = await retry(
      () => usageRows(request, urls.tokenomicsAPI),
      "snapshot tokenomics usage rows",
    );
    const usageRequestIDsBefore = new Set(
      (rowsBeforeChat.rows || []).map((row) => row.request_id).filter(Boolean),
    );
    const chatStartedAt = Date.now();

    const chatPage = await context.newPage();
    await test.step("Run the read-only TeaStore workflow in OpenClaw Chat", async () => {
      await chatPage.goto(openClawURL.toString(), { waitUntil: "domcontentloaded" });
      await expect(chatPage).toHaveTitle(/OpenClaw Control/i);
      await connectOpenClaw(chatPage, urls.gatewayToken);

      const response = await sendChatMessage(
        chatPage,
        process.env.OPENCLAW_E2E_PROMPT || BASELINE_PROMPT,
        Number(process.env.OPENCLAW_E2E_PROMPT_TIMEOUT_MS || 4 * 60 * 1000),
      );
      await testInfo.attach("openclaw-baseline-response", {
        body: Buffer.from(response),
        contentType: "text/plain",
      });
      expect(response.toLowerCase()).not.toContain("sidecar unreachable");
      expect(response).toMatch(/TeaStore/i);
    });

    await test.step("Wait for the OpenClaw turn to reach the live ledger", async () => {
      await expect
        .poll(
          async () => {
            const current = await summary(request, urls.tokenomicsAPI);
            return (
              Number(current.summary.total_tokens || 0) > tokensBefore ||
              Number(current.summary.request_count || 0) > requestsBefore
            );
          },
          {
            timeout: Number(process.env.TOKENOMICS_EXPORT_TIMEOUT_MS || 90_000),
            intervals: [2_000, 5_000, 10_000],
          },
        )
        .toBe(true);

      const afterChat = await summary(request, urls.tokenomicsAPI);
      expect(
        Number(afterChat.summary.total_tokens || 0) > tokensBefore ||
          Number(afterChat.summary.request_count || 0) > requestsBefore,
      ).toBe(true);

      let newUsageRows = [];
      await expect
        .poll(
          async () => {
            const payload = await usageRows(request, urls.tokenomicsAPI);
            newUsageRows = (payload.rows || []).filter(
              (row) =>
                row.agent_name === AGENT_ID &&
                row.connector === "openclaw" &&
                Number(row.tokens || 0) > 0 &&
                !usageRequestIDsBefore.has(row.request_id) &&
                Date.parse(row.timestamp || "") >= chatStartedAt - 5_000,
            );
            return newUsageRows.length;
          },
          {
            timeout: Number(process.env.TOKENOMICS_EXPORT_TIMEOUT_MS || 90_000),
            intervals: [2_000, 5_000, 10_000],
          },
        )
        .toBeGreaterThan(0);
      await testInfo.attach("new-live-usage-rows", {
        body: Buffer.from(JSON.stringify(newUsageRows, null, 2)),
        contentType: "application/json",
      });

      await page.bringToFront();
      await page.getByRole("button", { name: "Refresh" }).click();
      await expect(page.locator("#tokenomics-ledger-status")).toContainText("1-device live ledger");
    });

    await test.step("Apply a deterministic deny policy through the GUI", async () => {
      await fillPolicyForm(page, request, urls.tokenomicsAPI, {
        agent_id: AGENT_ID,
        agent_name: AGENT_ID,
        action: "deny",
        session_token_budget: 1,
        daily_token_budget: 1,
      });

      await expect.poll(() => openAlertsFor(request, urls.tokenomicsAPI, AGENT_ID)).not.toHaveLength(0);
      await expect(page.locator("#policies-list")).toContainText("deny");
      await expect(page.locator("#alerts-list")).toContainText(AGENT_ID);
    });

    await test.step("Show the budget denial in OpenClaw Chat", async () => {
      await chatPage.bringToFront();
      const blockedResponse = await sendChatMessage(
        chatPage,
        BLOCKED_FOLLOW_UP,
        Number(process.env.OPENCLAW_E2E_BLOCK_TIMEOUT_MS || 60_000),
      );
      await testInfo.attach("openclaw-blocked-response", {
        body: Buffer.from(blockedResponse),
        contentType: "text/plain",
      });
      expect(blockedResponse).toMatch(/token (?:budgets?|limits?)/i);
      expect(blockedResponse).toMatch(/exceed(?:ed|ing)|exhausted|usage limits? (?:has been |was )?reached/i);
      expect(blockedResponse).toMatch(/unable to|prevent(?:ed|ing|s)|blocked|refused/i);
      expect(blockedResponse.toLowerCase()).not.toContain("sidecar unreachable");
    });

    await test.step("Review policy evidence across the Tokenomics GUI", async () => {
      await page.bringToFront();
      await page.getByRole("button", { name: "Refresh" }).click();
      await expect(page.locator("#status-banner")).toContainText(/live budget alert/i);
      await expect(page.locator("#alerts-list")).toContainText(AGENT_ID);
      await expect(page.locator("#policies-list")).toContainText(AGENT_ID);
    });

    await test.step("Release the policy through the GUI", async () => {
      await releasePolicyThroughGUI(page, request, urls.tokenomicsAPI, AGENT_ID);
      await expect.poll(() => exactPolicy(request, urls.tokenomicsAPI, AGENT_ID)).toBeNull();
    });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (policyStateChanged) {
      try {
        await restorePolicy(request, urls.tokenomicsAPI, originalPolicy);
      } catch (cleanupError) {
        await testInfo.attach("policy-cleanup-error", {
          body: Buffer.from(String(cleanupError && cleanupError.stack ? cleanupError.stack : cleanupError)),
          contentType: "text/plain",
        });
        if (!primaryError) {
          throw cleanupError;
        }
      }
    }
  }
});
