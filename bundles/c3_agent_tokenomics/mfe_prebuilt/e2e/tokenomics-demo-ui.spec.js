const { expect, test } = require("@playwright/test");

const API_BASE = "http://127.0.0.1:3001/v1/c3/agent-tokenomics";
const DEMO_DEVICE = "DSK-AUS-017";
const AGENT_CONTROL_TABS = [
  { key: "controls", label: "Controls", panel: "#agent-controls-panel", path: "/agent-controls" },
  { key: "studio", label: "Policy Studio", panel: "#policy-studio-page", path: "/policy-studio" },
  { key: "behavior", label: "Agent Behavior", panel: "#agent-behavior-page", path: "/agent-behavior" },
];
const SHELL_NAV_ITEMS = ["Fleet", "Infrastructure", "Tokenomics", "Agent Control", "Network Security"];

async function resetDemoState(request) {
  const response = await request.post(`${API_BASE}/fleet/demo/reset`, {
    data: { reason: "Playwright synthetic demo reset" },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function expectNoPageOverflow(page) {
  const hasPageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasPageOverflow).toBe(false);
}

async function expectVisibleWordCountAtMost(locator, maximum) {
  await expect(locator).toBeVisible();
  const wordCount = await locator.evaluate((element) => {
    let visibleText = element.innerText;
    element.querySelectorAll(".visually-hidden").forEach((hiddenElement) => {
      visibleText = visibleText.replace(hiddenElement.innerText || hiddenElement.textContent || "", "");
    });
    return visibleText.trim().split(/\s+/).filter(Boolean).length;
  });
  expect(wordCount).toBeLessThanOrEqual(maximum);
}

async function expectSwitchState(page, selector, enabled) {
  const toggle = page.locator(selector);
  await expect(toggle).toHaveAttribute("aria-checked", enabled ? "true" : "false");
  await expect(toggle.locator("b")).toHaveText(enabled ? "Enabled" : "Disabled");
  const labels = (await page.locator('[role="switch"]').allTextContents()).map((label) => label.trim());
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.every((label) => label === "Enabled" || label === "Disabled")).toBe(true);
}

async function expectAgentControlTab(page, activeKey) {
  const activeConfig = AGENT_CONTROL_TABS.find((tab) => tab.key === activeKey);
  expect(activeConfig).toBeTruthy();

  const tabList = page.locator("#agent-control-tabs");
  await expect(tabList).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agent Control", exact: true, level: 1 })).toBeVisible();
  await expect(page.locator("#agent-controls-page h1")).toHaveCount(1);
  expect((await tabList.getByRole("tab").allTextContents()).map((label) => label.trim())).toEqual(
    AGENT_CONTROL_TABS.map((tab) => tab.label),
  );

  for (const tabConfig of AGENT_CONTROL_TABS) {
    const selected = tabConfig.key === activeKey;
    const tab = page.locator(`#agent-control-tab-${tabConfig.key}`);
    await expect(tab).toHaveAttribute("aria-selected", selected ? "true" : "false");
    await expect(tab).toHaveAttribute("tabindex", selected ? "0" : "-1");
    if (selected) {
      await expect(page.locator(tabConfig.panel)).toBeVisible();
    } else {
      await expect(page.locator(tabConfig.panel)).toBeHidden();
    }
  }

  const controlsNav = page.locator('[data-shell-nav="controls"]');
  await expect(controlsNav).toHaveCount(1);
  await expect(controlsNav).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-shell-nav="behavior"], [data-shell-nav="studio"]')).toHaveCount(0);
  await expect(page.locator('[data-shell-nav][aria-current="page"]')).toHaveCount(1);
  expect(
    (await page.locator(".side-nav [data-shell-nav] > span:last-child").allTextContents()).map((label) => label.trim()),
  ).toEqual(SHELL_NAV_ITEMS);
  await expect(page).toHaveURL(new RegExp(`${activeConfig.path.replace("/", "\\/")}$`));
}

test("the AMD Halo fleet, guardrail, and quarantine stories stay repeatable", async ({ page, request }) => {
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  const baseline = await resetDemoState(request);
  try {
    await page.goto("/fleet");
    await expect(page).toHaveTitle("Fleet Overview | Deskside AI Resilience | Cloud Control");
    await expect(page.locator(".crumbs > span").nth(1)).toHaveText("Deskside AI Resilience");
    await expect(page.getByRole("heading", { name: "Fleet Overview" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Network Security" })).toBeVisible();
    await expect(page.locator("#fleet-data-source")).toContainText("Synthetic fleet + fixture ledger");
    await expect(page.locator("#fleet-network-identity")).toContainText("C9550 core pair");
    await expect(page.locator("#fleet-network-identity")).toContainText("C9350 access");
    await expect(page.locator("#fleet-network-identity")).toContainText("ISE-correlated endpoints");
    await expect(page.locator("#fleet-agent-identities")).toContainText("67 workload");
    await expect(page.locator("#fleet-agent-identities")).toContainText("24 DefenseClaw residents");
    await expect(page.locator("#fleet-summary-grid")).toContainText("Network Security");
    await expect(page.locator("#fleet-summary-grid")).toContainText("Agent Behavior");
    await expect(page.locator("#fleet-summary-grid")).toContainText("Tokenomics");
    const fleetTokenomics = page.locator("#fleet-summary-grid .pillar-tokenomics");
    await expect(fleetTokenomics).toContainText("1.3B");
    await expect(fleetTokenomics).toContainText("$220.9K");
    await expect(fleetTokenomics).toContainText("estimated spend · 7d");
    await expect(page.locator("#hardware-story")).toHaveCount(0);
    await expect(page.locator("#keynote-architecture")).toHaveCount(0);
    await expect(page.locator("#fleet-inventory-summary")).toContainText("AMD Ryzen AI Halo devices");
    await expect(page.locator("#fleet-inventory-summary")).toContainText("workload agent identities");
    await expect(page.locator("#deskside-list")).toContainText("AMD Ryzen AI Halo");
    await expect(page.locator("#deskside-list")).toContainText("Cisco C9350 Series");
    await expect(page.locator("#deskside-list")).toContainText("GPU 18%");
    await expect(page.locator("#deskside-list")).toContainText("1.2M tokens");
    await expectSwitchState(page, "#fleet-auto-quarantine-toggle", false);

    const inventoryView = page.locator('[data-fleet-view="inventory"]');
    const infrastructureView = page.locator('[data-fleet-view="infrastructure"]');
    await expect(inventoryView).toHaveAttribute("aria-pressed", "true");
    await expect(infrastructureView).toHaveAttribute("aria-pressed", "false");
    await inventoryView.focus();
    await page.keyboard.press("Tab");
    await expect(infrastructureView).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(infrastructureView).toHaveAttribute("aria-pressed", "true");
    await expect(inventoryView).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#fleet-table-title")).toHaveText("Managed infrastructure telemetry");
    await expect(page.locator("#fleet-telemetry-source")).toContainText("Splunk Observability");
    await expect(page.locator("#fleet-inventory-summary")).toContainText("CPU utilization");
    await expect(page.locator("#fleet-inventory-summary")).toContainText("40%");
    await expect(page.locator("#fleet-inventory-summary")).toContainText("Memory utilization");
    await expect(page.locator("#fleet-inventory-summary")).toContainText("67%");
    await expect(page.locator("#fleet-inventory-summary")).toContainText("GPU utilization");
    await expect(page.locator("#fleet-inventory-summary")).toContainText("41%");
    await expect(page.locator("#fleet-inventory-summary")).toContainText("Network utilization");
    await expect(page.locator("#fleet-inventory-summary")).toContainText("366.4 Mbps");
    await expect(page.locator("#fleet-inventory-summary")).toContainText("93.1 Mbps");
    await expect(page.locator("#fleet-inventory-summary")).toContainText("Energy consumption");
    await expect(page.locator("#fleet-inventory-summary")).toContainText("62.3 kWh");
    await expect(page.locator("#fleet-inventory-summary")).toContainText("375 W now");
    await expect(page.locator("#deskside-list .infrastructure-device-table")).toContainText("CPU 48%");
    await expect(page.locator("#deskside-list .infrastructure-device-table")).toContainText("MEM 72%");
    await expect(page.locator("#deskside-list .infrastructure-device-table")).toContainText("GPU 61%");
    await expect(page.locator("#deskside-list .infrastructure-device-table")).toContainText("112 W");
    await expect(page.locator("#deskside-list .infrastructure-device-table")).toContainText("2.34 kWh / 24h");

    const offlineInfrastructureRow = page
      .locator("#deskside-list .infrastructure-device-table tbody tr")
      .filter({ hasText: "DSK-RTP-006" });
    await expect(offlineInfrastructureRow).toHaveCount(1);
    await expect(offlineInfrastructureRow).toContainText("Offline");
    await expect(offlineInfrastructureRow).toContainText("CPU —");
    await expect(offlineInfrastructureRow).toContainText("MEM —");
    await expect(offlineInfrastructureRow).toContainText("GPU —");
    await expect(offlineInfrastructureRow).toContainText("No recent sample");
    await expect(offlineInfrastructureRow).not.toContainText("CPU 0%");
    await expect(offlineInfrastructureRow).not.toContainText("MEM 0%");
    await expect(offlineInfrastructureRow).not.toContainText("GPU 0%");
    await expect(offlineInfrastructureRow).not.toContainText("↓ 0 Mbps");
    await expect(offlineInfrastructureRow).not.toContainText("↑ 0 Mbps");
    await expect(offlineInfrastructureRow).not.toContainText("0 W");
    await expect(offlineInfrastructureRow).toContainText("0.78 kWh / 24h");
    await expect(offlineInfrastructureRow).toContainText("5.6 kWh / 7d");

    await page.keyboard.press("Shift+Tab");
    await expect(inventoryView).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(inventoryView).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#fleet-table-title")).toHaveText("Managed AI inventory");
    await expect(page.locator("#deskside-list .infrastructure-device-table")).toHaveCount(0);
    await expect(page.locator("#deskside-list")).toContainText("Cisco C9350 Series");

    await page.goto("/agent-behavior");
    await expectAgentControlTab(page, "behavior");
    await expect(page).toHaveTitle("Agent Behavior | Agent Control | Deskside AI Resilience | Cloud Control");
    await expect(page.getByRole("heading", { name: "Agent Behavior" })).toBeVisible();
    await expect(page.locator("#behavior-summary-grid")).toContainText("94%");
    await expect(page.locator("#behavior-summary-grid")).toContainText("111");
    await expect(page.locator("#behavior-outcome-list")).toContainText("Software delivery");
    await expect(page.locator("#behavior-agent-table")).toContainText("Meeting Notes Pro");

    await page.goto("/budgets");
    await expect(page.getByRole("tab", { name: "Cost" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tokenomics-ledger-status")).toContainText("Fixture ledger");
    await expect(page.locator("#summary-grid")).toHaveCount(0);
    await expect(page.locator("#tokenomics-analytics-source")).toContainText("Synthetic organization view");
    await expect(page.locator("#cost-summary-grid")).toContainText("1.3B");
    await expect(page.locator("#cost-summary-grid")).toContainText("Projected Annual Spend");
    await expect(page.locator("#cost-summary-grid")).toContainText("$11,484,905.12");
    await expect(page.locator("#cost-summary-grid")).toContainText("29");
    const agentRecommendation = page.locator("#tokenomics-opportunity-list");
    await expect(agentRecommendation.locator(".token-opportunity-row")).toHaveCount(1);
    await expect(agentRecommendation).toContainText("Heavy cloud spend");
    await expect(agentRecommendation).toContainText("Product Planner");
    await expect(agentRecommendation).toContainText("$11,698.00");
    await expect(agentRecommendation).toContainText("71M cloud tokens / 7d");
    await expect(agentRecommendation).toContainText("0% local execution");
    await expect(agentRecommendation).toContainText("Recommendation: Move eligible Product Planner workloads to local inferencing.");
    await expect(agentRecommendation).not.toContainText("Halo acquisition opportunity");
    await expect(page.locator("#cost-breakdown-bars .cost-bar-row")).toHaveCount(6);
    await expect(page.locator("#cost-breakdown-controls [data-cost-breakdown='agent']")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#usage-detail-dimensions [data-usage-dimension='agent']")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#agent-economics-table tbody tr")).toHaveCount(6);
    await expect(page.locator("#agent-economics-table")).toContainText("Product Planner");
    await expect(page.locator("#agent-economics-table")).toContainText("$11,698.00");
    await expect(page.locator("#tokenomics-model-filter option")).toHaveCount(14);
    expect(await page.locator("#tokenomics-model-filter option").evaluateAll((options) =>
      options.map((option) => option.value),
    )).toEqual([
      "all",
      "amd-local-default",
      "gpt-4o-mini",
      "gpt-4.1-mini",
      "gpt-5.4-mini",
      "gpt-5.4",
      "gpt-5.5",
      "claude-sonnet-4-5",
      "claude-sonnet-4-6",
      "claude-opus-4-8",
      "claude-haiku-4-5-20251001",
      "gemini-2.5-flash",
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview",
    ]);

    await page.locator("#tokenomics-model-filter").selectOption("gpt-5.5");
    await expect(page).toHaveURL(/model=gpt-5.5/);
    await expect(page.locator("#cost-summary-grid")).toContainText("52M");
    await expect(page.locator("#cost-summary-grid")).toContainText("$8,610.00");

    await page.locator("#tokenomics-model-filter").selectOption("gpt-5.4");
    await expect(page.locator("#cost-summary-grid")).toContainText("110K");
    await expect(page.locator("#cost-summary-grid")).toContainText("$30.00");

    await page.locator("#tokenomics-model-filter").selectOption("claude-opus-4-8");
    await expect(page.locator("#cost-summary-grid")).toContainText("8M");
    await expect(page.locator("#cost-summary-grid")).toContainText("$1,800.00");

    await page.locator("#tokenomics-model-filter").selectOption("gemini-3.1-pro-preview");
    await expect(page.locator("#cost-summary-grid")).toContainText("30K");
    await expect(page.locator("#cost-summary-grid")).toContainText("$10.00");

    await page.locator("#tokenomics-model-filter").selectOption("gpt-4o-mini");
    await expect(page.locator("#cost-summary-grid")).toContainText("120K");
    await expect(page.locator("#cost-summary-grid")).toContainText("$15.20");
    await page.locator("#tokenomics-model-filter").selectOption("all");

    await page.locator("#tokenomics-agent-filter").selectOption("code-builder");
    await expect(page).toHaveURL(/agent=code-builder/);
    await expect(page.locator("#cost-summary-grid")).toContainText("Filtered tokens");
    await expect(page.locator("#cost-summary-grid")).toContainText("660K");
    await expect(page.locator("#cost-summary-grid")).toContainText("$109.80");
    await expect(page.locator("#cost-summary-grid")).not.toContainText("Projected Annual Spend");
    await expect(page.locator("#agent-economics-count")).toHaveText("1 agent");
    await expect(page.locator("#agent-economics-table tbody tr")).toHaveCount(1);
    await expect(page.locator("#agent-economics-table tbody tr")).toContainText("Code Builder");
    await expect(page.locator("#agent-economics-table tbody tr")).toContainText("230");
    await expect(page.locator("#agent-economics-table tbody tr")).toContainText("337");
    await expect(page.locator("#agent-economics-table tbody tr")).toContainText("660K");
    await expect(page.locator("#agent-economics-table tbody tr")).toContainText("$109.80");

    await page.locator("#tokenomics-model-filter").selectOption("gpt-4o-mini");
    await expect(page).toHaveURL(/model=gpt-4o-mini/);
    await expect(page.locator("#cost-summary-grid")).toContainText("120K");
    await expect(page.locator("#cost-summary-grid")).toContainText("$15.20");
    await expect(page.locator("#agent-economics-table tbody tr")).toContainText("55");
    await expect(page.locator("#agent-economics-table tbody tr")).toContainText("80");

    await page.locator("#tokenomics-model-filter").selectOption("claude-sonnet-4-6");
    await expect(page).toHaveURL(/model=claude-sonnet-4-6/);
    await expect(page.locator("#cost-summary-grid")).toContainText("280K");
    await expect(page.locator("#cost-summary-grid")).toContainText("$45.60");
    await expect(page.locator("#agent-economics-table tbody tr")).toContainText("80");
    await expect(page.locator("#agent-economics-table tbody tr")).toContainText("119");
    await expect(page.locator("#agent-economics-table tbody tr")).toContainText("Claude");

    await page.locator("#tokenomics-team-filter").selectOption("product");
    await expect(page).toHaveURL(/team=product/);
    await expect(page.locator("#agent-economics-count")).toHaveText("0 agents");
    await expect(page.locator("#agent-economics-table")).toContainText("No modeled agent activity matches these filters");
    await expect(page.locator("#cost-summary-grid")).toContainText("$0.00");

    await page.locator("#tokenomics-clear-filters").click();
    await expect(page.locator("#tokenomics-agent-filter")).toHaveValue("all");
    await expect(page.locator("#tokenomics-model-filter")).toHaveValue("all");
    await expect(page.locator("#tokenomics-team-filter")).toHaveValue("all");
    await expect(page).not.toHaveURL(/(?:agent|model|provider|team)=/);
    await expect(page.locator("#cost-summary-grid")).toContainText("$11,484,905.12");
    await expect(page.locator("#agent-economics-table tbody tr")).toHaveCount(6);
    await expect(page.locator("#tokenomics-tab-infrastructure, #tokenomics-infrastructure-panel")).toHaveCount(0);

    await page.locator("#tokenomics-agent-filter").selectOption("code-builder");
    await page.locator("#tokenomics-model-filter").selectOption("gpt-4o-mini");
    await page.getByRole("tab", { name: "Adoption" }).click();
    await expect(page.locator("#tokenomics-agent-filter")).toHaveValue("all");
    await expect(page.locator("#tokenomics-agent-filter")).toBeDisabled();
    await expect(page.locator("#tokenomics-model-filter")).toHaveValue("all");
    await expect(page.locator("#tokenomics-model-filter")).toBeDisabled();
    await expect(page).not.toHaveURL(/(?:agent|model)=/);
    await expect(page.locator("#tokenomics-clear-filters")).toBeHidden();
    await expect(page.locator("#tokenomics-analytics-source")).toContainText("Synthetic managed-fleet view");
    await expect(page.locator("#tokenomics-analytics-updated")).toContainText("managed fleet scenario");
    await expect(page.locator("#tokenomics-analytics-updated")).not.toContainText("non-Halo");
    await expect(page.locator("#adoption-utilization-donut")).toContainText("fleet adoption · unfiltered");
    await page.getByRole("tab", { name: "Cost" }).click();
    await expect(page.locator("#agent-economics-table tbody tr")).toHaveCount(6);

    const costTab = page.locator("#tokenomics-tab-cost");
    const budgetTab = page.locator("#tokenomics-tab-budget");
    await costTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(budgetTab).toBeFocused();
    await expect(budgetTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tokenomics-budget-panel")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(costTab).toBeFocused();
    await expect(costTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tokenomics-cost-panel")).toBeVisible();

    const tokenomicsNav = page.locator('[data-shell-nav="budget"]');
    const infrastructureNav = page.locator('[data-shell-nav="infrastructure"]');
    await expect(tokenomicsNav).toHaveAttribute("aria-current", "page");
    await expect(infrastructureNav).not.toHaveAttribute("aria-current", "page");
    await infrastructureNav.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/infrastructure$/);
    await expect(page.getByRole("heading", { name: "Infrastructure", exact: true })).toBeVisible();
    await expect(infrastructureNav).toHaveAttribute("aria-current", "page");
    await expect(tokenomicsNav).not.toHaveAttribute("aria-current", "page");
    const infrastructurePage = page.locator("#infrastructure-page");
    await expect(infrastructurePage).toBeVisible();
    await expect(page.locator("#budget-page")).toBeHidden();
    await expect(page.locator("#infrastructure-disclosure")).toContainText("Synthetic Splunk Observability demo");
    await expect(page.locator("#infrastructure-scope-strip")).toContainText("Last 24 hours");
    await expect(page.locator("#infrastructure-scope-strip")).toContainText("4 of 5 reporting");
    await expect(page.locator("#infrastructure-scope-strip")).toContainText("Splunk Observability");
    await expect(page.locator("#infrastructure-summary-grid")).toContainText("CPU utilization");
    await expect(page.locator("#infrastructure-summary-grid")).toContainText("40%");
    await expect(page.locator("#infrastructure-summary-grid")).toContainText("Memory utilization");
    await expect(page.locator("#infrastructure-summary-grid")).toContainText("67%");
    await expect(page.locator("#infrastructure-summary-grid")).toContainText("GPU utilization");
    await expect(page.locator("#infrastructure-summary-grid")).toContainText("41%");
    await expect(page.locator("#infrastructure-summary-grid")).toContainText("Network throughput");
    await expect(page.locator("#infrastructure-summary-grid")).toContainText("366.4 Mbps");
    await expect(page.locator("#infrastructure-summary-grid")).toContainText("Energy consumption");
    await expect(page.locator("#infrastructure-summary-grid")).toContainText("62.3 kWh");
    await expect(page.locator("#infrastructure-utilization-chart svg")).toBeVisible();
    await expect(page.locator("#infrastructure-utilization-chart")).toContainText("CPU");
    await expect(page.locator("#infrastructure-utilization-chart")).toContainText("Memory");
    await expect(page.locator("#infrastructure-utilization-chart")).toContainText("GPU");
    await expect(page.locator("#infrastructure-efficiency-list")).toContainText("tokens/kWh");
    await expect(page.locator("#infrastructure-efficiency-list")).toContainText("7-day energy");
    const infrastructureDeviceTable = page.locator("#infrastructure-device-table");
    await expect(infrastructureDeviceTable).toContainText("CPU 48%");
    await expect(infrastructureDeviceTable).toContainText("MEM 72%");
    await expect(infrastructureDeviceTable).toContainText("GPU 61%");
    await expect(infrastructureDeviceTable).toContainText("186 Mbps");
    await expect(infrastructureDeviceTable).toContainText("112 W");
    await expect(infrastructureDeviceTable).toContainText("2.34 kWh / 24h");
    await expect(infrastructureDeviceTable).toContainText("Splunk Observability");
    await expect(infrastructureDeviceTable).toContainText("DSK-RTP-006");
    await expect(infrastructureDeviceTable).toContainText("No recent sample");
    expect(await infrastructurePage.innerText()).not.toMatch(/(?:co2|carbon)/i);
    await expect(infrastructurePage.locator('[id*="co2" i], [id*="carbon" i]')).toHaveCount(0);

    await page.goto("/budgets?tab=infrastructure");
    await expect(page).toHaveURL(/\/infrastructure$/);
    await expect(page.locator("#infrastructure-page")).toBeVisible();
    await expect(infrastructureNav).toHaveAttribute("aria-current", "page");

    await page.goto("/budgets");
    await expect(costTab).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "Adoption" }).click();
    await expect(page.locator("#tokenomics-adoption-panel")).toBeVisible();
    await expect(page.locator("#adoption-provider-summary")).toContainText("AMD local");
    await expect(page.locator("#adoption-trend-chart svg")).toBeVisible();
    await expect(page.locator("#adoption-team-matrix")).toContainText("Engineering");
    await expect(page.locator("#adoption-provider-summary")).toContainText("OpenAI");
    await expect(page.locator("#adoption-provider-summary")).toContainText("Claude");
    await page.locator("#tokenomics-team-filter").selectOption("engineering");
    await expect(page.locator("#adoption-team-matrix tbody tr")).toHaveCount(1);
    await expect(page.locator("#adoption-team-matrix")).toContainText("Engineering");

    await page.getByRole("tab", { name: "Budget" }).click();
    await expect(page.locator("#alerts-list")).toBeVisible();
    await expect(page.locator(".tokenomics-filter-bar")).toBeHidden();

    await page.getByRole("tab", { name: "Cost" }).click();
    await expect(page.locator("#tokenomics-model-filter")).toBeEnabled();
    await page.locator("#tokenomics-model-filter").selectOption("all");
    await page.locator("#tokenomics-team-filter").selectOption("all");
    await page.locator("#cost-breakdown-controls [data-cost-breakdown='agent']").click();
    await expect(page.locator("#cost-breakdown-controls [data-cost-breakdown='agent']")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#cost-breakdown-controls [data-cost-breakdown='model']")).toHaveAttribute("aria-pressed", "false");
    await page.locator("#usage-detail-search").fill("Product Planner");
    await expect(page.locator("#usage-detail-table")).toContainText("Product Planner");
    await page.locator("#usage-detail-search").fill("");
    await expect(page.locator("#routing-demo")).toContainText("Demo · not telemetry");
    await expect(page.locator("body")).not.toContainText(/illustrative/i);
    await page.locator("#demo-run-button").click();
    await expect(page.locator("#demo-task-state")).toContainText("Complete");
    await expect(page.locator("#demo-token-counter")).toHaveText("18,400");
    await expect(page.locator("#demo-task-result")).toHaveText(/same result/i);

    await expectSwitchState(page, "#lemonade-routing-toggle", false);
    await page.locator("#lemonade-routing-toggle").click();
    await expectSwitchState(page, "#lemonade-routing-toggle", true);
    await expect(page.locator("#demo-task-state")).toContainText("Lemonade local-first");
    await expect(page.locator("#demo-token-counter")).toHaveText("4,600");
    await expect(page.locator("#local-route-share")).toHaveText("75%");
    await expect(page.locator("#cloud-route-share")).toHaveText("25%");

    const beforeJiraOverview = await (await request.get(`${API_BASE}/fleet/overview`)).json();
    await page.goto("/agent-controls");
    await expectAgentControlTab(page, "controls");
    await expect(page).toHaveTitle("Agent Control | Deskside AI Resilience | Cloud Control");

    const controlsTab = page.locator("#agent-control-tab-controls");
    const studioTab = page.locator("#agent-control-tab-studio");
    const behaviorTab = page.locator("#agent-control-tab-behavior");
    await controlsTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(studioTab).toBeFocused();
    await expectAgentControlTab(page, "studio");
    await page.keyboard.press("ArrowLeft");
    await expect(controlsTab).toBeFocused();
    await expectAgentControlTab(page, "controls");
    await page.keyboard.press("End");
    await expect(behaviorTab).toBeFocused();
    await expectAgentControlTab(page, "behavior");
    await page.keyboard.press("Home");
    await expect(controlsTab).toBeFocused();
    await expectAgentControlTab(page, "controls");

    await expectSwitchState(page, "#chat-budget-toggle", false);
    await page.locator("#chat-budget-toggle").click();
    await expectSwitchState(page, "#chat-budget-toggle", true);
    await page.locator("#chat-budget-toggle").click();
    await expectSwitchState(page, "#chat-budget-toggle", false);
    const capabilityCard = page.locator(".agent-capabilities-card");
    await expect(capabilityCard.getByRole("heading", { name: "Agent capabilities" })).toBeVisible();
    await expect(capabilityCard).toContainText("Read approved data");
    await expect(capabilityCard).toContainText("Modify approved work");
    await expect(capabilityCard).toContainText("Run code and commands");
    await expect(capabilityCard).toContainText("Use web and connected apps");
    await expect(capabilityCard).toContainText("Send, publish, or deploy");
    await expect(capabilityCard).toContainText("Delete data or change access");
    await expect(capabilityCard.getByRole("switch")).toHaveCount(7);
    const capabilitySwitches = [
      ["read-approved-data", true],
      ["modify-approved-work", true],
      ["run-code-and-commands", false],
      ["use-web-and-connected-apps", false],
      ["send-publish-or-deploy", false],
      ["delete-data-or-change-access", false],
    ];
    for (const [capability, baselineEnabled] of capabilitySwitches) {
      const selector = `[data-capability-toggle="${capability}"]`;
      await expectSwitchState(page, selector, baselineEnabled);
      await page.locator(selector).click();
      await expectSwitchState(page, selector, !baselineEnabled);
      await page.locator(selector).click();
      await expectSwitchState(page, selector, baselineEnabled);
    }
    const lockedCapability = '[data-capability-toggle="system-secrets-and-credentials"]';
    await expectSwitchState(page, lockedCapability, false);
    await expect(page.locator(lockedCapability)).toBeDisabled();
    await expect(capabilityCard).toContainText("Preview only");
    const readCapability = page.locator('[data-capability-toggle="read-approved-data"]');
    await readCapability.focus();
    await page.keyboard.press("Space");
    await expectSwitchState(page, '[data-capability-toggle="read-approved-data"]', false);
    await page.reload();
    await expectAgentControlTab(page, "controls");
    await expectSwitchState(page, '[data-capability-toggle="read-approved-data"]', true);
    await page.locator("#advanced-tool-exceptions summary").click();
    await expect(page.locator("#tool-exception-count")).toContainText("exact scan exception");
    await expect(page.locator("#tool-exception-warning")).toContainText("not workspace, network, or identity permissions");
    await expect(page.locator("#tool-exceptions-list")).toContainText("Routine inspection bypass");
    await expect(page.locator("#guardrail-policy-catalog")).toContainText("Jira ticket deletion");
    await expect(page.locator("#guardrail-policy-catalog")).toContainText("Restricted model provenance");
    await page.locator("#jira-delete-guardrail summary").click();
    await expect(page.locator("#jira-delete-guardrail")).toContainText("Delete Jira ticket SEC-1842");
    await page.locator("#jira-guardrail-demo-button").click();
    await expect(page.locator("#jira-guardrail-demo-result")).toContainText("Blocked by DefenseClaw");
    await expect(page.locator("#jira-guardrail-demo-result")).toContainText("SEC-1842 was not deleted");
    const afterJiraOverview = await (await request.get(`${API_BASE}/fleet/overview`)).json();
    expect(afterJiraOverview.fleet.quarantined_devices).toBe(beforeJiraOverview.fleet.quarantined_devices);
    expect(afterJiraOverview.devices.find((row) => row.device_id === DEMO_DEVICE).quarantined).toBe(false);

    await page.goto("/policy-studio");
    await expectAgentControlTab(page, "studio");
    await expect(page).toHaveTitle("Policy Studio | Agent Control | Deskside AI Resilience | Cloud Control");
    await expect(page.getByRole("heading", { name: "Policy Studio" })).toBeVisible();
    await expect(page.locator("#policy-studio-stage-button")).toBeDisabled();
    await page.getByRole("button", { name: "Protect credentials" }).click();
    await expect(page.locator("#policy-studio-input")).toHaveValue(/Block credential access/);
    await page.locator("#policy-studio-generate-button").click();
    await expect(page.locator("#policy-studio-draft-title")).toHaveText("Credential and secret protection");
    await expect(page.locator("#policy-studio-draft-empty")).toBeHidden();
    await expect(page.locator("#policy-studio-generation-mode")).toContainText("Validated template fallback");
    await expect(page.locator("#policy-studio-rules")).toContainText("Data Protection");
    await expect(page.locator("#policy-studio-rules")).toContainText("Block");
    await expect(page.locator("#policy-studio-warnings")).toContainText("does not change live DefenseClaw enforcement");
    await page.locator("#policy-studio-review-confirmed").check();
    await expect(page.locator("#policy-studio-stage-button")).toBeEnabled();
    await page.route("**/policy-studio/drafts/*/apply", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.continue();
    });
    await page.locator("#policy-studio-stage-button").click();
    await expect(page.locator("#policy-studio-input")).toBeDisabled();
    await expect(page.locator("#policy-studio-generate-button")).toBeDisabled();
    await expect(page.locator("[data-policy-studio-preset]").first()).toBeDisabled();
    await expect(page.locator("#policy-studio-stage-result")).toContainText("No live DefenseClaw enforcement changed");
    await page.unroute("**/policy-studio/drafts/*/apply");
    await expect(page.locator("#policy-studio-draft-status")).toContainText("Staged · not enforced");
    const fixtureUuidDraftResponse = await request.post(`${API_BASE}/policy-studio/drafts`, {
      data: { message: "Require signed models" },
    });
    expect(fixtureUuidDraftResponse.status()).toBe(201);
    const fixtureUuidDraft = (await fixtureUuidDraftResponse.json()).draft;
    const uppercaseUuidRevision = await request.post(`${API_BASE}/policy-studio/drafts`, {
      data: {
        message: "Also require an approved publisher",
        conversation_id: fixtureUuidDraft.conversation_id.toUpperCase(),
        previous_draft_id: fixtureUuidDraft.id.toUpperCase(),
      },
    });
    expect(uppercaseUuidRevision.status()).toBe(201);
    const uppercaseUuidStage = await request.post(
      `${API_BASE}/policy-studio/drafts/${fixtureUuidDraft.id.toUpperCase()}/apply`,
      { data: { expected_version: 1, review_confirmed: true } },
    );
    expect(uppercaseUuidStage.status()).toBe(200);
    const malformedUuidStage = await request.post(
      `${API_BASE}/policy-studio/drafts/${"a".repeat(36)}/apply`,
      { data: { expected_version: 1, review_confirmed: true } },
    );
    expect(malformedUuidStage.status()).toBe(400);
    const afterPolicyStudioOverview = await (await request.get(`${API_BASE}/fleet/overview`)).json();
    expect(afterPolicyStudioOverview).toEqual(afterJiraOverview);

    await page.goto("/agent-security");
    await expect(page.getByRole("heading", { name: "Network Security" })).toBeVisible();
    await expect(page).toHaveTitle("Network Security | Deskside AI Resilience | Cloud Control");
    const networkPage = page.locator("#network-security-page");
    const topology = page.locator("#network-topology");
    const topologyAusNode = page.locator('[data-topology-device-id="DSK-AUS-017"]');
    const topologySjcNode = page.locator('[data-topology-device-id="DSK-SJC-022"]');
    const networkPolicyEnforcement = page.locator("#network-policy-enforcement");
    await expect(page.locator("#network-security-page > .network-topology-card")).toBeVisible();
    const topologyIsFirstPane = await networkPage.evaluate((section) =>
      section.querySelector(":scope > .hero")?.nextElementSibling?.classList.contains("network-topology-card"),
    );
    expect(topologyIsFirstPane).toBe(true);
    await expect(page.locator("#network-topology-map")).toBeVisible();
    await expect(page.locator("#network-topology-summary")).toContainText("1 Cisco 9550 aggregation");
    await expect(page.locator("#network-topology-summary")).toContainText("2 Cisco 9350 access");
    await expect(page.locator("#network-topology-summary")).toContainText("4 Ryzen AI Halo desksides");
    await expect(page.locator("#network-topology-summary")).toContainText("Reference pattern");
    await expect(topology.locator(".topology-link-layer")).toBeVisible();
    await expect(topology.locator(".topology-pdf-core")).toHaveCount(1);
    await expect(topology.locator('[data-topology-tier="core"]')).toHaveCount(1);
    await expect(topology.locator('[data-topology-tier="core"]')).toContainText("Cisco 9550");
    await expect(page.getByRole("heading", { name: "AI at every desk, secured by the network itself" })).toBeVisible();
    await expect(topology.locator(".topology-pdf-access-branch")).toHaveCount(2);
    await expect(topology.locator('[data-topology-model="Cisco 9350"]')).toHaveCount(2);
    await expect(topology.locator(".topology-pdf-endpoint")).toHaveCount(4);
    await expect(topology.locator('.topology-pdf-core img[src="/shell/assets/cisco-c9550.png"]')).toHaveCount(1);
    await expect(topology.locator('.topology-pdf-access img[src="/shell/assets/cisco-c9350.png"]')).toHaveCount(2);
    await expect(topology.locator('.topology-pdf-endpoint img[src="/shell/assets/amd-ryzen-ai-halo.png"]')).toHaveCount(4);
    await expect(topology.locator(".topology-uplink-label")).toHaveCount(2);
    await expect(topology.locator(".topology-uplink-label").first()).toContainText("Reference uplink A");
    await expect(topology.locator(".topology-uplink-label").first()).toContainText("Up to 100G");
    await expect(topology.locator(".topology-endpoint-port")).toHaveCount(4);
    await expect(topology.locator(".topology-endpoint-port")).toContainText([
      "Access port Gi1/0/14",
      "Access port Gi1/0/17",
      "Access port Gi1/0/8",
      "Access port Gi1/0/22",
    ]);
    await expect(topology).not.toContainText("Representative port");
    await expect(topology.locator(".topology-pdf-map")).not.toContainText("DefenseClaw");
    await expect(topology.locator(".topology-pdf-map")).not.toContainText("Cisco ISE");
    await expect(topology.locator(".topology-control-overlay")).toContainText("Cisco Cloud Control");
    await expect(topology.locator(".topology-control-overlay")).toContainText("DefenseClaw");
    await expect(topology.locator(".topology-control-overlay")).toContainText("Cisco ISE");
    await expect(topology.locator('[data-topology-tier="defenseclaw"]')).toHaveAttribute("data-integration-state", "demo");
    await expect(topology.locator('[data-topology-tier="identity"]')).toHaveAttribute("data-integration-state", "demo");
    await expect(topology.locator('[data-topology-tier="defenseclaw"] .topology-node-status')).toHaveAttribute("aria-label", "Demo ready");
    await expect(topology.locator('[data-topology-tier="identity"] .topology-node-status')).toHaveAttribute("aria-label", "Demo ready");
    await expect(networkPolicyEnforcement).toHaveAttribute("data-enforcement-state", "enforced");
    await expect(networkPolicyEnforcement).toHaveAttribute("data-device-id", "DSK-SJC-022");
    await expect(networkPolicyEnforcement).toContainText("AMD-DESKSIDE-QUARANTINE");
    await expect(networkPolicyEnforcement).toContainText("Cisco C9350 access");
    await expect(networkPolicyEnforcement).toContainText("Gi1/0/22");
    await expect(networkPolicyEnforcement).toContainText("Remediation only");
    await expect(networkPolicyEnforcement).toContainText("Simulated evidence");
    await expect(page.locator("#network-enforcement-flow .topology-policy-step")).toHaveCount(4);
    await expect(page.locator("#network-enforcement-flow")).toContainText("RADIUS CoA");
    await expect(topologySjcNode).toHaveAttribute("data-policy-enforced", "true");
    expect(await networkPolicyEnforcement.evaluate((panel) => panel.closest("#network-topology-map"))).toBeNull();
    await expect(topology.locator(".topology-capability-sidebar")).toHaveCount(0);
    await expect(topology).not.toContainText("Why it matters");
    await expect(topology).toContainText("Cisco 9350");
    await expect(topology).not.toContainText(/Cat9K|Catalyst/i);
    await expect(page.locator('[data-topology-switch="reference-c9350-a"]')).toBeVisible();
    await expect(topologyAusNode).toHaveAttribute("data-topology-state", "critical");
    await expect(topologyAusNode).toHaveAttribute("data-switch-name", "C9350-AUS-02");
    await expect(topologyAusNode).toHaveAttribute("data-switch-port", "Gi1/0/17");
    await expect(topologyAusNode).toHaveAttribute("data-access-state", "full");
    await expect(topologyAusNode).toContainText("AMD Ryzen AI Halo");
    const physicalUplinks = page.locator(".topology-pdf-links .topology-access-uplink");
    await expect(physicalUplinks).toHaveCount(2);
    const corePrecedesAccess = await page.locator("#network-topology-map").evaluate((map) => {
      const core = map.querySelector('[data-topology-tier="core"]');
      const access = map.querySelector('[data-topology-tier="access"]');
      return Boolean(core && access && (core.compareDocumentPosition(access) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    expect(corePrecedesAccess).toBe(true);
    const coreBox = await topology.locator('[data-topology-tier="core"]').boundingBox();
    const firstAccessBox = await topology.locator(".topology-pdf-access").first().boundingBox();
    expect(coreBox).not.toBeNull();
    expect(firstAccessBox).not.toBeNull();
    expect(coreBox.y + coreBox.height).toBeLessThan(firstAccessBox.y);
    await expect(page.locator("#network-security-banner")).toContainText("Synthetic replay");
    await expect(page.locator("#one-policy-story")).toContainText("Synthetic");
    await expect(page.locator("#one-policy-story")).toContainText("Delete blocked");
    await expect(page.locator("#one-policy-story")).toContainText("Unsigned model blocked");
    await expect(page.locator("#network-attention-count")).toHaveText("3 devices");
    await expectVisibleWordCountAtMost(networkPage, 390);
    await expect(page.locator("#network-enforcement-flow")).toBeVisible();
    await expect(page.locator("#network-security-events")).toHaveCount(0);
    await expect(page.locator("#restricted-model-demo .skill-policy-trace")).toHaveCount(0);
    const restrictedModelDemo = page.locator("#restricted-model-demo");
    const restrictedModelButton = page.locator("#restricted-model-demo-button");
    await expect(restrictedModelDemo).toContainText("Restricted model test");
    await expect(restrictedModelDemo).toContainText("Synthetic");
    await expect(page.locator("#restricted-model-endpoint")).toContainText("Jordan Lee");
    await expect(page.locator("#restricted-model-endpoint")).toContainText("Product");
    await expect(page.locator("#restricted-model-endpoint")).toContainText("DSK-AUS-017");
    await expect(page.locator("#restricted-model-endpoint")).toContainText("Employee Assistant + Product Planner");
    await expect(page.locator("#restricted-model-endpoint")).toContainText("Full access");
    await page.locator(".restricted-model-more > summary").click();
    await expect(page.locator("#restricted-model-evidence")).toContainText("Unverified publisher");
    await expect(page.locator("#restricted-model-evidence")).toContainText("Missing signature");
    await expect(page.locator("#restricted-model-evidence")).toContainText("Restricted model");
    await page.locator(".restricted-model-technical-details > summary").click();
    await expect(page.locator(".restricted-model-technical-details")).toContainText("hf://unverified/shadow-llm-13b.gguf");
    await expect(page.locator("#restricted-model-response")).toContainText("Block model");
    await expect(page.locator("#restricted-model-response")).toContainText("Isolate DSK-AUS-017");
    await expect(page.locator("#restricted-model-response")).toContainText("Keep remediation");
    await expect(page.locator("#restricted-model-response")).toContainText("Notify Jordan Lee");
    await expect(restrictedModelDemo).toHaveAttribute("data-incident-state", "setup-required");
    await expect(page.locator("#restricted-model-demo-state")).toHaveText("Setup required");
    await expect(page.locator("#restricted-model-demo-guidance")).toContainText("Turn on automatic isolation");
    await expect(restrictedModelButton).toHaveText("Review isolation settings");
    await expect(restrictedModelDemo).toContainText("Synthetic only");
    await expect(page.locator("#restricted-model-notification-status")).toHaveText("Preview only");
    await expect(page.locator("#restricted-model-notification-title")).toHaveText("Message Jordan Lee will receive");
    await expect(page.locator("#restricted-model-notification-preview")).toContainText("remediation-only network access");
    await expectSwitchState(page, "#auto-quarantine-toggle", false);
    await restrictedModelButton.click();
    await expect(page.locator("#network-security-banner")).toContainText("Automatic isolation is off");
    await expect(page.locator("#auto-quarantine-toggle")).toBeFocused();
    await expect(restrictedModelButton).toHaveText("Review isolation settings");
    const afterPrerequisiteOverview = await (await request.get(`${API_BASE}/fleet/overview`)).json();
    expect(afterPrerequisiteOverview.devices.find((row) => row.device_id === DEMO_DEVICE).quarantined).toBe(false);

    await page.locator("#auto-quarantine-toggle").click();
    await expectSwitchState(page, "#auto-quarantine-toggle", true);
    await expectSwitchState(page, "#fleet-auto-quarantine-toggle", true);
    await expect(restrictedModelDemo).toHaveAttribute("data-incident-state", "ready");
    await expect(page.locator("#restricted-model-demo-state")).toHaveText("Ready to test");
    await expect(restrictedModelButton).toHaveText("Run response test");
    await restrictedModelButton.click();
    await expect(restrictedModelDemo).toHaveAttribute("data-incident-state", "quarantined");
    await expect(page.locator("#restricted-model-demo-state")).toHaveText("Test passed · endpoint quarantined");
    await expect(restrictedModelButton).toHaveText("Reset test environment");
    await expect(page.locator("[data-restricted-model-outcome].is-complete")).toHaveCount(4);
    await expect(topologyAusNode).toHaveAttribute("data-topology-state", "quarantined");
    await expect(topologyAusNode).toHaveAttribute("data-access-state", "remediation-only");
    await expect(topologyAusNode).toHaveAttribute("data-policy-enforced", "true");
    await expect(topologyAusNode).toContainText("AMD Ryzen AI Halo");
    await expect(networkPolicyEnforcement).toHaveAttribute("data-enforcement-state", "enforced");
    await expect(networkPolicyEnforcement).toHaveAttribute("data-device-id", "DSK-AUS-017");
    await expect(networkPolicyEnforcement).toContainText("Gi1/0/17");
    await expect(networkPolicyEnforcement).toContainText("Remediation only");
    await expect(page.locator("#restricted-model-notification-status")).toHaveText("Simulated notification sent");
    await expect(page.locator("#restricted-model-notification-title")).toHaveText("Message sent to Jordan Lee");
    await expect(page.locator("#restricted-model-notification")).toContainText("temporarily quarantined");
    await expect(page.locator("#restricted-model-notification")).toContainText("remediation-only network access");
    const quarantinedOverview = await (await request.get(`${API_BASE}/fleet/overview`)).json();
    const quarantinedDevice = quarantinedOverview.devices.find((row) => row.device_id === DEMO_DEVICE);
    expect(quarantinedDevice.quarantined).toBe(true);
    expect(quarantinedDevice.network_access).toBe("Remediation only");
    expect(quarantinedDevice.ise_policy).toBe("AMD-DESKSIDE-QUARANTINE");
    await restrictedModelButton.click();
    await expect(restrictedModelDemo).toHaveAttribute("data-incident-state", "setup-required");
    await expect(page.locator("#restricted-model-demo-state")).toHaveText("Setup required");
    await expect(restrictedModelButton).toHaveText("Review isolation settings");
    await expect(page.locator("[data-restricted-model-outcome].is-complete")).toHaveCount(0);
    await expect(page.locator("#restricted-model-notification-status")).toHaveText("Preview only");
    await expect(page.locator("#restricted-model-network-access")).toHaveText("Full access");
    await expect(topologyAusNode).toHaveAttribute("data-topology-state", "critical");
    await expect(topologyAusNode).toHaveAttribute("data-access-state", "full");
    await expect(topologyAusNode).toHaveAttribute("data-policy-enforced", "false");
    await expect(topologyAusNode).toContainText("AMD Ryzen AI Halo");
    await expect(networkPolicyEnforcement).toHaveAttribute("data-device-id", "DSK-SJC-022");
    await expect(topologySjcNode).toHaveAttribute("data-policy-enforced", "true");
    await expect(page.locator("#network-security-banner")).toContainText("Response test reset");
    await expectSwitchState(page, "#auto-quarantine-toggle", false);
    await expectSwitchState(page, "#fleet-auto-quarantine-toggle", false);
    const resetOverview = await (await request.get(`${API_BASE}/fleet/overview`)).json();
    expect(resetOverview.security_policy.version).toBe(baseline.security_policy.version);
    expect(resetOverview.fleet.quarantined_devices).toBe(baseline.fleet.quarantined_devices);
    expect(resetOverview.fleet.network_action_count).toBe(baseline.fleet.network_action_count);
    expect(resetOverview.enforcement_events).toEqual(baseline.enforcement_events);
    expect(resetOverview.devices.find((row) => row.device_id === DEMO_DEVICE)).toEqual(
      baseline.devices.find((row) => row.device_id === DEMO_DEVICE),
    );

    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/network-security");
    await expect(page.getByRole("heading", { name: "AI at every desk, secured by the network itself" })).toBeVisible();
    await expect(page.locator(".topology-link-layer")).toBeVisible();
    await expect(page.locator(".topology-uplink-label")).toHaveCount(2);
    await expect(page.locator(".topology-endpoint-port")).toHaveCount(4);
    await expect(page.locator("#network-policy-enforcement")).toBeVisible();
    await expect(page.locator('[data-topology-tier="core"]')).toContainText("Cisco 9550");
    await expect(page.locator('[data-topology-model="Cisco 9350"]')).toHaveCount(2);
    const tabletAccessColumns = await page.locator(".topology-pdf-access-grid").evaluate(
      (grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length,
    );
    expect(tabletAccessColumns).toBe(2);
    const tabletAusSwitch = page.locator('[data-topology-switch="reference-c9350-a"] .topology-pdf-access');
    const tabletAusEndpoint = page.locator('[data-topology-device-id="DSK-AUS-017"]');
    const tabletSwitchBox = await tabletAusSwitch.boundingBox();
    const tabletEndpointBox = await tabletAusEndpoint.boundingBox();
    expect(tabletSwitchBox).not.toBeNull();
    expect(tabletEndpointBox).not.toBeNull();
    expect(tabletSwitchBox.y + tabletSwitchBox.height).toBeLessThan(tabletEndpointBox.y);
    const tabletNamesFit = await page.locator(".topology-product-node strong").evaluateAll(
      (labels) => labels.every((label) => label.scrollWidth <= label.clientWidth + 1),
    );
    expect(tabletNamesFit).toBe(true);
    await expectVisibleWordCountAtMost(page.locator("#network-security-page"), 390);
    await expectNoPageOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fleet");
    await expect(page.getByRole("heading", { name: "Fleet Overview" })).toBeVisible();
    await page.locator('[data-fleet-view="infrastructure"]').click();
    await expect(page.locator("#fleet-table-title")).toHaveText("Managed infrastructure telemetry");
    await expectNoPageOverflow(page);
    await page.goto("/agent-controls");
    await expectAgentControlTab(page, "controls");
    const mobileAgentControlTabs = page.locator("#agent-control-tabs");
    expect(await mobileAgentControlTabs.evaluate(
      (tabList) => tabList.scrollWidth <= tabList.clientWidth + 1,
    )).toBe(true);
    const mobileAgentControlNavBox = await page.locator('[data-shell-nav="controls"]').boundingBox();
    expect(mobileAgentControlNavBox).not.toBeNull();
    expect(mobileAgentControlNavBox.x).toBeGreaterThanOrEqual(0);
    expect(mobileAgentControlNavBox.x + mobileAgentControlNavBox.width).toBeLessThanOrEqual(390);
    await expectNoPageOverflow(page);
    await page.locator("#agent-control-tab-studio").click();
    await expectAgentControlTab(page, "studio");
    await expect(page.getByRole("heading", { name: "Policy Studio" })).toBeVisible();
    await expectNoPageOverflow(page);
    await page.locator("#agent-control-tab-behavior").click();
    await expectAgentControlTab(page, "behavior");
    await expect(page.getByRole("heading", { name: "Agent Behavior" })).toBeVisible();
    await expectNoPageOverflow(page);
    await page.goto("/network-security");
    await expect(page.getByRole("heading", { name: "Network Security" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI at every desk, secured by the network itself" })).toBeVisible();
    await expect(page.locator("#network-topology-map")).toBeVisible();
    await expect(page.locator(".topology-link-layer")).toBeHidden();
    await expect(page.locator(".topology-uplink-label")).toHaveCount(2);
    await expect(page.locator(".topology-uplink-label").first()).toBeHidden();
    await expect(page.locator(".topology-uplink-label").last()).toBeHidden();
    await expect(page.locator('[data-topology-tier="core"]')).toContainText("Cisco 9550");
    await expect(page.locator('[data-topology-model="Cisco 9350"]')).toHaveCount(2);
    await expect(page.locator(".topology-pdf-endpoint")).toHaveCount(4);
    await expect(page.locator(".topology-endpoint-port")).toHaveCount(4);
    await expect(page.locator("#network-policy-enforcement")).toBeVisible();
    await expect(page.locator("#network-enforcement-flow .topology-policy-step")).toHaveCount(4);
    await expect(page.locator('[data-topology-device-id="DSK-AUS-017"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Restricted model test" })).toBeVisible();
    await expect(page.locator("#restricted-model-endpoint")).toContainText("Jordan Lee");
    await expect(page.locator("#restricted-model-response")).toContainText("Expected response");
    const mobileRestrictedModelButton = page.locator("#restricted-model-demo-button");
    await expect(mobileRestrictedModelButton).toHaveText("Review isolation settings");
    const mobileRestrictedModelButtonBox = await mobileRestrictedModelButton.boundingBox();
    expect(mobileRestrictedModelButtonBox).not.toBeNull();
    expect(mobileRestrictedModelButtonBox.x).toBeGreaterThanOrEqual(0);
    expect(mobileRestrictedModelButtonBox.x + mobileRestrictedModelButtonBox.width).toBeLessThanOrEqual(390);
    await expectNoPageOverflow(page);
    await page.goto("/infrastructure");
    await expect(page.getByRole("heading", { name: "Infrastructure", exact: true })).toBeVisible();
    const mobileInfrastructureNav = page.locator('[data-shell-nav="infrastructure"]');
    await expect(mobileInfrastructureNav).toHaveAttribute("aria-current", "page");
    const mobileInfrastructureNavBox = await mobileInfrastructureNav.boundingBox();
    expect(mobileInfrastructureNavBox).not.toBeNull();
    expect(mobileInfrastructureNavBox.x).toBeGreaterThanOrEqual(0);
    expect(mobileInfrastructureNavBox.x + mobileInfrastructureNavBox.width).toBeLessThanOrEqual(390);
    await expect(page.locator("#infrastructure-summary-grid")).toContainText("62.3 kWh");
    await expect(page.locator("#infrastructure-device-table")).toContainText("DSK-RTP-006");
    await expectNoPageOverflow(page);
    await page.goto("/budgets?tab=adoption");
    await expect(page.getByRole("tab", { name: "Adoption" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tokenomics-adoption-panel")).toBeVisible();
    await expectNoPageOverflow(page);
    expect(browserErrors).toEqual([]);
  } finally {
    await resetDemoState(request);
  }
});

test("the topology surfaces failed integrations instead of presenting them as demo-ready", async ({ page }) => {
  await page.route("**/fleet/overview", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.integrations.find((integration) => integration.id === "defenseclaw").status = "failed";
    payload.integrations.find((integration) => integration.id === "ise").status = "degraded";
    payload.integrations.find((integration) => integration.id === "cisco_network").status = "offline";
    await route.fulfill({ response, json: payload });
  });

  await page.goto("/network-security");
  await expect(page.getByRole("heading", { name: "AI at every desk, secured by the network itself" })).toBeVisible();
  const topology = page.locator("#network-topology");
  await expect(topology.locator('[data-topology-tier="defenseclaw"]')).toHaveAttribute("data-integration-state", "unavailable");
  await expect(topology.locator('[data-topology-tier="defenseclaw"] .topology-node-status')).toHaveText("Unavailable");
  await expect(topology.locator('[data-topology-tier="identity"]')).toHaveAttribute("data-integration-state", "degraded");
  await expect(topology.locator('[data-topology-tier="identity"] .topology-node-status')).toHaveText("Degraded");
  await expect(topology.locator(".topology-pdf-map")).toContainText("Cisco 9550");
  await expect(topology.locator(".topology-pdf-map")).not.toContainText("Unavailable");
  await expectVisibleWordCountAtMost(page.locator("#network-security-page"), 390);
});

test("the topology does not claim enforcement without completed network evidence", async ({ page }) => {
  await page.route("**/fleet/overview", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.enforcement_events = [];
    await route.fulfill({ response, json: payload });
  });

  await page.goto("/network-security");
  const panel = page.locator("#network-policy-enforcement");
  await expect(panel).toHaveAttribute("data-enforcement-state", "pending");
  await expect(panel).toContainText("Evidence pending");
  await expect(panel).not.toContainText("Enforced");
  await expect(page.locator('[data-topology-device-id="DSK-SJC-022"]')).toHaveAttribute("data-policy-enforced", "false");
});

test("the reference topology stays capped at a clear 1-2-4 hierarchy", async ({ page }) => {
  await page.route("**/fleet/overview", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const source = payload.devices.find((device) => device.device_id === "DSK-NYC-014");
    payload.devices.push({
      ...source,
      device_id: "DSK-AUS-099",
      site: "Austin",
      switch_name: "C9350-AUS-02",
      switch_port: "Gi1/0/99",
      risk: "quarantined",
      quarantined: true,
      network_access: "Remediation only",
    });
    await route.fulfill({ response, json: payload });
  });

  await page.goto("/network-security");
  const topology = page.locator("#network-topology");
  await expect(page.locator("#network-topology-summary")).toContainText("4 Ryzen AI Halo desksides");
  await expect(topology.locator(".topology-pdf-access-branch")).toHaveCount(2);
  await expect(topology.locator(".topology-pdf-endpoint")).toHaveCount(4);
  await expect(topology.locator('[data-topology-device-id="DSK-AUS-099"]')).toHaveCount(0);
  const mapBox = await page.locator("#network-topology-map").boundingBox();
  const endpointBoxes = await topology.locator(".topology-pdf-endpoint").evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { bottom: box.bottom, top: box.top };
    }),
  );
  expect(mapBox).not.toBeNull();
  expect(Math.max(...endpointBoxes.map((box) => box.bottom))).toBeLessThan(mapBox.y + mapBox.height);
  await expectNoPageOverflow(page);
});
