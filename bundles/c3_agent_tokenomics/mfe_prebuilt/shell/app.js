(function () {
  const apiBase = "/v1/c3/agent-tokenomics";
  const initialSearchParams = new URLSearchParams(window.location.search);
  const requestedWindow = initialSearchParams.get("window");
  const usageWindow = /^-[1-9]\d{0,2}(?:h|d)$/.test(requestedWindow || "") ? requestedWindow : "-7d";
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = {
    activeAgentControlTab: "controls",
    activeTokenomicsTab: "cost",
    alerts: [],
    allowedControls: [],
    analytics: null,
    analyticsAgent: initialSearchParams.get("agent") || "all",
    analyticsError: "",
    analyticsModel: initialSearchParams.get("model") || "all",
    analyticsTeam: initialSearchParams.get("team") || "all",
    analyticsWindow: "-7d",
    costBreakdownDimension: "agent",
    controlsError: "",
    fleet: null,
    fleetError: "",
    fleetView: "inventory",
    infrastructure: null,
    infrastructureError: "",
    policies: [],
    policiesError: "",
    policyStudioConversationId: "",
    policyStudioDraft: null,
    policyStudioGenerating: false,
    policyStudioStaging: false,
    routingDemoEnabled: false,
    routingDemoFrame: 0,
    routingDemoRunning: false,
    jiraGuardrailRunning: false,
    restrictedModelDemoRunning: false,
    summary: null,
    usageDetailDimension: "agent",
    usageDetailPage: 1,
    usageDetailSearch: "",
  };

  const alertsList = document.getElementById("alerts-list");
  const policiesList = document.getElementById("policies-list");
  const statusBanner = document.getElementById("status-banner");
  const refreshButton = document.getElementById("refresh-button");
  const tokenomicsLedgerStatus = document.getElementById("tokenomics-ledger-status");
  const form = document.getElementById("policy-form");
  const releaseButton = document.getElementById("release-button");
  const budgetPage = document.getElementById("budget-page");
  const fleetPage = document.getElementById("fleet-page");
  const infrastructurePage = document.getElementById("infrastructure-page");
  const controlsPage = document.getElementById("agent-controls-page");
  const networkPage = document.getElementById("network-security-page");
  const fleetScopeBar = document.getElementById("fleet-scope-bar");
  const sideNavigation = document.querySelector(".side-nav");
  const activeBreadcrumb = document.querySelector(".crumbs .is-active");
  const fleetBanner = document.getElementById("fleet-banner");
  const fleetSummaryGrid = document.getElementById("fleet-summary-grid");
  const fleetScopeName = document.getElementById("fleet-scope-name");
  const fleetNetworkIdentity = document.getElementById("fleet-network-identity");
  const fleetAgentIdentities = document.getElementById("fleet-agent-identities");
  const fleetDataSource = document.getElementById("fleet-data-source");
  const fleetLiveStatus = document.getElementById("fleet-live-status");
  const providerUsage = document.getElementById("provider-usage");
  const fleetSecurityPosture = document.getElementById("fleet-security-posture");
  const fleetIsolationState = document.getElementById("fleet-isolation-state");
  const fleetAutoQuarantineToggle = document.getElementById("fleet-auto-quarantine-toggle");
  const fleetTableTitle = document.getElementById("fleet-table-title");
  const fleetTelemetrySource = document.getElementById("fleet-telemetry-source");
  const fleetInventoryViewToggle = document.getElementById("fleet-inventory-view-toggle");
  const fleetInventorySummary = document.getElementById("fleet-inventory-summary");
  const desksideList = document.getElementById("deskside-list");
  const behaviorSummaryGrid = document.getElementById("behavior-summary-grid");
  const behaviorOutcomeList = document.getElementById("behavior-outcome-list");
  const behaviorAttentionCount = document.getElementById("behavior-attention-count");
  const behaviorAttentionList = document.getElementById("behavior-attention-list");
  const behaviorAgentTable = document.getElementById("behavior-agent-table");
  const networkBanner = document.getElementById("network-security-banner");
  const networkMode = document.getElementById("network-mode");
  const autoQuarantineState = document.getElementById("auto-quarantine-state");
  const autoQuarantineToggle = document.getElementById("auto-quarantine-toggle");
  const autoQuarantineNote = document.getElementById("auto-quarantine-note");
  const autoQuarantineScope = document.getElementById("auto-quarantine-scope");
  const autoQuarantineIseAction = document.getElementById("auto-quarantine-ise-action");
  const networkTopology = document.getElementById("network-topology");
  const networkTopologySummary = document.getElementById("network-topology-summary");
  const networkAttentionCount = document.getElementById("network-attention-count");
  const networkDesksideList = document.getElementById("network-deskside-list");
  const onePolicyVersion = document.getElementById("one-policy-version");
  const policyNetworkState = document.getElementById("policy-network-state");
  const restrictedModelDemo = document.getElementById("restricted-model-demo");
  const restrictedModelDemoState = document.getElementById("restricted-model-demo-state");
  const restrictedModelDemoGuidance = document.getElementById("restricted-model-demo-guidance");
  const restrictedModelDemoButton = document.getElementById("restricted-model-demo-button");
  const restrictedModelEndpointStatus = document.getElementById("restricted-model-endpoint-status");
  const restrictedModelEmployee = document.getElementById("restricted-model-employee");
  const restrictedModelDepartment = document.getElementById("restricted-model-department");
  const restrictedModelEndpointId = document.getElementById("restricted-model-endpoint-id");
  const restrictedModelEndpointDetail = document.getElementById("restricted-model-endpoint-detail");
  const restrictedModelAgents = document.getElementById("restricted-model-agents");
  const restrictedModelNetworkAccess = document.getElementById("restricted-model-network-access");
  const restrictedModelNetworkPolicy = document.getElementById("restricted-model-network-policy");
  const restrictedModelResponseLabel = document.getElementById("restricted-model-response-label");
  const restrictedModelResponseEndpoint = document.getElementById("restricted-model-response-endpoint");
  const restrictedModelResponseEmployee = document.getElementById("restricted-model-response-employee");
  const restrictedModelNotification = document.getElementById("restricted-model-notification");
  const restrictedModelNotificationTitle = document.getElementById("restricted-model-notification-title");
  const restrictedModelNotificationStatus = document.getElementById("restricted-model-notification-status");
  const restrictedModelNotificationAvatar = document.getElementById("restricted-model-notification-avatar");
  const restrictedModelNotificationMessage = document.getElementById("restricted-model-notification-message");
  const demoTaskDot = document.getElementById("demo-task-dot");
  const demoTaskState = document.getElementById("demo-task-state");
  const demoTokenCounter = document.getElementById("demo-token-counter");
  const demoTaskResult = document.getElementById("demo-task-result");
  const demoRunButton = document.getElementById("demo-run-button");
  const lemonadeRoutingToggle = document.getElementById("lemonade-routing-toggle");
  const lemonadeRoutingLabel = document.getElementById("lemonade-routing-label");
  const routerModeCopy = document.getElementById("router-mode-copy");
  const localRouteSegment = document.getElementById("local-route-segment");
  const cloudRouteSegment = document.getElementById("cloud-route-segment");
  const localRouteShare = document.getElementById("local-route-share");
  const cloudRouteShare = document.getElementById("cloud-route-share");
  const controlsBanner = document.getElementById("agent-controls-banner");
  const controlsMode = document.getElementById("agent-controls-mode");
  const agentIdentityCount = document.getElementById("agent-identity-count");
  const agentIdentityNote = document.getElementById("agent-identity-note");
  const agentFleetCoverage = document.getElementById("agent-fleet-coverage");
  const agentFleetNote = document.getElementById("agent-fleet-note");
  const chatBudgetState = document.getElementById("chat-budget-state");
  const chatBudgetToggle = document.getElementById("chat-budget-toggle");
  const chatBudgetNote = document.getElementById("chat-budget-note");
  const approvedCommandCount = document.getElementById("approved-command-count");
  const approvedCommandForm = document.getElementById("approved-command-form");
  const approvedCommandInput = document.getElementById("approved-command-input");
  const approvedCommandsList = document.getElementById("approved-commands-list");
  const jiraGuardrailDemoButton = document.getElementById("jira-guardrail-demo-button");
  const jiraGuardrailDemoResult = document.getElementById("jira-guardrail-demo-result");
  const capabilityToggles = Array.from(document.querySelectorAll("[data-capability-toggle]"));
  const toolExceptionCount = document.getElementById("tool-exception-count");
  const toolExceptionsList = document.getElementById("tool-exceptions-list");
  const policyStudioBanner = document.getElementById("policy-studio-banner");
  const policyStudioChatLog = document.getElementById("policy-studio-chat-log");
  const policyStudioPresetRow = document.getElementById("policy-studio-preset-row");
  const policyStudioForm = document.getElementById("policy-studio-form");
  const policyStudioInput = document.getElementById("policy-studio-input");
  const policyStudioGenerateButton = document.getElementById("policy-studio-generate-button");
  const policyStudioDraftEmpty = document.getElementById("policy-studio-draft-empty");
  const policyStudioDraftContent = document.getElementById("policy-studio-draft-content");
  const policyStudioGenerationMode = document.getElementById("policy-studio-generation-mode");
  const policyStudioDraftStatus = document.getElementById("policy-studio-draft-status");
  const policyStudioDraftTitle = document.getElementById("policy-studio-draft-title");
  const policyStudioRisk = document.getElementById("policy-studio-risk");
  const policyStudioDraftSummary = document.getElementById("policy-studio-draft-summary");
  const policyStudioFacts = document.getElementById("policy-studio-facts");
  const policyStudioRuleCount = document.getElementById("policy-studio-rule-count");
  const policyStudioRules = document.getElementById("policy-studio-rules");
  const policyStudioWarnings = document.getElementById("policy-studio-warnings");
  const policyStudioJson = document.getElementById("policy-studio-json");
  const policyStudioReviewConfirmed = document.getElementById("policy-studio-review-confirmed");
  const policyStudioReviseButton = document.getElementById("policy-studio-revise-button");
  const policyStudioStageButton = document.getElementById("policy-studio-stage-button");
  const policyStudioStageResult = document.getElementById("policy-studio-stage-result");
  const agentControlTabs = Array.from(document.querySelectorAll("[data-agent-control-tab]"));
  const agentControlPanels = Array.from(document.querySelectorAll("[data-agent-control-panel]"));
  const tokenomicsCostPanel = document.getElementById("tokenomics-cost-panel");
  const tokenomicsCostAnalytics = document.getElementById("tokenomics-cost-analytics");
  tokenomicsCostPanel.insertBefore(tokenomicsCostAnalytics, document.getElementById("routing-demo"));
  const tokenomicsTabs = Array.from(document.querySelectorAll("[data-tokenomics-tab]"));
  const tokenomicsPanels = Array.from(document.querySelectorAll("[data-tokenomics-panel]"));
  const tokenomicsFilterBar = document.querySelector(".tokenomics-filter-bar");
  const tokenomicsWindowFilter = document.getElementById("tokenomics-window-filter");
  const tokenomicsTeamFilter = document.getElementById("tokenomics-team-filter");
  const tokenomicsModelFilterField = document.getElementById("tokenomics-model-filter-field");
  const tokenomicsModelFilter = document.getElementById("tokenomics-model-filter");
  const tokenomicsAgentFilterField = document.getElementById("tokenomics-agent-filter-field");
  const tokenomicsAgentFilter = document.getElementById("tokenomics-agent-filter");
  const tokenomicsClearFilters = document.getElementById("tokenomics-clear-filters");
  const tokenomicsAnalyticsSource = document.getElementById("tokenomics-analytics-source");
  const tokenomicsAnalyticsUpdated = document.getElementById("tokenomics-analytics-updated");
  const adoptionProviderSummary = document.getElementById("adoption-provider-summary");
  const adoptionTrendChart = document.getElementById("adoption-trend-chart");
  const adoptionTeamMatrix = document.getElementById("adoption-team-matrix");
  const adoptionUtilizationDonut = document.getElementById("adoption-utilization-donut");
  const adoptionJobDonut = document.getElementById("adoption-job-donut");
  const costSummaryGrid = document.getElementById("cost-summary-grid");
  const agentEconomicsCount = document.getElementById("agent-economics-count");
  const agentEconomicsContext = document.getElementById("agent-economics-context");
  const agentEconomicsTable = document.getElementById("agent-economics-table");
  const tokenomicsOpportunityList = document.getElementById("tokenomics-opportunity-list");
  const costTrendChart = document.getElementById("cost-trend-chart");
  const costBreakdownControls = document.getElementById("cost-breakdown-controls");
  const costBreakdownBars = document.getElementById("cost-breakdown-bars");
  const usageDetailDimensions = document.getElementById("usage-detail-dimensions");
  const usageDetailSearch = document.getElementById("usage-detail-search");
  const usageDetailTable = document.getElementById("usage-detail-table");
  const usagePagePrev = document.getElementById("usage-page-prev");
  const usagePageNext = document.getElementById("usage-page-next");
  const usagePageState = document.getElementById("usage-page-state");
  const infrastructureDisclosure = document.getElementById("infrastructure-disclosure");
  const infrastructureLiveStatus = document.getElementById("infrastructure-live-status");
  const infrastructureRefreshButton = document.getElementById("infrastructure-refresh-button");
  const infrastructureReportingState = document.getElementById("infrastructure-reporting-state");
  const infrastructureSourceState = document.getElementById("infrastructure-source-state");
  const infrastructureSummaryGrid = document.getElementById("infrastructure-summary-grid");
  const infrastructureUtilizationChart = document.getElementById("infrastructure-utilization-chart");
  const infrastructureEfficiencyList = document.getElementById("infrastructure-efficiency-list");
  const infrastructureDeviceTable = document.getElementById("infrastructure-device-table");

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatNumber(value) {
    const numeric = Number(value || 0);
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(numeric);
  }

  function formatCompactNumber(value) {
    const numeric = Number(value || 0);
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 1,
      notation: "compact",
    }).format(numeric);
  }

  function formatCompactCurrency(value) {
    const numeric = Number(value || 0);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 1,
      notation: "compact",
    }).format(numeric);
  }

  function formatCurrency(value) {
    const numeric = Number(value || 0);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(numeric);
  }

  function formatWhen(value) {
    if (!value) {
      return "just now";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_error) {
        data = { error: text };
      }
    }
    if (!response.ok) {
      const message = data.error || `${response.status} ${response.statusText}`;
      throw new Error(message);
    }
    return data;
  }

  function setBanner(kind, message) {
    if (!message) {
      statusBanner.className = "status-banner hidden";
      statusBanner.textContent = "";
      return;
    }
    statusBanner.className = `status-banner ${kind === "warn" ? "warn" : ""}`;
    statusBanner.textContent = message;
  }

  function setControlsBanner(kind, message) {
    if (!message) {
      controlsBanner.className = "status-banner hidden";
      controlsBanner.textContent = "";
      return;
    }
    controlsBanner.className = `status-banner ${kind === "warn" ? "warn" : ""}`;
    controlsBanner.textContent = message;
  }

  function setPageBanner(element, kind, message) {
    if (!message) {
      element.className = "status-banner hidden";
      element.textContent = "";
      return;
    }
    element.className = `status-banner ${kind === "warn" ? "warn" : ""}`;
    element.textContent = message;
  }

  function policyStudioLabel(value) {
    return String(value || "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  function appendPolicyStudioMessage(role, message, options = {}) {
    const row = document.createElement("div");
    row.className = `policy-studio-message is-${role}${options.thinking ? " is-thinking" : ""}`;
    if (options.id) {
      row.id = options.id;
    }
    const identity = role === "user" ? "You" : "Policy Studio";
    const initials = role === "user" ? "YOU" : "PS";
    row.innerHTML = `
      <span class="policy-studio-avatar" aria-hidden="true">${initials}</span>
      <div><b>${identity}</b><p>${escapeHtml(message)}</p></div>
    `;
    policyStudioChatLog.appendChild(row);
    policyStudioChatLog.scrollTop = policyStudioChatLog.scrollHeight;
    return row;
  }

  function setPolicyStudioGenerating(generating) {
    state.policyStudioGenerating = generating;
    const busy = generating || state.policyStudioStaging;
    policyStudioForm.setAttribute("aria-busy", busy ? "true" : "false");
    policyStudioChatLog.setAttribute("aria-busy", busy ? "true" : "false");
    policyStudioInput.disabled = busy;
    policyStudioGenerateButton.disabled = busy;
    policyStudioGenerateButton.innerHTML = generating
      ? '<span aria-hidden="true">✦</span> Generating validated draft…'
      : '<span aria-hidden="true">✦</span> Generate guardrail';
    policyStudioPresetRow.querySelectorAll("button").forEach((button) => {
      button.disabled = busy;
    });
    const staged = state.policyStudioDraft && state.policyStudioDraft.status === "staged";
    policyStudioReviewConfirmed.disabled = Boolean(busy || staged);
    policyStudioStageButton.disabled = Boolean(
      busy || staged || !policyStudioReviewConfirmed.checked,
    );
  }

  function renderPolicyStudioDraft(draft) {
    const rules = Array.isArray(draft.rules) ? draft.rules : [];
    const exceptions = Array.isArray(draft.exceptions) ? draft.exceptions : [];
    const warnings = Array.isArray(draft.warnings) ? draft.warnings : [];
    const generation = draft.generation || {};
    const isLive = generation.mode === "live";
    const isStaged = draft.status === "staged";

    policyStudioDraftEmpty.classList.add("hidden");
    policyStudioDraftContent.classList.remove("hidden");
    policyStudioDraftTitle.textContent = draft.name || "Untitled guardrail";
    policyStudioDraftStatus.textContent = isStaged ? "Staged · not enforced" : "Generated · review required";
    policyStudioDraftStatus.className = `policy-studio-draft-status${isStaged ? " is-staged" : ""}`;
    policyStudioRisk.textContent = policyStudioLabel(draft.risk_level || "high");
    policyStudioRisk.className = `risk-label is-${escapeHtml(draft.risk_level || "high")}`;
    policyStudioDraftSummary.textContent = draft.summary || "";
    policyStudioGenerationMode.textContent = isLive
      ? `${generation.provider || "AI"} · ${generation.model || "configured model"}`
      : "Validated template fallback";
    policyStudioGenerationMode.className = `pill policy-studio-generation-mode ${
      isLive ? "is-live" : "is-fallback"
    }`;

    const scope = draft.scope || {};
    policyStudioFacts.innerHTML = `
      <div><dt>Scope</dt><dd>${escapeHtml(policyStudioLabel(scope.type || "fleet"))} · ${escapeHtml(
        scope.value || "AMD Deskside Pilot",
      )}</dd></div>
      <div><dt>Default decision</dt><dd>${escapeHtml(policyStudioLabel(draft.mode || "require_approval"))}</dd></div>
      <div><dt>Exceptions</dt><dd>${exceptions.length ? `${exceptions.length} declared` : "None"}</dd></div>
    `;
    policyStudioRuleCount.textContent = `${rules.length} ${rules.length === 1 ? "rule" : "rules"}`;
    policyStudioRules.innerHTML = rules
      .map(
        (rule) => `
          <article class="policy-studio-rule" data-decision="${escapeHtml(rule.decision)}">
            <div class="policy-studio-rule-head">
              <strong>${escapeHtml(policyStudioLabel(rule.category))} · ${escapeHtml(
                policyStudioLabel(rule.severity),
              )}</strong>
              <span>${escapeHtml(policyStudioLabel(rule.decision))}</span>
            </div>
            <p>${escapeHtml(rule.condition)}</p>
            <small>${escapeHtml(rule.rationale)}</small>
          </article>
        `,
      )
      .join("");
    policyStudioWarnings.innerHTML = [
      ...exceptions.map(
        (exception) => `<div class="policy-studio-warning is-exception"><strong>Exception</strong> · ${escapeHtml(exception)}</div>`,
      ),
      ...warnings.map((warning) => `<div class="policy-studio-warning">${escapeHtml(warning)}</div>`),
    ].join("");
    policyStudioJson.textContent = JSON.stringify(draft.policy || {}, null, 2);
    policyStudioReviewConfirmed.checked = isStaged;
    policyStudioReviewConfirmed.disabled =
      isStaged || state.policyStudioGenerating || state.policyStudioStaging;
    policyStudioStageButton.disabled =
      isStaged ||
      state.policyStudioGenerating ||
      state.policyStudioStaging ||
      !policyStudioReviewConfirmed.checked;
    policyStudioStageButton.textContent = isStaged ? "Staged for deployment" : "Stage reviewed guardrail";
    policyStudioStageResult.className = "policy-studio-stage-result hidden";
    policyStudioStageResult.textContent = "";
  }

  async function generatePolicyStudioDraft(event) {
    event.preventDefault();
    if (state.policyStudioGenerating || state.policyStudioStaging) {
      return;
    }
    const message = policyStudioInput.value.trim();
    if (!message) {
      policyStudioInput.focus();
      return;
    }

    setPageBanner(policyStudioBanner, "warn", "");
    appendPolicyStudioMessage("user", message);
    const thinking = appendPolicyStudioMessage(
      "assistant",
      "Translating intent, constraining the schema, and validating each decision…",
      { id: "policy-studio-thinking", thinking: true },
    );
    setPolicyStudioGenerating(true);
    policyStudioInput.value = "";
    try {
      const body = { message };
      if (state.policyStudioConversationId) {
        body.conversation_id = state.policyStudioConversationId;
      }
      if (state.policyStudioDraft && state.policyStudioDraft.id) {
        body.previous_draft_id = state.policyStudioDraft.id;
      }
      const response = await fetchJson(`${apiBase}/policy-studio/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.draft || !response.conversation_id) {
        throw new Error("Policy Studio returned an incomplete draft");
      }
      state.policyStudioConversationId = response.conversation_id;
      state.policyStudioDraft = response.draft;
      thinking.remove();
      appendPolicyStudioMessage(
        "assistant",
        response.assistant && response.assistant.message
          ? response.assistant.message
          : "The draft is ready for review.",
      );
      renderPolicyStudioDraft(response.draft);
      if (response.draft.generation && response.draft.generation.mode !== "live") {
        setPageBanner(
          policyStudioBanner,
          "warn",
          "Validated template fallback used. Configure the approved Policy Studio model provider for live generative drafting.",
        );
      }
    } catch (error) {
      thinking.remove();
      appendPolicyStudioMessage(
        "assistant",
        "I could not create a validated draft. Your request was not staged and no enforcement changed.",
      );
      setPageBanner(policyStudioBanner, "danger", `Policy Studio could not generate the draft: ${error.message}`);
      policyStudioInput.value = message;
    } finally {
      setPolicyStudioGenerating(false);
    }
  }

  async function stagePolicyStudioDraft() {
    const draft = state.policyStudioDraft;
    if (
      !draft ||
      state.policyStudioGenerating ||
      state.policyStudioStaging ||
      !policyStudioReviewConfirmed.checked
    ) {
      return;
    }
    state.policyStudioStaging = true;
    setPolicyStudioGenerating(false);
    policyStudioStageButton.textContent = "Staging reviewed draft…";
    policyStudioStageResult.className = "policy-studio-stage-result hidden";
    try {
      const response = await fetchJson(
        `${apiBase}/policy-studio/drafts/${encodeURIComponent(draft.id)}/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expected_version: draft.version,
            review_confirmed: true,
            reason: "Scope and every generated decision reviewed in Policy Studio",
          }),
        },
      );
      state.policyStudioDraft = response.draft;
      renderPolicyStudioDraft(response.draft);
      policyStudioStageResult.className = "policy-studio-stage-result";
      policyStudioStageResult.textContent = response.application.message;
      appendPolicyStudioMessage(
        "assistant",
        "Demo acknowledgment recorded. The guardrail is staged for a future deployment workflow; live enforcement remains unchanged.",
      );
      setPageBanner(
        policyStudioBanner,
        "warn",
        "Guardrail staged · not enforced. Use a separately approved policy deployment workflow to activate it.",
      );
    } catch (error) {
      policyStudioStageResult.className = "policy-studio-stage-result is-error";
      policyStudioStageResult.textContent = `Could not stage the guardrail: ${error.message}`;
      policyStudioStageButton.disabled = false;
      policyStudioStageButton.textContent = "Stage reviewed guardrail";
    } finally {
      state.policyStudioStaging = false;
      setPolicyStudioGenerating(false);
    }
  }

  function revisePolicyStudioDraft() {
    if (state.policyStudioGenerating || state.policyStudioStaging) {
      return;
    }
    setPageBanner(policyStudioBanner, "warn", "Describe what you want to change; the next draft will retain this conversation context.");
    policyStudioInput.focus({ preventScroll: true });
    policyStudioInput.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "center",
    });
  }

  function renderRoutingDemo() {
    const enabled = state.routingDemoEnabled;
    lemonadeRoutingToggle.setAttribute("aria-checked", enabled ? "true" : "false");
    lemonadeRoutingToggle.querySelector("b").textContent = enabled ? "Enabled" : "Disabled";
    lemonadeRoutingLabel.textContent = enabled ? "Lemonade local-first" : "Cloud route";
    routerModeCopy.textContent = enabled
      ? "75% local · approved cloud fallback"
      : "100% approved cloud";
    const localShare = enabled ? 75 : 0;
    const cloudShare = enabled ? 25 : 100;
    localRouteSegment.style.width = `${localShare}%`;
    cloudRouteSegment.style.width = `${cloudShare}%`;
    localRouteShare.textContent = `${localShare}%`;
    cloudRouteShare.textContent = `${cloudShare}%`;
  }

  function runRoutingDemo() {
    if (state.routingDemoRunning) {
      return;
    }
    if (state.routingDemoFrame) {
      window.cancelAnimationFrame(state.routingDemoFrame);
    }
    state.routingDemoRunning = true;
    demoRunButton.disabled = true;
    lemonadeRoutingToggle.disabled = true;
    demoRunButton.textContent = "Task running…";
    demoTaskState.textContent = state.routingDemoEnabled ? "Routing with Lemonade" : "Routing to cloud";
    demoTaskResult.textContent = "Running";
    demoTaskDot.className = "is-running";
    demoTokenCounter.textContent = "0";
    const target = state.routingDemoEnabled ? 4600 : 18400;
    const startedAt = window.performance.now();
    const duration = prefersReducedMotion ? 1 : 1350;

    function step(now) {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      demoTokenCounter.textContent = formatNumber(Math.round(target * eased));
      if (progress < 1) {
        state.routingDemoFrame = window.requestAnimationFrame(step);
        return;
      }
      state.routingDemoFrame = 0;
      state.routingDemoRunning = false;
      demoTaskDot.className = "is-complete";
      demoTaskState.textContent = state.routingDemoEnabled ? "Complete · Lemonade local-first" : "Complete · cloud";
      demoTaskResult.textContent = "Tests passed · same result";
      demoRunButton.disabled = false;
      lemonadeRoutingToggle.disabled = false;
      demoRunButton.textContent = "Run task again";
    }

    state.routingDemoFrame = window.requestAnimationFrame(step);
  }

  function toggleLemonadeRouting() {
    if (state.routingDemoRunning) {
      return;
    }
    state.routingDemoEnabled = !state.routingDemoEnabled;
    demoTokenCounter.textContent = "0";
    demoTaskDot.className = "";
    demoTaskState.textContent = state.routingDemoEnabled ? "Lemonade on · ready" : "Cloud baseline · ready";
    demoTaskResult.textContent = "Awaiting run";
    renderRoutingDemo();
    runRoutingDemo();
  }

  function agentControlTabFromPath(pathname) {
    if (pathname === "/policy-studio") return "studio";
    if (pathname === "/agent-behavior") return "behavior";
    return "controls";
  }

  function activateAgentControlTab(tab, updateUrl) {
    const validTabs = new Set(agentControlTabs.map((button) => button.dataset.agentControlTab));
    const nextTab = validTabs.has(tab) ? tab : "controls";
    state.activeAgentControlTab = nextTab;
    agentControlTabs.forEach((button) => {
      const active = button.dataset.agentControlTab === nextTab;
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.tabIndex = active ? 0 : -1;
    });
    agentControlPanels.forEach((panel) => {
      const active = panel.dataset.agentControlPanel === nextTab;
      panel.classList.toggle("hidden", !active);
      panel.hidden = !active;
    });
    if (updateUrl !== false) {
      const tabRoutes = {
        controls: "/agent-controls",
        studio: "/policy-studio",
        behavior: "/agent-behavior",
      };
      const url = new URL(window.location.href);
      url.pathname = tabRoutes[nextTab];
      url.search = "";
      url.hash = "";
      window.history.pushState({}, "", url);
      activateShellPage();
    }
  }

  function activateShellPage() {
    const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
    let activePage = "fleet";
    if (pathname === "/budgets" || pathname === "/tokenomics") {
      activePage = "budget";
    } else if (pathname === "/infrastructure") {
      activePage = "infrastructure";
    } else if (["/agent-controls", "/policy-studio", "/agent-behavior"].includes(pathname)) {
      activePage = "controls";
    } else if (pathname === "/network-security" || pathname === "/agent-security") {
      activePage = "network";
    }
    if (activePage === "controls") {
      activateAgentControlTab(agentControlTabFromPath(pathname), false);
    }
    fleetPage.classList.toggle("hidden", activePage !== "fleet");
    infrastructurePage.classList.toggle("hidden", activePage !== "infrastructure");
    budgetPage.classList.toggle("hidden", activePage !== "budget");
    controlsPage.classList.toggle("hidden", activePage !== "controls");
    networkPage.classList.toggle("hidden", activePage !== "network");
    fleetScopeBar.classList.toggle("hidden", activePage !== "fleet");
    const pageLabels = {
      fleet: "Fleet Overview",
      infrastructure: "Infrastructure",
      budget: "Tokenomics",
      controls: "Agent Control",
      network: "Network Security",
    };
    const pageLabel = pageLabels[activePage];
    const agentControlTabLabels = {
      controls: "Agent Control",
      studio: "Policy Studio | Agent Control",
      behavior: "Agent Behavior | Agent Control",
    };
    const titleLabel = activePage === "controls" ? agentControlTabLabels[state.activeAgentControlTab] : pageLabel;
    document.title = `${titleLabel} | Deskside AI Resilience | Cloud Control`;
    activeBreadcrumb.textContent = pageLabel;
    let activeNavLink = null;
    document.querySelectorAll("[data-shell-nav]").forEach((link) => {
      const isActive = link.dataset.shellNav === activePage;
      link.classList.toggle("is-active", isActive);
      if (isActive) {
        activeNavLink = link;
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
    if (activeNavLink && sideNavigation.scrollWidth > sideNavigation.clientWidth) {
      sideNavigation.scrollLeft = Math.max(
        0,
        activeNavLink.offsetLeft - (sideNavigation.clientWidth - activeNavLink.offsetWidth) / 2,
      );
    }
  }

  function renderLedgerProvenance() {
    const debug = state.summary && state.summary.debug ? state.summary.debug : null;
    if (!debug) {
      tokenomicsLedgerStatus.innerHTML = '<span aria-hidden="true"></span>Loading agent telemetry';
      return;
    }
    if (debug.fixture_backed) {
      tokenomicsLedgerStatus.innerHTML = '<span aria-hidden="true"></span>Fixture ledger';
      return;
    }
    tokenomicsLedgerStatus.innerHTML = '<span aria-hidden="true"></span>1-device live ledger';
  }

  const analyticsProviderColors = {
    "amd-local": "#36d39a",
    openai: "#31a7f5",
    anthropic: "#8b78f6",
    google: "#f3c746",
  };

  const analyticsModelColors = {
    "amd-local-default": "#36d39a",
    "gpt-4o-mini": "#31a7f5",
    "gpt-4.1-mini": "#62c4ff",
    "gpt-5.4-mini": "#9bdcff",
    "gpt-5.4": "#0f91e8",
    "gpt-5.5": "#007fd4",
    "claude-sonnet-4-5": "#8b78f6",
    "claude-sonnet-4-6": "#b69cff",
    "claude-opus-4-8": "#6d55d9",
    "claude-haiku-4-5-20251001": "#d2c2ff",
    "gemini-2.5-flash": "#f3c746",
    "gemini-3.5-flash": "#ffdf75",
    "gemini-3.1-pro-preview": "#e69f22",
  };

  function analyticsPayload() {
    return state.analytics && typeof state.analytics === "object" ? state.analytics : null;
  }

  function organizationProjection() {
    const analytics = analyticsPayload();
    const projection = analytics && analytics.cost ? analytics.cost.organization_projection : null;
    return {
      annualizationWeeks: Number(projection && projection.annualization_weeks || 0),
      basisWindowDays: Number(projection && projection.basis_window_days || 0),
      cloudTokens: Number(projection && projection.modeled_non_halo_cloud_tokens || 0),
      developers: Number(projection && projection.modeled_non_halo_developers || 0),
      estimatedCloudCostUsd: Number(projection && projection.modeled_non_halo_estimated_cost_usd || 0),
      status: projection && projection.status || "unavailable",
    };
  }

  function organizationOverlayEnabled() {
    return (
      state.analyticsAgent === "all" &&
      state.analyticsTeam === "all" &&
      state.analyticsModel === "all"
    );
  }

  function tokenomicsFilterLabels(options = {}) {
    const includeAgent = options.includeAgent !== false;
    const labels = [];
    if (state.analyticsTeam !== "all") {
      labels.push(analyticsDimensionLabel("team", state.analyticsTeam));
    }
    if (state.analyticsModel !== "all") {
      labels.push(analyticsDimensionLabel("model", state.analyticsModel));
    }
    if (includeAgent && state.analyticsAgent !== "all") {
      labels.push(analyticsDimensionLabel("agent", state.analyticsAgent));
    }
    return labels;
  }

  function tokenomicsFilterContext(options = {}) {
    const labels = tokenomicsFilterLabels(options);
    return labels.length ? labels.join(" · ") : "All managed agents";
  }

  function updateTokenomicsFilterUrl() {
    const url = new URL(window.location.href);
    for (const [name, value] of [
      ["team", state.analyticsTeam],
      ["model", state.analyticsModel],
      ["agent", state.analyticsAgent],
    ]) {
      if (value === "all") url.searchParams.delete(name);
      else url.searchParams.set(name, value);
    }
    url.searchParams.delete("provider");
    window.history.replaceState({}, "", url);
  }

  function analyticsDimensionMap(dimension) {
    const analytics = analyticsPayload();
    const rows = analytics && analytics.dimensions && Array.isArray(analytics.dimensions[`${dimension}s`])
      ? analytics.dimensions[`${dimension}s`]
      : [];
    const idKey = `${dimension}_id`;
    return new Map(rows.map((row) => [row[idKey], row]));
  }

  function analyticsDimensionLabel(dimension, id) {
    const row = analyticsDimensionMap(dimension).get(id);
    return row ? row.display_name || row.name || id : id || "Unknown";
  }

  function analyticsProviderColor(providerId) {
    return analyticsProviderColors[providerId] || "#8d96a5";
  }

  function analyticsModelColor(modelId) {
    const model = analyticsDimensionMap("model").get(modelId);
    return analyticsModelColors[modelId] || analyticsProviderColor(model && model.provider_id);
  }

  function populateAnalyticsFilters() {
    const analytics = analyticsPayload();
    if (!analytics || !analytics.dimensions) {
      return;
    }
    const models = Array.isArray(analytics.dimensions.models) ? analytics.dimensions.models : [];
    const teams = Array.isArray(analytics.dimensions.teams) ? analytics.dimensions.teams : [];
    const agents = Array.isArray(analytics.dimensions.agents)
      ? analytics.dimensions.agents.slice().sort((left, right) =>
          String(left.name || left.agent_id).localeCompare(String(right.name || right.agent_id)),
        )
      : [];
    const modelValue = models.some((row) => row.model_id === state.analyticsModel)
      ? state.analyticsModel
      : "all";
    const teamValue = teams.some((row) => row.team_id === state.analyticsTeam) ? state.analyticsTeam : "all";
    const agentValue = agents.some((row) => row.agent_id === state.analyticsAgent) ? state.analyticsAgent : "all";
    const normalizedInvalidFilter =
      modelValue !== state.analyticsModel ||
      teamValue !== state.analyticsTeam ||
      agentValue !== state.analyticsAgent ||
      initialSearchParams.has("provider");
    tokenomicsModelFilter.innerHTML = [
      '<option value="all">All models</option>',
      ...models.map(
        (row) => `<option value="${escapeHtml(row.model_id)}">${escapeHtml(row.name)}</option>`,
      ),
    ].join("");
    tokenomicsTeamFilter.innerHTML = [
      '<option value="all">All departments</option>',
      ...teams.map((row) => `<option value="${escapeHtml(row.team_id)}">${escapeHtml(row.name)}</option>`),
    ].join("");
    tokenomicsAgentFilter.innerHTML = [
      '<option value="all">All agents</option>',
      ...agents.map(
        (row) => `<option value="${escapeHtml(row.agent_id)}">${escapeHtml(row.name)} · ${escapeHtml(
          row.kind === "resident-security" ? "Resident security" : "Workload",
        )}</option>`,
      ),
    ].join("");
    state.analyticsModel = modelValue;
    state.analyticsTeam = teamValue;
    state.analyticsAgent = agentValue;
    if (normalizedInvalidFilter) {
      updateTokenomicsFilterUrl();
      initialSearchParams.delete("provider");
    }
    tokenomicsModelFilter.value = modelValue;
    tokenomicsTeamFilter.value = teamValue;
    tokenomicsAgentFilter.value = agentValue;
    tokenomicsModelFilter.disabled = state.activeTokenomicsTab !== "cost";
    tokenomicsModelFilterField.classList.toggle("is-disabled", tokenomicsModelFilter.disabled);
    tokenomicsAgentFilter.disabled = state.activeTokenomicsTab !== "cost";
    tokenomicsAgentFilterField.classList.toggle("is-disabled", tokenomicsAgentFilter.disabled);
    tokenomicsClearFilters.classList.toggle("hidden", tokenomicsFilterLabels().length === 0);
    tokenomicsWindowFilter.value = state.analyticsWindow;
  }

  function filteredAnalyticsRows(options = {}) {
    const analytics = analyticsPayload();
    const includeAgent = options.includeAgent !== false;
    const includeModel = options.includeModel !== false;
    const rows = analytics && analytics.cost && Array.isArray(analytics.cost.detail_rows)
      ? analytics.cost.detail_rows
      : [];
    return rows.filter(
      (row) =>
        (!includeModel || state.analyticsModel === "all" || row.model_id === state.analyticsModel) &&
        (state.analyticsTeam === "all" || row.team_id === state.analyticsTeam) &&
        (!includeAgent || state.analyticsAgent === "all" || row.agent_id === state.analyticsAgent),
    );
  }

  function aggregateAnalyticsRows(rows, dimension) {
    const grouped = new Map();
    rows.forEach((row) => {
      const id = row[`${dimension}_id`] || "unknown";
      if (!grouped.has(id)) {
        grouped.set(id, {
          id,
          label: analyticsDimensionLabel(dimension, id),
          tasks: 0,
          requests: 0,
          total_tokens: 0,
          estimated_cost_usd: 0,
          providerIds: new Set(),
          teamIds: new Set(),
          agentIds: new Set(),
          modelIds: new Set(),
          userIds: new Set(),
          deviceIds: new Set(),
        });
      }
      const group = grouped.get(id);
      group.tasks += Number(row.tasks || 0);
      group.requests += Number(row.requests || 0);
      group.total_tokens += Number(row.total_tokens || 0);
      group.estimated_cost_usd += Number(row.estimated_cost_usd || 0);
      group.providerIds.add(row.provider_id);
      group.teamIds.add(row.team_id);
      group.agentIds.add(row.agent_id);
      group.modelIds.add(row.model_id);
      group.userIds.add(row.user_id);
      group.deviceIds.add(row.device_id);
    });
    return Array.from(grouped.values()).sort(
      (left, right) =>
        right.estimated_cost_usd - left.estimated_cost_usd ||
        right.total_tokens - left.total_tokens ||
        left.label.localeCompare(right.label),
    );
  }

  function renderAnalyticsEmpty(target, message) {
    target.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  }

  function activateTokenomicsTab(tab, updateUrl) {
    const validTabs = new Set(tokenomicsTabs.map((button) => button.dataset.tokenomicsTab));
    const nextTab = validTabs.has(tab) ? tab : "cost";
    state.activeTokenomicsTab = nextTab;
    if (
      nextTab !== "cost" &&
      (state.analyticsAgent !== "all" || state.analyticsModel !== "all")
    ) {
      state.analyticsAgent = "all";
      state.analyticsModel = "all";
      state.usageDetailPage = 1;
      updateTokenomicsFilterUrl();
    }
    tokenomicsTabs.forEach((button) => {
      const active = button.dataset.tokenomicsTab === nextTab;
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.tabIndex = active ? 0 : -1;
    });
    tokenomicsPanels.forEach((panel) => {
      const active = panel.dataset.tokenomicsPanel === nextTab;
      panel.classList.toggle("hidden", !active);
      panel.hidden = !active;
    });
    if (nextTab === "adoption" || nextTab === "cost") {
      const analyticsPanel = document.getElementById(
        nextTab === "adoption" ? "tokenomics-adoption-panel" : "tokenomics-cost-analytics",
      );
      analyticsPanel.insertBefore(tokenomicsFilterBar, analyticsPanel.firstChild);
    }
    tokenomicsFilterBar.classList.toggle("hidden", nextTab === "budget");
    tokenomicsModelFilter.disabled = nextTab !== "cost";
    tokenomicsModelFilterField.classList.toggle("is-disabled", tokenomicsModelFilter.disabled);
    tokenomicsAgentFilter.disabled = nextTab !== "cost";
    tokenomicsAgentFilterField.classList.toggle("is-disabled", tokenomicsAgentFilter.disabled);
    if (updateUrl !== false) {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", nextTab);
      window.history.replaceState({}, "", url);
    }
    if (analyticsPayload()) {
      renderTokenomicsAnalytics();
    }
  }

  function renderLineChart(target, series, valueFormatter) {
    const dates = Array.from(
      new Set(series.flatMap((item) => item.points.map((point) => point.date))),
    ).sort();
    if (!dates.length || !series.length) {
      renderAnalyticsEmpty(target, "No modeled activity matches these filters.");
      return;
    }
    const width = 760;
    const height = 270;
    const margin = { top: 14, right: 18, bottom: 38, left: 48 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const maximum = Math.max(1, ...series.flatMap((item) => item.points.map((point) => Number(point.value || 0))));
    const yMaximum = Math.ceil(maximum / 5) * 5 || 5;
    const x = (index) => margin.left + (dates.length === 1 ? plotWidth / 2 : (index / (dates.length - 1)) * plotWidth);
    const y = (value) => margin.top + plotHeight - (Number(value || 0) / yMaximum) * plotHeight;
    const grid = Array.from({ length: 5 }, (_, index) => {
      const value = (yMaximum / 4) * index;
      const yPosition = y(value);
      return `<line class="grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${yPosition}" y2="${yPosition}"></line><text class="axis-label" x="${margin.left - 9}" y="${yPosition + 3}" text-anchor="end">${escapeHtml(valueFormatter(value))}</text>`;
    }).join("");
    const dateLabels = dates
      .map((date, index) => {
        const parsed = new Date(`${date}T12:00:00Z`);
        const label = Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
        return `<text class="axis-label" x="${x(index)}" y="${height - 13}" text-anchor="middle">${escapeHtml(label)}</text>`;
      })
      .join("");
    const lines = series
      .map((item) => {
        const byDate = new Map(item.points.map((point) => [point.date, Number(point.value || 0)]));
        const coordinates = dates.map((date, index) => `${x(index)},${y(byDate.get(date) || 0)}`).join(" ");
        return `<polyline class="chart-line" stroke="${escapeHtml(item.color)}" points="${coordinates}"></polyline>`;
      })
      .join("");
    const legend = series
      .map(
        (item) => `<span><i style="background:${escapeHtml(item.color)}"></i>${escapeHtml(item.name)}</span>`,
      )
      .join("");
    target.innerHTML = `<svg class="analytics-svg" viewBox="0 0 ${width} ${height}" aria-hidden="true">${grid}${dateLabels}${lines}</svg><div class="chart-legend">${legend}</div>`;
  }

  function renderDonut(target, segments, centerValue, centerLabel) {
    const normalized = segments.filter((segment) => Number(segment.value || 0) > 0);
    const total = normalized.reduce((sum, segment) => sum + Number(segment.value || 0), 0);
    if (!total) {
      renderAnalyticsEmpty(target, "No modeled usage matches these filters.");
      return;
    }
    let cursor = 0;
    const stops = normalized.map((segment) => {
      const start = cursor;
      cursor += (Number(segment.value || 0) / total) * 100;
      return `${segment.color} ${start}% ${cursor}%`;
    });
    const legend = normalized
      .map(
        (segment) => `<div class="donut-legend-row"><i style="background:${escapeHtml(segment.color)}"></i><span>${escapeHtml(segment.name)}</span><strong>${escapeHtml(segment.displayValue || formatCompactNumber(segment.value))}</strong></div>`,
      )
      .join("");
    target.innerHTML = `<div class="donut-chart" style="--donut-gradient:conic-gradient(${stops.join(",")})"><div class="donut-center"><strong>${escapeHtml(centerValue)}</strong><span>${escapeHtml(centerLabel)}</span></div></div><div class="donut-legend">${legend}</div>`;
  }

  function renderAdoptionSummary() {
    const analytics = analyticsPayload();
    const adoption = analytics.adoption;
    const providerMap = analyticsDimensionMap("provider");
    const matrix = Array.isArray(adoption.team_provider_matrix) ? adoption.team_provider_matrix : [];
    const providerTotals = Array.isArray(adoption.provider_totals) ? adoption.provider_totals : [];
    const cards = [
      `<article class="adoption-stat"><span>Fleet</span><strong>${formatNumber(adoption.summary.active_users)} / ${formatNumber(adoption.summary.total_employees)}</strong><small>${formatNumber(adoption.summary.reporting_desksides)} reporting · unfiltered</small></article>`,
    ];
    providerTotals.forEach((row) => {
      const provider = providerMap.get(row.provider_id) || { name: row.provider_id };
      const teamCell = matrix.find(
        (cell) => cell.team_id === state.analyticsTeam && cell.provider_id === row.provider_id,
      );
      const value = state.analyticsTeam === "all" ? row.active_users : Number((teamCell && teamCell.active_users) || 0);
      const delta = Number(row.change_from_previous_window || 0);
      const detail = state.analyticsTeam === "all"
        ? `${delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} ${formatNumber(Math.abs(delta))} vs prior`
        : analyticsDimensionLabel("team", state.analyticsTeam);
      const detailClass = state.analyticsTeam !== "all" || delta === 0 ? "" : delta > 0 ? "is-up" : "is-down";
      cards.push(
        `<article class="adoption-stat"><span class="provider-name"><i class="provider-swatch" style="background:${analyticsProviderColor(row.provider_id)}"></i>${escapeHtml(provider.name)}</span><strong>${formatNumber(value)}</strong><small class="${detailClass}">${escapeHtml(detail)}</small></article>`,
      );
    });
    adoptionProviderSummary.innerHTML = cards.join("");
  }

  function renderAdoptionTrend() {
    const analytics = analyticsPayload();
    const adoption = analytics.adoption;
    const providerMap = analyticsDimensionMap("provider");
    const totalsMap = new Map((adoption.provider_totals || []).map((row) => [row.provider_id, Number(row.active_users || 0)]));
    const matrixMap = new Map(
      (adoption.team_provider_matrix || []).map((row) => [`${row.team_id}:${row.provider_id}`, Number(row.active_users || 0)]),
    );
    const providerIds = Array.from(
      new Set((adoption.daily_active_users || []).map((row) => row.provider_id)),
    );
    const series = providerIds.map((providerId) => {
      const provider = providerMap.get(providerId) || { name: providerId };
      const fleetTotal = totalsMap.get(providerId) || 0;
      const teamTotal = matrixMap.get(`${state.analyticsTeam}:${providerId}`) || 0;
      const scale = state.analyticsTeam === "all" || !fleetTotal ? 1 : teamTotal / fleetTotal;
      return {
        id: providerId,
        name: provider.name,
        color: analyticsProviderColor(providerId),
        points: (adoption.daily_active_users || [])
          .filter((row) => row.provider_id === providerId)
          .map((row) => ({ date: row.date, value: Math.round(Number(row.active_users || 0) * scale) })),
      };
    });
    adoptionTrendChart.setAttribute(
      "aria-label",
      state.analyticsTeam === "all"
        ? "Seven-day active employee trend by execution provider"
        : `Allocated seven-day active employee trend for ${analyticsDimensionLabel("team", state.analyticsTeam)}`,
    );
    renderLineChart(adoptionTrendChart, series, (value) => formatNumber(Math.round(value)));
  }

  function renderAdoptionMatrix() {
    const analytics = analyticsPayload();
    const providers = analytics.dimensions.providers || [];
    const teams = (analytics.dimensions.teams || []).filter(
      (row) => state.analyticsTeam === "all" || row.team_id === state.analyticsTeam,
    );
    const matrix = analytics.adoption.team_provider_matrix || [];
    if (!providers.length || !teams.length) {
      renderAnalyticsEmpty(adoptionTeamMatrix, "No modeled department activity matches these filters.");
      return;
    }
    const values = matrix.map((row) => Number(row.active_users || 0));
    const maximum = Math.max(1, ...values);
    const header = providers.map((provider) => `<th scope="col">${escapeHtml(provider.name)}</th>`).join("");
    const body = teams
      .map((team) => {
        const cells = providers
          .map((provider) => {
            const entry = matrix.find(
              (row) => row.team_id === team.team_id && row.provider_id === provider.provider_id,
            );
            const value = Number((entry && entry.active_users) || 0);
            const opacity = 0.12 + (value / maximum) * 0.72;
            return `<td class="heat-cell" style="--heat-opacity:${opacity.toFixed(2)}">${formatNumber(value)}</td>`;
          })
          .join("");
        return `<tr><th scope="row">${escapeHtml(team.name)}</th>${cells}</tr>`;
      })
      .join("");
    adoptionTeamMatrix.innerHTML = `<table class="analytics-matrix"><thead><tr><th scope="col">Department</th>${header}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function renderAdoptionDonuts() {
    const analytics = analyticsPayload();
    const summary = analytics.adoption.summary;
    const inactive = Math.max(Number(summary.total_employees || 0) - Number(summary.active_users || 0), 0);
    renderDonut(
      adoptionUtilizationDonut,
      [
        { name: "Active", value: summary.active_users, color: "#36d39a" },
        { name: "Inactive", value: inactive, color: "#404651" },
      ],
      `${formatNumber(summary.active_user_percent)}%`,
      "fleet adoption · unfiltered",
    );
    const tokenMix = aggregateAnalyticsRows(
      filteredAnalyticsRows({ includeAgent: false, includeModel: false }),
      "provider",
    ).map((row) => ({
      name: row.label,
      value: row.total_tokens,
      displayValue: `${formatCompactNumber(row.total_tokens)} tokens`,
      color: analyticsProviderColor(row.id),
    }));
    renderDonut(
      adoptionJobDonut,
      tokenMix,
      formatCompactNumber(tokenMix.reduce((sum, row) => sum + row.value, 0)),
      "tokens",
    );
  }

  function renderCostSummary() {
    const analytics = analyticsPayload();
    const projection = organizationProjection();
    const rows = filteredAnalyticsRows();
    const totalTokens = rows.reduce((sum, row) => sum + Number(row.total_tokens || 0), 0);
    const estimatedCost = rows.reduce((sum, row) => sum + Number(row.estimated_cost_usd || 0), 0);
    const localTokens = rows
      .filter((row) => row.provider_id === "amd-local")
      .reduce((sum, row) => sum + Number(row.total_tokens || 0), 0);
    const includeOrganizationOverlay = organizationOverlayEnabled() && projection.status === "illustrative";
    const displayedTokens = totalTokens + (includeOrganizationOverlay ? projection.cloudTokens : 0);
    const displayedCost = estimatedCost + (includeOrganizationOverlay ? projection.estimatedCloudCostUsd : 0);
    const projectedCost = includeOrganizationOverlay
      ? displayedCost * projection.annualizationWeeks
      : displayedCost;
    const localShare = displayedTokens ? (localTokens / displayedTokens) * 100 : 0;
    const managedActivePeople = Number(analytics.adoption && analytics.adoption.summary
      ? analytics.adoption.summary.active_users
      : 0);
    const activePeople = includeOrganizationOverlay
      ? managedActivePeople + projection.developers
      : new Set(rows.map((row) => row.user_id).filter(Boolean)).size;
    const cards = [
      {
        label: includeOrganizationOverlay ? "Organization tokens" : "Filtered tokens",
        value: formatCompactNumber(displayedTokens),
        detail: includeOrganizationOverlay
          ? `${formatCompactNumber(totalTokens)} managed + ${formatCompactNumber(projection.cloudTokens)} non-Halo`
          : `${formatNumber(totalTokens)} filtered`,
      },
      {
        label: includeOrganizationOverlay ? "Projected Annual Spend" : "Filtered 7d Spend",
        value: formatCurrency(projectedCost),
        detail: includeOrganizationOverlay
          ? `${formatCurrency(displayedCost)} weekly scenario basis`
          : "Filtered scenario",
      },
      { label: "Local Share", value: `${formatNumber(localShare)}%`, detail: `${formatCompactNumber(localTokens)} local tokens` },
      {
        label: "Active people",
        value: formatNumber(activePeople),
        detail: includeOrganizationOverlay ? `${projection.developers} modeled outside Halo` : `${formatNumber(rows.length)} usage rows`,
      },
    ];
    costSummaryGrid.innerHTML = cards
      .map(
        (card) => `<article class="summary-card"><div class="label">${escapeHtml(card.label)}</div><div class="value">${escapeHtml(card.value)}</div><div class="detail">${escapeHtml(card.detail)}</div></article>`,
      )
      .join("");
  }

  function renderAgentEconomics() {
    const groups = aggregateAnalyticsRows(filteredAnalyticsRows(), "agent");
    const agentMap = analyticsDimensionMap("agent");
    const totalRequests = groups.reduce((sum, row) => sum + row.requests, 0);
    const totalSpend = groups.reduce((sum, row) => sum + row.estimated_cost_usd, 0);
    const filterContext = tokenomicsFilterContext();
    agentEconomicsCount.textContent = `${formatNumber(groups.length)} ${groups.length === 1 ? "agent" : "agents"}`;
    agentEconomicsContext.textContent = groups.length
      ? `${filterContext} · ${formatNumber(totalRequests)} requests · ${formatCurrency(totalSpend)} modeled spend`
      : `No agent activity matches ${filterContext}.`;
    if (!groups.length) {
      renderAnalyticsEmpty(agentEconomicsTable, "No modeled agent activity matches these filters.");
      return;
    }
    const body = groups
      .map((row) => {
        const agent = agentMap.get(row.id) || { name: row.label, kind: "workload" };
        const kind = agent.kind === "resident-security" ? "Resident security" : "Workload";
        const teams = Array.from(row.teamIds).map((id) => analyticsDimensionLabel("team", id));
        const providers = Array.from(row.providerIds).map((id) => analyticsDimensionLabel("provider", id));
        const devices = Array.from(row.deviceIds).filter(Boolean);
        return `
          <tr>
            <th scope="row" data-label="Agent"><strong>${escapeHtml(agent.name || row.label)}</strong><small>${escapeHtml(row.id)} · ${escapeHtml(kind)}</small></th>
            <td data-label="Scope"><strong>${formatNumber(row.userIds.size)} ${row.userIds.size === 1 ? "person" : "people"} · ${formatNumber(devices.length)} ${devices.length === 1 ? "device" : "devices"}</strong><small>${escapeHtml(teams.join(", ") || "Unknown department")} · ${escapeHtml(devices.join(", ") || "No device")}</small></td>
            <td data-label="Execution"><div class="agent-route-list">${providers.map((provider) => `<span>${escapeHtml(provider)}</span>`).join("")}</div></td>
            <td data-label="Tasks">${formatNumber(row.tasks)}</td>
            <td data-label="Requests">${formatNumber(row.requests)}</td>
            <td data-label="Tokens"><strong>${formatCompactNumber(row.total_tokens)}</strong></td>
            <td data-label="Est. spend"><strong>${escapeHtml(formatCurrency(row.estimated_cost_usd))}</strong></td>
          </tr>
        `;
      })
      .join("");
    agentEconomicsTable.innerHTML = `
      <table class="agent-economics-table">
        <caption>Agent spend detail for ${escapeHtml(filterContext)}. Sorted by modeled spend, then token volume.</caption>
        <thead><tr><th scope="col">Agent</th><th scope="col">People / devices</th><th scope="col">Execution</th><th scope="col">Tasks</th><th scope="col">Requests</th><th scope="col">Tokens</th><th scope="col">Est. spend</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }

  function renderTokenomicsOpportunities() {
    const analytics = analyticsPayload();
    if (!analytics || !analytics.cost || !Array.isArray(analytics.cost.detail_rows)) {
      renderAnalyticsEmpty(tokenomicsOpportunityList, "Loading agent recommendation…");
      return;
    }
    const cloudRows = filteredAnalyticsRows().filter((row) => row.provider_id !== "amd-local");
    const highestCloudSpendAgent = aggregateAnalyticsRows(cloudRows, "agent")[0];
    if (!highestCloudSpendAgent) {
      renderAnalyticsEmpty(tokenomicsOpportunityList, "No agent cloud spend detected for these filters.");
      return;
    }
    const agentRows = filteredAnalyticsRows().filter((row) => row.agent_id === highestCloudSpendAgent.id);
    const agentTokens = agentRows.reduce((sum, row) => sum + Number(row.total_tokens || 0), 0);
    const localTokens = agentRows
      .filter((row) => row.provider_id === "amd-local")
      .reduce((sum, row) => sum + Number(row.total_tokens || 0), 0);
    const localExecutionPercent = agentTokens ? (localTokens / agentTokens) * 100 : 0;
    tokenomicsOpportunityList.innerHTML = `
      <article class="token-opportunity-row is-agent">
        <div class="token-opportunity-heading">
          <div><span>Heavy cloud spend</span><strong>${escapeHtml(highestCloudSpendAgent.label)}</strong></div>
          <b>${escapeHtml(formatCurrency(highestCloudSpendAgent.estimated_cost_usd))} / 7d</b>
        </div>
        <div class="token-opportunity-metrics">
          <span><strong>${escapeHtml(formatCurrency(highestCloudSpendAgent.estimated_cost_usd))}</strong> estimated cloud spend / 7d</span>
          <span><strong>${escapeHtml(formatCompactNumber(highestCloudSpendAgent.total_tokens))}</strong> cloud tokens / 7d</span>
          <span><strong>${escapeHtml(formatNumber(localExecutionPercent))}%</strong> local execution</span>
        </div>
        <p><strong>Recommendation:</strong> Move eligible ${escapeHtml(highestCloudSpendAgent.label)} workloads to local inferencing.</p>
      </article>
    `;
  }

  function renderCostTrend() {
    const analytics = analyticsPayload();
    const models = Array.isArray(analytics.dimensions.models) ? analytics.dimensions.models : [];
    const allDetailRows = analytics.cost.detail_rows || [];
    const filteredRows = filteredAnalyticsRows();
    const dailyProviderCost = analytics.cost.daily_provider_cost || [];
    if (!filteredRows.length) {
      costTrendChart.setAttribute("aria-label", `No modeled daily spend for ${tokenomicsFilterContext()}`);
      renderAnalyticsEmpty(costTrendChart, "No modeled cost rows match these filters.");
      return;
    }
    const dates = Array.from(new Set(dailyProviderCost.map((row) => row.date))).sort();
    const visibleModels = models.filter(
      (model) => state.analyticsModel === "all" || model.model_id === state.analyticsModel,
    );
    const series = visibleModels.map((model) => {
      const providerId = model.provider_id;
      const allProviderCost = allDetailRows
        .filter((row) => row.provider_id === providerId)
        .reduce((sum, row) => sum + Number(row.estimated_cost_usd || 0), 0);
      const filteredModelCost = filteredRows
        .filter((row) => row.model_id === model.model_id)
        .reduce((sum, row) => sum + Number(row.estimated_cost_usd || 0), 0);
      const scale = allProviderCost ? filteredModelCost / allProviderCost : 0;
      const providerCostByDate = new Map(
        dailyProviderCost
          .filter((row) => row.provider_id === providerId)
          .map((row) => [row.date, Number(row.estimated_cost_usd || 0)]),
      );
      return {
        id: model.model_id,
        name: model.name || model.model_id,
        color: analyticsModelColor(model.model_id),
        points: dates.map((date) => ({ date, value: Number(providerCostByDate.get(date) || 0) * scale })),
      };
    });
    const context = tokenomicsFilterContext();
    costTrendChart.setAttribute(
      "aria-label",
      context === "All managed agents"
        ? "Daily cloud spend allocated to models by modeled cost share"
        : `Daily cloud spend allocated to models for ${context}`,
    );
    renderLineChart(costTrendChart, series, (value) => formatCurrency(value));
  }

  function renderCostBreakdown() {
    costBreakdownControls.querySelectorAll("[data-cost-breakdown]").forEach((button) => {
      const active = button.dataset.costBreakdown === state.costBreakdownDimension;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const groups = aggregateAnalyticsRows(filteredAnalyticsRows(), state.costBreakdownDimension);
    if (!groups.length) {
      renderAnalyticsEmpty(costBreakdownBars, "No modeled cost rows match these filters.");
      return;
    }
    const metricKey = "estimated_cost_usd";
    const maximum = Math.max(1, ...groups.map((row) => Number(row[metricKey] || 0)));
    const rows = groups
      .slice(0, 8)
      .map((row) => {
        const value = Number(row[metricKey] || 0);
        const percent = (value / maximum) * 100;
        const display = formatCurrency(value);
        return `<div class="cost-bar-row"><span title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span><div class="cost-bar-track"><div class="cost-bar-fill" style="width:${Math.max(percent, value ? 1 : 0)}%"></div></div><strong>${escapeHtml(display)}</strong></div>`;
      })
      .join("");
    const note = "No billed local model fee · hardware/TCO excluded.";
    costBreakdownBars.innerHTML = `${rows}<p class="analytics-note">${escapeHtml(note)}</p>`;
  }

  function usageSecondaryLabel(row, dimension) {
    if (dimension === "provider") {
      return Array.from(row.modelIds).map((id) => analyticsDimensionLabel("model", id)).join(", ");
    }
    if (dimension === "team") {
      return Array.from(row.providerIds).map((id) => analyticsDimensionLabel("provider", id)).join(", ");
    }
    if (dimension === "user") {
      return Array.from(row.teamIds).map((id) => analyticsDimensionLabel("team", id)).join(", ");
    }
    if (dimension === "agent") {
      return Array.from(row.providerIds).map((id) => analyticsDimensionLabel("provider", id)).join(", ");
    }
    return Array.from(row.providerIds).map((id) => analyticsDimensionLabel("provider", id)).join(", ");
  }

  function renderUsageDetail() {
    const dimension = state.usageDetailDimension;
    usageDetailDimensions.querySelectorAll("[data-usage-dimension]").forEach((button) => {
      const active = button.dataset.usageDimension === dimension;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const search = state.usageDetailSearch.trim().toLowerCase();
    const aggregated = aggregateAnalyticsRows(filteredAnalyticsRows(), dimension)
      .map((row) => ({ ...row, secondary: usageSecondaryLabel(row, dimension) }))
      .filter((row) => !search || `${row.label} ${row.secondary}`.toLowerCase().includes(search));
    const pageSize = 7;
    const pageCount = Math.max(1, Math.ceil(aggregated.length / pageSize));
    state.usageDetailPage = Math.min(Math.max(state.usageDetailPage, 1), pageCount);
    const start = (state.usageDetailPage - 1) * pageSize;
    const rows = aggregated.slice(start, start + pageSize);
    const labels = { model: "Model", user: "User", team: "Department", provider: "Provider", agent: "Agent" };
    const secondaryLabels = {
      model: "Provider",
      user: "Department",
      team: "Providers",
      provider: "Models",
      agent: "Providers",
    };
    if (!rows.length) {
      renderAnalyticsEmpty(usageDetailTable, "No modeled usage rows match this search and filter selection.");
    } else {
      const body = rows
        .map(
          (row) => `<tr><td><strong>${escapeHtml(row.label)}</strong></td><td>${escapeHtml(row.secondary || "—")}</td><td>${formatNumber(row.tasks)}</td><td>${formatNumber(row.requests)}</td><td>${formatCompactNumber(row.total_tokens)}</td><td>${escapeHtml(row.estimated_cost_usd ? formatCurrency(row.estimated_cost_usd) : "$0.00*")}</td></tr>`,
        )
        .join("");
      usageDetailTable.innerHTML = `<table class="usage-detail-table"><thead><tr><th scope="col">${escapeHtml(labels[dimension])}</th><th scope="col">${escapeHtml(secondaryLabels[dimension])}</th><th scope="col">Tasks</th><th scope="col">Requests</th><th scope="col">Tokens</th><th scope="col">Cost</th></tr></thead><tbody>${body}</tbody></table><p class="analytics-note">* No billed local model fee · hardware/TCO excluded.</p>`;
    }
    usagePagePrev.disabled = state.usageDetailPage <= 1;
    usagePageNext.disabled = state.usageDetailPage >= pageCount;
    usagePageState.textContent = aggregated.length
      ? `${state.usageDetailPage} / ${pageCount} · ${formatNumber(aggregated.length)} rows`
      : "No matching rows";
  }

  function renderTokenomicsAnalytics() {
    const analytics = analyticsPayload();
    if (!analytics) {
      tokenomicsAnalyticsSource.textContent = state.analyticsError ? "Analytics unavailable" : "Loading analytics";
      tokenomicsAnalyticsUpdated.textContent = state.analyticsError || "Waiting for the modeled fleet scenario";
      [
        adoptionProviderSummary,
        adoptionTrendChart,
        adoptionTeamMatrix,
        adoptionUtilizationDonut,
        adoptionJobDonut,
        costSummaryGrid,
        agentEconomicsTable,
        tokenomicsOpportunityList,
        costTrendChart,
        costBreakdownBars,
        usageDetailTable,
      ].forEach((target) => renderAnalyticsEmpty(target, state.analyticsError || "Loading modeled fleet analytics…"));
      return;
    }
    populateAnalyticsFilters();
    const projection = organizationProjection();
    const costRows = filteredAnalyticsRows();
    const adoptionFilters = tokenomicsFilterLabels({ includeAgent: false });
    if (state.activeTokenomicsTab === "adoption") {
      tokenomicsAnalyticsSource.textContent = "Synthetic managed-fleet view";
      tokenomicsAnalyticsUpdated.textContent = `${projection.basisWindowDays}-day managed fleet scenario${
        adoptionFilters.length ? ` · ${adoptionFilters.join(" · ")}` : ""
      }`;
    } else {
      tokenomicsAnalyticsSource.textContent = "Synthetic organization view";
      tokenomicsAnalyticsUpdated.textContent = organizationOverlayEnabled()
        ? `${projection.basisWindowDays}-day scenario · managed Halo + ${projection.developers} modeled non-Halo developers`
        : `${projection.basisWindowDays}-day scenario · ${tokenomicsFilterContext()} · ${formatNumber(costRows.length)} usage rows`;
    }
    renderAdoptionSummary();
    renderAdoptionTrend();
    renderAdoptionMatrix();
    renderAdoptionDonuts();
    renderCostSummary();
    renderAgentEconomics();
    renderTokenomicsOpportunities();
    renderCostTrend();
    renderCostBreakdown();
    renderUsageDetail();
  }

  function infrastructureSeriesPoints(name) {
    const payload = infrastructurePayload();
    const seriesRoot = payload && payload.series;
    let raw = [];
    if (Array.isArray(seriesRoot)) {
      const match = seriesRoot.find((row) => row && (row.metric === name || row.name === name || row.id === name));
      raw = match && Array.isArray(match.points) ? match.points : [];
    } else if (seriesRoot && typeof seriesRoot === "object") {
      const entry = seriesRoot[name];
      raw = Array.isArray(entry) ? entry : entry && Array.isArray(entry.points) ? entry.points : [];
    }
    const normalized = raw
      .map((point) => {
        const timestamp = point && (point.timestamp || point.date || point.time);
        const value = point && point.value !== undefined ? Number(point.value) : NaN;
        if (!timestamp || !Number.isFinite(value)) return null;
        const parsed = new Date(timestamp);
        const date = Number.isNaN(parsed.getTime())
          ? String(timestamp)
          : parsed.toISOString().slice(11, 16);
        return { date, value };
      })
      .filter(Boolean);
    if (normalized.length <= 8) return normalized;
    const stride = Math.max(1, Math.ceil((normalized.length - 1) / 7));
    return normalized.filter((_, index) => index % stride === 0 || index === normalized.length - 1);
  }

  function renderInfrastructure() {
    const payload = infrastructurePayload();
    if (!payload) {
      const message = state.infrastructureError || "Loading Splunk Observability infrastructure telemetry…";
      infrastructureLiveStatus.innerHTML = '<span aria-hidden="true"></span>Telemetry unavailable';
      infrastructureReportingState.textContent = "Telemetry unavailable";
      infrastructureSourceState.textContent = "Waiting for BFF";
      infrastructureDisclosure.querySelector("span").textContent = "Loading";
      infrastructureDisclosure.querySelector("p").textContent = message;
      [infrastructureSummaryGrid, infrastructureUtilizationChart, infrastructureEfficiencyList, infrastructureDeviceTable]
        .forEach((target) => renderAnalyticsEmpty(target, message));
      return;
    }

    const summary = infrastructureSummary();
    const disclosure = payload.disclosure && typeof payload.disclosure === "object" ? payload.disclosure : {};
    infrastructureReportingState.textContent = `${formatNumber(summary.reportingDevices)} of ${formatNumber(summary.totalDevices)} reporting · ${formatNumber(summary.staleDevices)} stale/offline`;
    infrastructureLiveStatus.innerHTML = `<span aria-hidden="true"></span>${escapeHtml(formatNumber(summary.reportingDevices))} of ${escapeHtml(formatNumber(summary.totalDevices))} reporting · synthetic`;
    infrastructureSourceState.textContent = "Synthetic Splunk O11y query result";
    infrastructureDisclosure.querySelector("span").textContent = disclosure.label || "Synthetic";
    infrastructureDisclosure.querySelector("p").textContent = disclosure.message || "Production-shaped infrastructure metrics modeled after Splunk Observability host and custom AMD signals.";

    const cards = [
      { label: "CPU utilization", value: formatInfrastructureValue(summary.cpu, "%", 0), detail: "5-minute mean · reporting devices" },
      { label: "Memory utilization", value: formatInfrastructureValue(summary.memory, "%", 0), detail: "5-minute mean · reporting devices" },
      { label: "GPU utilization", value: formatInfrastructureValue(summary.gpu, "%", 0), detail: "AMD SMI-shaped · reporting devices" },
      { label: "Network throughput", value: `↓ ${formatInfrastructureValue(summary.networkReceive, " Mbps", 1)}`, detail: `↑ ${formatInfrastructureValue(summary.networkTransmit, " Mbps", 1)} · ${formatInfrastructureValue(summary.linkUtilization, "%", 1)} link` },
      { label: "Energy consumption", value: formatInfrastructureValue(summary.energy7d, " kWh", 1), detail: `${formatInfrastructureValue(summary.energy24h, " kWh", 2)} / 24h · ${formatInfrastructureValue(summary.power, " W", 0)} now` },
    ];
    infrastructureSummaryGrid.innerHTML = cards
      .map((card) => `<article class="summary-card"><div class="label">${escapeHtml(card.label)}</div><div class="value">${escapeHtml(card.value)}</div><div class="detail">${escapeHtml(card.detail)}</div></article>`)
      .join("");

    const trendSeries = [
      { name: "CPU", color: "#4e8cff", points: infrastructureSeriesPoints("cpu_utilization") },
      { name: "Memory", color: "#9a7bff", points: infrastructureSeriesPoints("memory_utilization") },
      { name: "GPU", color: "#36d39a", points: infrastructureSeriesPoints("gpu_utilization") },
    ].filter((row) => row.points.length);
    renderLineChart(infrastructureUtilizationChart, trendSeries, (value) => `${formatNumber(value)}%`);

    const inventory = fleetPayload();
    const inventoryById = new Map(((inventory && inventory.devices) || []).map((device) => [device.device_id, device]));
    const efficiencyRows = infrastructureDevices()
      .map((device) => {
        const energy = infrastructureMetricValue(device, "energy_7d");
        const tokens = Number((device.context && device.context.tokens_7d) || 0);
        return {
          device,
          energy,
          tokens,
          tokensPerKwh: energy && tokens ? tokens / energy : null,
          inventory: inventoryById.get(device.device_id) || {},
        };
      })
      .sort((left, right) => Number(right.tokensPerKwh || -1) - Number(left.tokensPerKwh || -1));
    infrastructureEfficiencyList.innerHTML = efficiencyRows.length
      ? efficiencyRows.map((row) => `<div class="infrastructure-efficiency-row">
          <div><strong>${escapeHtml(row.device.device_id)} · ${escapeHtml(row.inventory.site || row.device.site || "Unknown site")}</strong><small>${escapeHtml(infrastructureFreshnessLabel(row.device))}</small></div>
          <div><span>${escapeHtml(row.tokensPerKwh === null ? "—" : `${formatCompactNumber(row.tokensPerKwh)} tokens/kWh`)}</span><small>${escapeHtml(formatCompactNumber(row.tokens))} tokens / 7d</small></div>
          <div><span>${escapeHtml(formatInfrastructureValue(row.energy, " kWh", 1))}</span><small>7-day energy</small></div>
        </div>`).join("")
      : '<div class="empty-state">No energy efficiency data is available.</div>';
    renderFleetInfrastructureTable((inventory && inventory.devices) || [], infrastructureDeviceTable);
  }

  function fleetPayload() {
    return state.fleet && typeof state.fleet === "object" ? state.fleet : null;
  }

  function renderFleetSummary() {
    const payload = fleetPayload();
    const fleet = payload && payload.fleet ? payload.fleet : null;
    const behavior = payload && payload.behavior ? payload.behavior : null;
    const cost = state.analytics && state.analytics.cost ? state.analytics.cost.summary : null;
    const projection = organizationProjection();
    const hasOrganizationProjection = projection.status === "illustrative";
    const organizationTokens = cost
      ? Number(cost.total_tokens || 0) + (hasOrganizationProjection ? projection.cloudTokens : 0)
      : null;
    const organizationSpend = cost
      ? Number(cost.estimated_cloud_cost_usd || 0) +
        Number(cost.billed_local_model_cost_usd || 0) +
        (hasOrganizationProjection ? projection.estimatedCloudCostUsd : 0)
      : null;
    const knownAgents = fleet
      ? Number(fleet.active_workload_agents || 0) + Number(fleet.resident_defenseclaw_agents || 0)
      : 0;
    const pillars = [
      {
        className: "security",
        index: "01",
        title: "Network Security",
        value: fleet ? formatNumber(knownAgents) : "—",
        unit: "known identities",
        detail: fleet
          ? `${formatNumber(fleet.protected_devices)} / ${formatNumber(fleet.total_devices)} protected · ${formatNumber(fleet.quarantined_devices)} isolated`
          : "Loading",
        tags: ["Discover", "Protect", "Contain"],
        href: "/network-security",
        action: "View security",
        badge: "Demo",
      },
      {
        className: "behavior",
        index: "02",
        title: "Agent Behavior",
        value: behavior ? `${formatNumber(behavior.outcomes_met_percent)}%` : "—",
        unit: "outcomes met",
        detail: behavior
          ? `${formatNumber(fleet.tasks_today)} tasks · ${formatNumber(behavior.exception_tasks)} exceptions`
          : "Loading",
        tags: ["Observe", "Validate", "Improve"],
        href: "/agent-behavior",
        action: "View behavior",
        badge: "Demo",
      },
      {
        className: "tokenomics",
        index: "03",
        title: "Tokenomics",
        value: organizationTokens === null ? "—" : formatCompactNumber(organizationTokens),
        unit: "organization tokens",
        secondaryValue: organizationSpend === null ? "—" : formatCompactCurrency(organizationSpend),
        secondaryUnit: "estimated spend · 7d",
        detail: fleet
          ? hasOrganizationProjection
            ? `${formatNumber(fleet.total_devices)} Halo devices + ${formatNumber(projection.developers)} modeled non-Halo developers`
            : `${formatNumber(fleet.total_devices)} Halo devices · managed usage only`
          : "Loading",
        tags: ["Route", "Optimize", "Cap exposure"],
        href: "/budgets",
        action: "View tokenomics",
        badge: hasOrganizationProjection ? "Synthetic org · 7d" : "Managed fleet · 7d",
      },
    ];
    fleetSummaryGrid.innerHTML = pillars
      .map(
        (pillar) => `
          <article class="customer-pillar-card pillar-${escapeHtml(pillar.className)}">
            <div class="pillar-card-head"><span>${escapeHtml(pillar.index)}</span><b>${escapeHtml(pillar.badge)}</b></div>
            <h3>${escapeHtml(pillar.title)}</h3>
            <div class="pillar-primary"><strong>${escapeHtml(pillar.value)}</strong><span>${escapeHtml(pillar.unit)}</span></div>
            ${pillar.secondaryValue
              ? `<div class="pillar-secondary"><strong>${escapeHtml(pillar.secondaryValue)}</strong><span>${escapeHtml(pillar.secondaryUnit)}</span></div>`
              : ""}
            <p>${escapeHtml(pillar.detail)}</p>
            <div class="pillar-tags">${pillar.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
            <a href="${escapeHtml(pillar.href)}">${escapeHtml(pillar.action)} <span aria-hidden="true">→</span></a>
          </article>
        `,
      )
      .join("");
  }

  function renderBehavior() {
    const payload = fleetPayload();
    const fleet = payload && payload.fleet ? payload.fleet : null;
    const behavior = payload && payload.behavior ? payload.behavior : null;
    if (!fleet || !behavior) {
      behaviorSummaryGrid.innerHTML = '<div class="empty-state">Agent outcomes are unavailable.</div>';
      behaviorOutcomeList.innerHTML = '<div class="empty-state">Outcome groups are unavailable.</div>';
      behaviorAttentionList.innerHTML = '<div class="empty-state">Attention signals are unavailable.</div>';
      behaviorAgentTable.innerHTML = '<div class="empty-state">Agent outcomes are unavailable.</div>';
      return;
    }

    const cards = [
      { label: "Outcomes met", value: `${formatNumber(behavior.outcomes_met_percent)}%`, detail: `${formatNumber(behavior.outcomes_met_tasks)} tasks` },
      { label: "Tasks", value: formatNumber(fleet.tasks_today), detail: "Today" },
      { label: "Exceptions", value: formatNumber(behavior.exception_tasks), detail: "Needs review" },
      { label: "Active agents", value: formatNumber(fleet.active_workload_agents), detail: `${formatNumber(behavior.objective_drift_agents)} drifting` },
    ];
    behaviorSummaryGrid.innerHTML = cards
      .map(
        (card) => `
          <article class="summary-card">
            <div class="label">${escapeHtml(card.label)}</div>
            <div class="value">${escapeHtml(card.value)}</div>
            <div class="detail">${escapeHtml(card.detail)}</div>
          </article>
        `,
      )
      .join("");

    const outcomes = Array.isArray(behavior.outcomes) ? behavior.outcomes : [];
    behaviorOutcomeList.innerHTML = outcomes
      .map((outcome) => {
        const alignment = Math.min(Math.max(Number(outcome.alignment_percent || 0), 0), 100);
        return `
          <div class="behavior-outcome-row">
            <div><strong>${escapeHtml(outcome.name)}</strong><span>${escapeHtml(formatNumber(outcome.tasks))} tasks · ${escapeHtml(formatNumber(outcome.exceptions))} exceptions</span></div>
            <div class="behavior-outcome-meter" role="meter" aria-label="${escapeHtml(outcome.name)} outcomes met" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${alignment}"><span style="width:${alignment}%"></span></div>
            <b>${escapeHtml(formatNumber(alignment))}%</b>
          </div>
        `;
      })
      .join("");

    const attention = Array.isArray(behavior.attention) ? behavior.attention : [];
    behaviorAttentionCount.textContent = `${formatNumber(attention.length)} agents`;
    behaviorAttentionList.innerHTML = attention
      .map((row) => {
        const stateClass = String(row.state || "review").toLowerCase().replace(/[^a-z0-9]+/g, "-");
        return `
          <div class="behavior-attention-row">
            <div><strong>${escapeHtml(row.agent)}</strong><span>${escapeHtml(row.device_id)} · ${escapeHtml(row.signal)}</span></div>
            <b class="behavior-state is-${escapeHtml(stateClass)}">${escapeHtml(row.state)}</b>
          </div>
        `;
      })
      .join("");

    const agents = Array.isArray(behavior.agents) ? behavior.agents : [];
    behaviorAgentTable.innerHTML = `
      <table class="behavior-table">
        <thead><tr><th>Agent</th><th>Owner</th><th>Tasks</th><th>Outcome</th><th>Status</th></tr></thead>
        <tbody>
          ${agents
            .map((agent) => {
              const status = String(agent.status || "review");
              const label = status === "on_track" ? "On track" : status === "blocked" ? "Blocked" : "Review";
              return `
                <tr>
                  <td><strong>${escapeHtml(agent.name)}</strong><small>${escapeHtml(agent.device_id)}</small></td>
                  <td>${escapeHtml(agent.owner)}</td>
                  <td>${escapeHtml(formatNumber(agent.tasks))}</td>
                  <td><strong>${escapeHtml(agent.expected_outcome)}</strong><small>${escapeHtml(formatNumber(agent.alignment_percent))}% aligned</small></td>
                  <td><span class="behavior-state is-${escapeHtml(status.replace(/_/g, "-"))}">${escapeHtml(label)}</span></td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderProviderUsage() {
    const payload = fleetPayload();
    const providers = payload && Array.isArray(payload.model_routes) ? payload.model_routes : [];
    if (!providers.length) {
      providerUsage.innerHTML = '<div class="empty-state">Fleet model routing is unavailable.</div>';
      return;
    }
    providerUsage.innerHTML = providers
      .map((provider) => {
        const share = Math.min(Math.max(Number(provider.share_percent || 0), 0), 100);
        const spend = provider.kind === "local" ? "On-device" : formatCurrency(provider.estimated_spend_usd || 0);
        return `
          <div class="provider-row ${provider.kind === "local" ? "is-local" : ""}">
            <div class="provider-identity">
              <strong>${escapeHtml(provider.name)}</strong>
              <span>${escapeHtml(provider.policy || provider.provider)}</span>
            </div>
            <div class="provider-meter" role="meter" aria-label="${escapeHtml(provider.name)} task share" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${share}">
              <span style="width:${share}%"></span>
            </div>
            <div class="provider-metric"><strong>${escapeHtml(formatNumber(provider.task_count))} tasks · ${share}%</strong>${escapeHtml(spend)}</div>
          </div>
        `;
      })
      .join("");
  }

  function renderFleetPosture() {
    const payload = fleetPayload();
    const fleet = payload && payload.fleet ? payload.fleet : null;
    const devices = payload && Array.isArray(payload.devices) ? payload.devices : [];
    const policy = payload && payload.security_policy ? payload.security_policy : null;
    const atRisk = devices.filter((row) => row.risk === "critical" && !row.quarantined).length;
    const review = devices.filter((row) => row.risk === "review").length;
    fleetSecurityPosture.innerHTML = `
      <div class="posture-stat"><span>Protected</span><strong>${fleet ? escapeHtml(formatNumber(fleet.protected_devices)) : "—"}</strong></div>
      <div class="posture-stat is-warn"><span>Needs review</span><strong>${escapeHtml(formatNumber(review))}</strong></div>
      <div class="posture-stat is-danger"><span>Critical / isolated</span><strong>${escapeHtml(formatNumber(atRisk + (fleet ? Number(fleet.quarantined_devices || 0) : 0)))}</strong></div>
    `;
    const armed = Boolean(policy && policy.auto_quarantine);
    fleetIsolationState.textContent = armed ? "Armed" : "Monitor";
    fleetIsolationState.classList.toggle("is-on", armed);
  }

  function deviceRiskLabel(device) {
    if (device.quarantined) return "Isolated";
    if (device.status === "offline") return "Offline";
    if (device.risk === "critical") return "Critical";
    if (device.risk === "review") return "Review";
    return "Healthy";
  }

  function topologyDeviceState(device) {
    if (device.quarantined) return "quarantined";
    if (device.status === "offline") return "offline";
    if (device.risk === "critical") return "critical";
    if (device.risk === "review") return "review";
    return "healthy";
  }

  function topologyAccessState(device) {
    const access = String(device.network_access || "").toLowerCase();
    if (device.quarantined || access.includes("remediation")) return "remediation-only";
    if (device.status === "offline" || access.includes("disconnect")) return "disconnected";
    return "full";
  }

  function topologyDevicePriority(device) {
    const priorities = { quarantined: 5, critical: 4, review: 3, offline: 2, healthy: 1 };
    return priorities[topologyDeviceState(device)] || 0;
  }

  function topologyIntegration(integrations, id) {
    const integration = integrations.find((row) => row.id === id);
    if (!integration) return { label: "Unavailable", state: "unavailable" };
    const status = String(integration.status || "").trim().toLowerCase();
    if (status === "connected") return { label: "Connected", state: "connected" };
    if (status === "demo-ready") return { label: "Demo ready", state: "demo" };
    if (status === "degraded") return { label: "Degraded", state: "degraded" };
    if (["unavailable", "offline", "disconnected", "failed", "error"].includes(status)) {
      return { label: "Unavailable", state: "unavailable" };
    }
    return { label: "Unknown", state: "unknown" };
  }

  function topologyIntegrationStatus(integration) {
    const compact = integration.state === "connected" || integration.state === "demo";
    return `<span class="topology-node-status${compact ? " is-compact" : ""}" role="img" aria-label="${escapeHtml(integration.label)}" title="${escapeHtml(integration.label)}"><i aria-hidden="true"></i>${compact ? "" : escapeHtml(integration.label)}</span>`;
  }

  function topologyCapabilityLabel(value, fallback) {
    if (value && typeof value === "object" && !Array.isArray(value) && value.label) {
      return String(value.label);
    }
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  function topologyProfile(payload) {
    const source = payload && payload.network_topology && typeof payload.network_topology === "object"
      ? payload.network_topology
      : {};
    const core = source.core && typeof source.core === "object" ? source.core : {};
    const access = source.access && typeof source.access === "object" ? source.access : {};
    const coreCapabilities = core.capabilities && typeof core.capabilities === "object" ? core.capabilities : {};
    const accessCapabilities = access.capabilities && typeof access.capabilities === "object" ? access.capabilities : {};
    return {
      architecture: String(source.architecture || "reference-campus"),
      core: {
        displayName: String(core.display_name || "Cisco C9550"),
        officialModel: String(core.official_model || "Cisco C9550 Series Smart Switches"),
        role: String(core.role || "Core + aggregation"),
        deployment: String(core.deployment || "Logical core pair"),
        message: String(core.message || "Campus backbone for agentic AI"),
        switchingCapacity: topologyCapabilityLabel(coreCapabilities.switching_capacity, "Up to 6.4 Tbps"),
        uplinkSpeed: topologyCapabilityLabel(coreCapabilities.uplink_speed, "Up to 400G"),
      },
      access: {
        displayName: String(access.display_name || "Cisco C9350"),
        officialModel: String(access.official_model || "Cisco C9350 Series Smart Switches"),
        role: String(access.role || "Fixed campus access"),
        uplinkSpeed: topologyCapabilityLabel(accessCapabilities.uplink_speed, "Up to 100G"),
      },
    };
  }

  function topologyEnforcementEvidence(payload, devices) {
    const policy = payload && payload.security_policy && typeof payload.security_policy === "object"
      ? payload.security_policy
      : {};
    const events = payload && Array.isArray(payload.enforcement_events)
      ? payload.enforcement_events
      : [];
    const policyName = String(policy.policy_name || "AMD-DESKSIDE-QUARANTINE");
    const eventTime = (event) => {
      const parsed = Date.parse(event && event.occurred_at ? event.occurred_at : "");
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const candidates = devices
      .filter((device) => {
        const access = String(device.network_access || "").toLowerCase();
        const policyMatches = !device.ise_policy || device.ise_policy === policyName;
        return Boolean(device.quarantined) && access.includes("remediation") && policyMatches;
      })
      .map((device) => {
        const deviceEvents = events
          .filter((event) => event.device_id === device.device_id && String(event.status || "").toLowerCase() === "complete")
          .sort((left, right) => eventTime(left) - eventTime(right));
        const newest = (predicate) => [...deviceEvents].reverse().find(predicate) || null;
        const enforceEvent = newest((event) =>
          event.stage === "enforce"
          && event.action !== "restore"
          && !/restor/i.test(String(event.title || "")),
        );
        return {
          coaEvent: newest((event) => event.stage === "coa" && event.action !== "restore"),
          decisionEvent: newest((event) =>
            (event.stage === "cloud-control" && event.action !== "restore") || event.stage === "detect",
          ),
          device,
          enforceEvent,
          iseEvent: newest((event) => event.stage === "ise" && event.action !== "restore"),
          occurredAt: enforceEvent ? enforceEvent.occurred_at : "",
        };
      })
      .sort((left, right) => eventTime(right.enforceEvent) - eventTime(left.enforceEvent));
    const confirmed = candidates.find((candidate) => candidate.enforceEvent) || null;
    const active = confirmed || candidates[0] || null;
    const simulated = Boolean(
      (payload && payload.demo && payload.demo.network_actions_are_simulated)
      || policy.simulated
      || (active && [active.decisionEvent, active.iseEvent, active.coaEvent, active.enforceEvent].some((event) => event && event.simulated)),
    );
    return {
      active,
      policy,
      policyId: String(policy.policy_id || "amd-deskside-critical-quarantine"),
      policyName,
      simulated,
      state: confirmed ? "enforced" : active ? "pending" : policy.auto_quarantine ? "armed" : "monitoring",
      statusLabel: confirmed ? "Enforced" : active ? "Evidence pending" : policy.auto_quarantine ? "Armed" : "Monitoring",
    };
  }

  function topologyIcon(name) {
    const paths = {
      shield: '<path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
      identity: '<circle cx="12" cy="8" r="3"/><path d="M6.5 19c.8-3 2.6-4.5 5.5-4.5s4.7 1.5 5.5 4.5"/><path d="M18.5 6.5h2v3h-2"/>',
      fabric: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h1m3 0h1m3 0h1M7 15h10M9 19v2m6-2v2"/>',
      core: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h2m2 0h2m2 0h2M7 17.5h2m2 0h2m2 0h2"/>',
      switch: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h2m2 0h2m2 0h2M7 14h10"/>',
      endpoint: '<rect x="5" y="4" width="14" height="11" rx="2"/><path d="M3 19h18l-2-4H5l-2 4Z"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || paths.fabric}</svg>`;
  }

  function renderNetworkTopology(payload) {
    const integrations = payload && Array.isArray(payload.integrations) ? payload.integrations : [];
    const devices = payload && Array.isArray(payload.devices) ? payload.devices : [];
    const profile = topologyProfile(payload);
    const defenseclaw = topologyIntegration(integrations, "defenseclaw");
    const ise = topologyIntegration(integrations, "ise");
    const orderedDevices = [
      ...devices.filter((device) => device.status !== "offline"),
      ...devices.filter((device) => device.status === "offline"),
    ];
    const representativeDevices = orderedDevices.slice(0, 4);
    while (representativeDevices.length < 4) {
      representativeDevices.push({
        device_id: `reference-deskside-${representativeDevices.length + 1}`,
        network_access: "Reference endpoint",
        quarantined: false,
        risk: "healthy",
        status: "reference",
        switch_name: "Reference C9350 access",
        switch_port: "Representative port",
      });
    }
    const accessBranches = [
      { id: "reference-c9350-a", label: "A", devices: representativeDevices.slice(0, 2) },
      { id: "reference-c9350-b", label: "B", devices: representativeDevices.slice(2, 4) },
    ];
    const evidence = topologyEnforcementEvidence(payload, representativeDevices);
    const activeEvidence = evidence.active;
    const enforcedDeviceId = evidence.state === "enforced" && activeEvidence
      ? activeEvidence.device.device_id
      : "";
    const evidenceDevice = activeEvidence ? activeEvidence.device : null;
    const evidencePort = evidenceDevice && evidenceDevice.switch_port ? evidenceDevice.switch_port : "No active port";
    const evidenceResult = evidenceDevice && evidenceDevice.network_access
      ? evidenceDevice.network_access
      : "No active isolation";
    const policyVersion = Number(evidence.policy.version || 1);
    const desiredMode = evidence.policy.auto_quarantine
      ? "Armed for critical events"
      : activeEvidence ? "Monitor · restriction retained" : "Monitor only";
    const evidenceSteps = [
      {
        detail: activeEvidence && activeEvidence.decisionEvent ? "Critical breach decision complete" : "Awaiting critical trigger",
        event: activeEvidence && activeEvidence.decisionEvent,
        integration: defenseclaw,
        role: "Policy decision",
        system: "DefenseClaw",
        tier: "defenseclaw",
      },
      {
        detail: activeEvidence && activeEvidence.iseEvent
          ? `${String(evidence.policy.ise_action || "QUARANTINE")} policy assigned`
          : "Awaiting ANC assignment",
        event: activeEvidence && activeEvidence.iseEvent,
        integration: ise,
        role: "Identity policy",
        system: "Cisco ISE",
        tier: "identity",
      },
      {
        detail: activeEvidence && activeEvidence.coaEvent ? "Access port reauthorized" : "Awaiting port reauthorization",
        event: activeEvidence && activeEvidence.coaEvent,
        role: "Network authorization",
        system: "RADIUS CoA",
      },
      {
        detail: activeEvidence && activeEvidence.enforceEvent ? `${evidencePort} restricted` : "Awaiting access change",
        event: activeEvidence && activeEvidence.enforceEvent,
        role: "Access enforcement",
        system: "Cisco C9350",
      },
    ].map((step, index) => {
      const complete = evidence.state === "enforced" && Boolean(step.event);
      const integrationAttributes = step.integration
        ? ` data-topology-tier="${escapeHtml(step.tier)}" data-integration-state="${escapeHtml(step.integration.state)}"`
        : "";
      const status = step.integration
        ? topologyIntegrationStatus(step.integration)
        : `<span class="topology-evidence-check" role="img" aria-label="${complete ? "Complete" : "Pending"}">${complete ? "✓" : "—"}</span>`;
      return `
        <li class="topology-policy-step${complete ? " is-complete" : ""}" data-evidence-stage="${escapeHtml(step.role.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}"${integrationAttributes}>
          <span class="topology-policy-step-index" aria-hidden="true">0${index + 1}</span>
          <div><small>${escapeHtml(step.role)}</small><strong>${escapeHtml(step.system)}</strong><span>${escapeHtml(step.detail)}</span></div>
          ${status}
        </li>
      `;
    }).join("");

    const summarySignature = `${profile.core.displayName}:2:4`;
    if (networkTopologySummary.dataset.signature !== summarySignature) {
      networkTopologySummary.dataset.signature = summarySignature;
      networkTopologySummary.innerHTML = `
        <span><strong>1</strong> Cisco 9550 aggregation</span>
        <span><strong>2</strong> Cisco 9350 access</span>
        <span><strong>4</strong> Ryzen AI Halo desksides</span>
        <span>Reference pattern</span>
      `;
    }

    const endpointBranches = accessBranches.map((branch, branchIndex) => {
      const endpointNodes = branch.devices.map((device, endpointIndex) => {
        const stateName = topologyDeviceState(device);
        const accessState = topologyAccessState(device);
        const policyEnforced = device.device_id === enforcedDeviceId;
        const devicePort = device.switch_port || "Port unavailable";
        const deviceSite = device.site || "Reference site";
        return `
          <article
            class="topology-product-node topology-pdf-endpoint${policyEnforced ? " is-policy-enforced" : ""}"
            data-topology-device-id="${escapeHtml(device.device_id)}"
            data-topology-state="${escapeHtml(stateName)}"
            data-switch-name="${escapeHtml(device.switch_name || "Reference C9350 access")}"
            data-switch-port="${escapeHtml(devicePort)}"
            data-access-state="${escapeHtml(accessState)}"
            data-policy-enforced="${policyEnforced ? "true" : "false"}"
            aria-label="Deskside AI, AMD Ryzen AI Halo, ${escapeHtml(device.device_id)}, ${escapeHtml(deviceSite)}, access port ${escapeHtml(devicePort)}, ${escapeHtml(device.network_access || "access unavailable")}"
          >
            ${policyEnforced ? '<span class="topology-policy-marker"><i aria-hidden="true"></i>Policy enforced</span>' : ""}
            <img src="/shell/assets/amd-ryzen-ai-halo.png" alt="" />
            <div><span>Deskside AI</span><strong>AMD Ryzen AI Halo</strong></div>
            <div class="topology-endpoint-port">
              <span>${escapeHtml(device.device_id)} · ${escapeHtml(deviceSite)}</span>
              <code>Access port ${escapeHtml(devicePort)}</code>
              <b class="is-${escapeHtml(accessState)}">${escapeHtml(device.network_access || "Access unavailable")}</b>
            </div>
          </article>
        `;
      }).join("");
      return `
        <section
          class="topology-pdf-access-branch"
          data-topology-switch="${escapeHtml(branch.id)}"
          data-topology-model="Cisco 9350"
          aria-label="Reference access ${escapeHtml(branch.label)}, smart access switch Cisco 9350 with two representative AMD Ryzen AI Halo desksides"
        >
          <article class="topology-product-node topology-pdf-access">
            <img src="/shell/assets/cisco-c9350.png" alt="" />
            <div><span>Smart access switch</span><strong>Cisco 9350</strong></div>
            <div class="topology-access-reference"><span>Reference access ${escapeHtml(branch.label)}</span><code>${escapeHtml(profile.access.uplinkSpeed)} uplink</code></div>
          </article>
          <div class="topology-pdf-endpoints">${endpointNodes}</div>
        </section>
      `;
    }).join("");

    networkTopology.innerHTML = `
      <section
        id="network-policy-enforcement"
        class="topology-control-overlay topology-policy-enforcement is-${escapeHtml(evidence.state)}"
        data-enforcement-state="${escapeHtml(evidence.state)}"
        data-device-id="${escapeHtml(evidenceDevice ? evidenceDevice.device_id : "")}"
        aria-labelledby="network-policy-enforcement-title"
      >
        <header class="topology-policy-header">
          <div class="topology-policy-identity">
            <span class="topology-kicker">Network policy enforcement</span>
            <strong id="network-policy-enforcement-title">${escapeHtml(evidence.policyName)}</strong>
            <small>Cisco Cloud Control · ${escapeHtml(evidence.policyId)} · v${escapeHtml(policyVersion)}</small>
          </div>
          <div class="topology-policy-state-group">
            <span class="topology-policy-state is-${escapeHtml(evidence.state)}"><i aria-hidden="true"></i>${escapeHtml(evidence.statusLabel)}</span>
            <span class="topology-evidence-mode">${evidence.simulated ? "Simulated evidence" : "Observed evidence"}</span>
          </div>
        </header>
        <div class="topology-policy-facts">
          <div><span>Automation</span><strong>${escapeHtml(desiredMode)}</strong></div>
          <div><span>Target</span><strong>${escapeHtml(evidenceDevice ? evidenceDevice.device_id : evidence.policy.scope || "All managed AMD Desksides")}</strong><small>${escapeHtml(evidenceDevice ? evidenceDevice.site || "Managed endpoint" : "No active endpoint")}</small></div>
          <div><span>Enforcement point</span><strong>Cisco C9350 access</strong><code>Port ${escapeHtml(evidencePort)}</code></div>
          <div><span>Result</span><strong>${escapeHtml(evidenceResult)}</strong><small>${escapeHtml(String(evidence.policy.ise_action || "QUARANTINE"))} via ISE ANC</small></div>
        </div>
        <ol id="network-enforcement-flow" class="topology-policy-flow" aria-label="Network policy enforcement evidence">
          ${evidenceSteps}
        </ol>
        <footer class="topology-policy-footer">
          <span>Trigger · ${escapeHtml(String(evidence.policy.trigger || "Critical Agent Control policy breach"))}</span>
          <time>${escapeHtml(activeEvidence && activeEvidence.occurredAt ? formatWhen(activeEvidence.occurredAt) : "No completed enforcement observed")}</time>
        </footer>
      </section>
      <div class="topology-pdf-layout">
        <figure
          id="network-topology-map"
          class="network-topology-map topology-pdf-map"
          aria-labelledby="network-topology-title"
          aria-describedby="network-topology-description"
        >
          <svg class="topology-link-layer topology-pdf-links" viewBox="0 0 1000 610" preserveAspectRatio="none" aria-hidden="true">
            <path class="topology-svg-link topology-access-uplink" data-link-access="reference-c9350-a" d="M500 146 V174 L250 236" />
            <path class="topology-svg-link topology-access-uplink" data-link-access="reference-c9350-b" d="M500 146 V174 L750 236" />
            <path class="topology-svg-link topology-deskside-link" d="M250 350 V374 H125 V400 M250 374 H375 V400" />
            <path class="topology-svg-link topology-deskside-link" d="M750 350 V374 H625 V400 M750 374 H875 V400" />
          </svg>
          <span class="topology-uplink-label is-a"><b>Reference uplink A</b><code>${escapeHtml(profile.access.uplinkSpeed)}</code></span>
          <span class="topology-uplink-label is-b"><b>Reference uplink B</b><code>${escapeHtml(profile.access.uplinkSpeed)}</code></span>
          <article class="topology-product-node topology-pdf-core" data-topology-tier="core" data-topology-model="Cisco 9550" aria-label="Smart aggregation switch, Cisco 9550">
            <img src="/shell/assets/cisco-c9550.png" alt="" />
            <div><span>Smart aggregation switch</span><strong>Cisco 9550</strong></div>
          </article>
          <div class="topology-pdf-access-grid" data-topology-tier="access" aria-label="Two Cisco 9350 smart access switches with four representative AMD Ryzen AI Halo desksides">
            ${endpointBranches}
          </div>
          <figcaption id="network-topology-description" class="visually-hidden">Reference solution architecture: one Cisco 9550 smart aggregation switch connects through two reference uplinks to two Cisco 9350 smart access switches. Each access switch connects to two AMD Ryzen AI Halo desksides with their access ports identified.</figcaption>
        </figure>
      </div>
    `;
  }

  function renderNetworkAttention(devices) {
    networkAttentionCount.textContent = `${formatNumber(devices.length)} ${devices.length === 1 ? "device" : "devices"}`;
    if (!devices.length) {
      networkDesksideList.innerHTML = '<div class="empty-state">All clear.</div>';
      return;
    }
    networkDesksideList.innerHTML = devices.map((device) => {
      const stateName = topologyDeviceState(device);
      const action = device.quarantined
        ? `<button class="button button-secondary" type="button" data-network-action="restore" data-device-id="${escapeHtml(device.device_id)}">Restore</button>`
        : device.risk === "critical"
          ? `<button class="button button-primary" type="button" data-network-action="quarantine" data-device-id="${escapeHtml(device.device_id)}">Isolate</button>`
          : '<span class="network-attention-placeholder" aria-hidden="true">—</span>';
      return `
        <div class="network-attention-row" data-device-id="${escapeHtml(device.device_id)}">
          <div class="network-attention-endpoint">
            <strong>${escapeHtml(device.device_id)}</strong>
            <small>${escapeHtml(device.site || "Unknown site")} · ${escapeHtml(device.switch_name || "Unmapped switch")} / ${escapeHtml(device.switch_port || "—")}</small>
          </div>
          <div class="network-attention-state">
            <span class="is-${escapeHtml(stateName)}"><i aria-hidden="true"></i>${escapeHtml(deviceRiskLabel(device))}</span>
            <small>${escapeHtml(device.network_access || "Access unavailable")}</small>
          </div>
          <div class="network-attention-action">${action}</div>
        </div>
      `;
    }).join("");
  }

  function infrastructurePayload() {
    return state.infrastructure && typeof state.infrastructure === "object" ? state.infrastructure : null;
  }

  function infrastructureDevices() {
    const payload = infrastructurePayload();
    return payload && Array.isArray(payload.devices) ? payload.devices : [];
  }

  function infrastructureDevice(deviceId) {
    return infrastructureDevices().find((row) => row.device_id === deviceId) || null;
  }

  function infrastructureMetric(device, name) {
    if (!device || !device.metrics || typeof device.metrics !== "object") return null;
    const metric = device.metrics[name];
    return metric && typeof metric === "object" ? metric : metric === undefined ? null : { value: metric };
  }

  function infrastructureMetricValue(device, name) {
    const metric = infrastructureMetric(device, name);
    const raw = metric ? metric.value : null;
    if (raw === null || raw === undefined || raw === "") return null;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function isInfrastructureDeviceFresh(device) {
    return Boolean(device) && !device.stale && device.status !== "offline" && Number(device.freshness_seconds || 0) <= 900;
  }

  function averageInfrastructureMetric(devices, name) {
    const values = devices
      .filter(isInfrastructureDeviceFresh)
      .map((device) => infrastructureMetricValue(device, name))
      .filter((value) => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function sumInfrastructureMetric(devices, name, includeHistorical) {
    const values = devices
      .filter((device) => includeHistorical || isInfrastructureDeviceFresh(device))
      .map((device) => infrastructureMetricValue(device, name))
      .filter((value) => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }

  function infrastructureSummary() {
    const devices = infrastructureDevices();
    const reporting = devices.filter(isInfrastructureDeviceFresh);
    return {
      totalDevices: devices.length,
      reportingDevices: reporting.length,
      staleDevices: Math.max(devices.length - reporting.length, 0),
      cpu: averageInfrastructureMetric(devices, "cpu_utilization"),
      memory: averageInfrastructureMetric(devices, "memory_utilization"),
      gpu: averageInfrastructureMetric(devices, "gpu_utilization"),
      networkReceive: sumInfrastructureMetric(devices, "network_receive", false),
      networkTransmit: sumInfrastructureMetric(devices, "network_transmit", false),
      linkUtilization: averageInfrastructureMetric(devices, "network_link_utilization"),
      power: sumInfrastructureMetric(devices, "power", false),
      energy24h: sumInfrastructureMetric(devices, "energy_24h", true),
      energy7d: sumInfrastructureMetric(devices, "energy_7d", true),
    };
  }

  function formatInfrastructureValue(value, suffix, digits) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Number(value))}${suffix}`;
  }

  function infrastructureFreshnessLabel(device) {
    if (!device) return "No telemetry";
    const seconds = Math.max(Number(device.freshness_seconds || 0), 0);
    const age = seconds >= 3600 ? `${Math.max(1, Math.round(seconds / 3600))}h` : `${Math.max(1, Math.round(seconds / 60))}m`;
    if (device.status === "offline" || seconds > 900) return `Offline · last observed ${age} ago`;
    if (device.stale || seconds > 90) return `Stale · ${Math.max(1, Math.round(seconds / 60))}m old`;
    return seconds < 60 ? `Fresh · ${Math.round(seconds)}s old` : `Fresh · ${Math.round(seconds / 60)}m old`;
  }

  function renderInfrastructureMeter(label, value) {
    if (value === null || value === undefined) {
      return `<div class="infrastructure-meter"><span>${escapeHtml(label)} —</span><div aria-hidden="true"><i style="width:0"></i></div></div>`;
    }
    const bounded = Math.min(Math.max(Number(value), 0), 100);
    return `<div class="infrastructure-meter"><span>${escapeHtml(label)} ${escapeHtml(formatInfrastructureValue(value, "%", 0))}</span><div role="meter" aria-label="${escapeHtml(label)} utilization" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${escapeHtml(bounded)}"><i style="width:${escapeHtml(bounded)}%"></i></div></div>`;
  }

  function renderFleetInfrastructureSummary() {
    const summary = infrastructureSummary();
    fleetInventorySummary.classList.add("is-infrastructure");
    fleetInventorySummary.innerHTML = `
      <span><i>CPU utilization</i><strong>${escapeHtml(formatInfrastructureValue(summary.cpu, "%", 0))}</strong><small>5-minute mean · reporting devices</small></span>
      <span><i>Memory utilization</i><strong>${escapeHtml(formatInfrastructureValue(summary.memory, "%", 0))}</strong><small>5-minute mean · reporting devices</small></span>
      <span><i>GPU utilization</i><strong>${escapeHtml(formatInfrastructureValue(summary.gpu, "%", 0))}</strong><small>AMD SMI-shaped signal</small></span>
      <span><i>Network utilization</i><strong>↓ ${escapeHtml(formatInfrastructureValue(summary.networkReceive, " Mbps", 1))} · ↑ ${escapeHtml(formatInfrastructureValue(summary.networkTransmit, " Mbps", 1))}</strong><small>${escapeHtml(formatInfrastructureValue(summary.linkUtilization, "%", 1))} mean C9350 access-link utilization</small></span>
      <span><i>Energy consumption</i><strong>${escapeHtml(formatInfrastructureValue(summary.energy7d, " kWh", 1))}</strong><small>${escapeHtml(formatInfrastructureValue(summary.energy24h, " kWh", 2))} / 24h · ${escapeHtml(formatInfrastructureValue(summary.power, " W", 0))} now</small></span>
    `;
  }

  function renderFleetInfrastructureTable(fleetDevices, target) {
    const output = target || desksideList;
    const inventoryById = new Map(fleetDevices.map((device) => [device.device_id, device]));
    const telemetry = infrastructureDevices();
    if (!telemetry.length) {
      output.innerHTML = `<div class="empty-state">${escapeHtml(state.infrastructureError || "Loading Splunk Observability infrastructure telemetry…")}</div>`;
      return;
    }
    output.innerHTML = `
      <table class="infrastructure-device-table">
        <caption class="visually-hidden">Synthetic Splunk Observability infrastructure telemetry for managed AMD Halo devices</caption>
        <thead><tr><th scope="col">Halo endpoint</th><th scope="col">Compute</th><th scope="col">Network</th><th scope="col">Power</th><th scope="col">Energy</th><th scope="col">Telemetry</th></tr></thead>
        <tbody>${telemetry.map((row) => {
          const inventory = inventoryById.get(row.device_id) || {};
          const cpu = infrastructureMetricValue(row, "cpu_utilization");
          const memory = infrastructureMetricValue(row, "memory_utilization");
          const gpu = infrastructureMetricValue(row, "gpu_utilization");
          const rx = infrastructureMetricValue(row, "network_receive");
          const tx = infrastructureMetricValue(row, "network_transmit");
          const link = infrastructureMetricValue(row, "network_link_utilization");
          const power = infrastructureMetricValue(row, "power");
          const energy24h = infrastructureMetricValue(row, "energy_24h");
          const energy7d = infrastructureMetricValue(row, "energy_7d");
          const energyMetric = infrastructureMetric(row, "energy_7d") || {};
          const quality = energyMetric.coverage === "partial" ? "partial" : energyMetric.quality || "synthetic";
          const fresh = isInfrastructureDeviceFresh(row);
          return `<tr class="${fresh ? "" : "is-stale"}">
            <td data-label="Halo endpoint"><strong>${escapeHtml(row.device_id)}</strong><small>${escapeHtml(inventory.site || row.site || "Unknown site")} · ${escapeHtml(infrastructureFreshnessLabel(row))}</small></td>
            <td data-label="Compute"><div class="infrastructure-metric-stack">${renderInfrastructureMeter("CPU", cpu)}${renderInfrastructureMeter("MEM", memory)}${renderInfrastructureMeter("GPU", gpu)}</div></td>
            <td data-label="Network"><strong>↓ ${escapeHtml(formatInfrastructureValue(rx, " Mbps", 1))} · ↑ ${escapeHtml(formatInfrastructureValue(tx, " Mbps", 1))}</strong><small>${escapeHtml(formatInfrastructureValue(link, "%", link !== null && link > 0 && link < 1 ? 2 : 1))} of ${escapeHtml(formatInfrastructureValue(infrastructureMetricValue(row, "network_link_speed"), " Mbps", 0))} link</small></td>
            <td data-label="Power"><strong>${escapeHtml(formatInfrastructureValue(power, " W", 0))}</strong><small>${power === null ? "No recent sample" : "1-minute mean · APU package"}</small></td>
            <td data-label="Energy"><strong>${escapeHtml(formatInfrastructureValue(energy24h, " kWh", 2))} / 24h</strong><small>${escapeHtml(formatInfrastructureValue(energy7d, " kWh", 1))} / 7d</small></td>
            <td data-label="Telemetry"><strong>Splunk Observability</strong><small>${escapeHtml(row.observed_at || "No recent timestamp")}</small><span class="infrastructure-quality ${quality === "partial" ? "is-partial" : ""}">${escapeHtml(quality)}</span></td>
          </tr>`;
        }).join("")}</tbody>
      </table>`;
  }

  function renderFleetInventoryCard(fleet, devices) {
    const infrastructureView = state.fleetView === "infrastructure";
    fleetInventoryViewToggle.querySelectorAll("[data-fleet-view]").forEach((button) => {
      const active = button.dataset.fleetView === state.fleetView;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    fleetTableTitle.textContent = infrastructureView ? "Managed infrastructure telemetry" : "Managed AI inventory";
    fleetTelemetrySource.textContent = infrastructureView ? "Splunk Observability · synthetic" : "Representative · synthetic telemetry";
    desksideList.classList.toggle("is-infrastructure", infrastructureView);
    if (infrastructureView) {
      renderFleetInfrastructureSummary();
      renderFleetInfrastructureTable(devices);
      return;
    }
    fleetInventorySummary.classList.remove("is-infrastructure");
    renderFleetInventorySummary(fleet, devices);
    renderDesksideTable(desksideList, devices, false);
  }

  function activateFleetView(view) {
    if (view !== "inventory" && view !== "infrastructure") return;
    state.fleetView = view;
    const payload = fleetPayload();
    if (payload) {
      renderFleetInventoryCard(payload.fleet || {}, Array.isArray(payload.devices) ? payload.devices : []);
    }
  }

  function renderFleetInventorySummary(fleet, devices) {
    const switchCount = new Set(devices.map((device) => device.switch_name).filter(Boolean)).size;
    const averageGpu = infrastructureSummary().gpu;
    fleetInventorySummary.innerHTML = `
      <span><strong>${escapeHtml(formatNumber(fleet.total_devices))}</strong> AMD Ryzen AI Halo devices</span>
      <span><strong>${escapeHtml(formatNumber(fleet.active_workload_agents))}</strong> workload agent identities</span>
      <span><strong>${escapeHtml(formatNumber(fleet.resident_defenseclaw_agents))}</strong> resident DefenseClaw identities</span>
      <span><strong>1</strong> Cisco C9550 logical core pair</span>
      <span><strong>${escapeHtml(formatNumber(switchCount))}</strong> Cisco C9350 access switches</span>
      <span><strong>${escapeHtml(formatInfrastructureValue(averageGpu, "%", 0))}</strong> representative GPU utilization</span>
    `;
  }

  function renderDesksideTable(target, devices, withActions) {
    if (!devices.length) {
      target.innerHTML = '<div class="empty-state">No AMD Desksides match this view.</div>';
      return;
    }
    target.innerHTML = `
      <table class="deskside-table">
        <caption class="visually-hidden">Representative managed AMD Halo devices, protected agent identities, GPU telemetry, and Cisco network identity</caption>
        <thead>
          <tr>
            <th scope="col">Halo endpoint</th>
            <th scope="col">Employee</th>
            <th scope="col">Agent identities</th>
            <th scope="col">AI telemetry</th>
            <th scope="col">Security</th>
            <th scope="col">Network identity</th>
            ${withActions ? '<th scope="col"><span class="visually-hidden">Actions</span></th>' : ""}
          </tr>
        </thead>
        <tbody>
          ${devices
            .map((device) => {
              const riskClass = device.status === "offline" ? "offline" : String(device.risk || "healthy");
              const agents = Array.isArray(device.agent_names) ? device.agent_names : [];
              const telemetry = infrastructureDevice(device.device_id);
              const gpuUtilization = infrastructureMetricValue(telemetry, "gpu_utilization");
              const tokens7d = Number((telemetry && telemetry.context && telemetry.context.tokens_7d) || 0);
              const gpuMarkup = gpuUtilization === null
                ? '<div class="device-gpu-telemetry"><span>GPU —</span><div aria-hidden="true"><i style="width:0"></i></div></div>'
                : `<div class="device-gpu-telemetry"><span>GPU ${escapeHtml(formatInfrastructureValue(gpuUtilization, "%", 0))}</span><div role="meter" aria-label="${escapeHtml(device.device_id)} synthetic GPU utilization" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${escapeHtml(gpuUtilization)}"><i style="width:${escapeHtml(Math.min(Math.max(gpuUtilization, 0), 100))}%"></i></div></div>`;
              const riskReason = device.device_id === "DSK-AUS-017"
                ? device.quarantined
                  ? "Critical restricted-model provenance violation · synthetic replay"
                  : "Critical restricted-model replay ready · synthetic"
                : device.risk_reason;
              const action = device.quarantined
                ? `<button class="button button-secondary" type="button" data-network-action="restore" data-device-id="${escapeHtml(device.device_id)}">Restore access</button>`
                : device.risk === "critical"
                  ? `<button class="button button-primary" type="button" data-network-action="quarantine" data-device-id="${escapeHtml(device.device_id)}">Isolate now</button>`
                  : '<span class="control-note">—</span>';
              return `
                <tr>
                  <td><strong>${escapeHtml(device.device_id)}</strong><small>AMD Ryzen AI Halo · ${escapeHtml(device.site)} · ${escapeHtml(device.status)}</small></td>
                  <td><strong>${escapeHtml(device.employee)}</strong><small>${escapeHtml(device.department)}</small></td>
                  <td>
                    <strong>${escapeHtml(formatNumber(device.active_agents))} workload · 1 resident</strong>
                    <div class="agent-roster">${agents
                      .map(
                        (agent) => `<span class="${agent === "DefenseClaw" ? "is-defenseclaw" : ""}">${escapeHtml(agent)}</span>`,
                      )
                      .join("")}</div>
                  </td>
                  <td>
                    <strong>${escapeHtml(device.model_route)}</strong>
                    <small>${escapeHtml(formatCompactNumber(tokens7d))} tokens · 7d</small>
                    ${gpuMarkup}
                  </td>
                  <td><strong><i class="risk-dot ${escapeHtml(riskClass)}" aria-hidden="true"></i>${escapeHtml(deviceRiskLabel(device))}</strong><small>${escapeHtml(riskReason)}</small></td>
                  <td><strong>Cisco C9350 Series</strong><small>${escapeHtml(device.switch_name || "Unmapped switch")} · ${escapeHtml(device.switch_port)} · ISE-correlated</small><small>${escapeHtml(device.mac_address)} · ${escapeHtml(device.network_access)}</small></td>
                  ${withActions ? `<td><div class="table-actions">${action}</div></td>` : ""}
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderRestrictedModelDemo(policy, devices) {
    const target = devices.find((device) => device.device_id === "DSK-AUS-017");
    const armed = Boolean(policy && policy.auto_quarantine);
    const quarantined = Boolean(target && target.quarantined);
    restrictedModelDemo.setAttribute("aria-busy", state.restrictedModelDemoRunning ? "true" : "false");
    restrictedModelDemoButton.setAttribute("aria-busy", state.restrictedModelDemoRunning ? "true" : "false");

    if (!target) {
      restrictedModelDemo.dataset.incidentState = "unavailable";
      restrictedModelEndpointStatus.textContent = "Endpoint unavailable";
      restrictedModelDemoState.textContent = "Test endpoint unavailable";
      restrictedModelDemoGuidance.textContent = "DSK-AUS-017 is not mapped.";
      restrictedModelDemoButton.textContent = "Test endpoint unavailable";
      restrictedModelDemoButton.disabled = true;
      return;
    }

    const employee = target.employee || "Assigned employee";
    const endpoint = target.device_id || "DSK-AUS-017";
    const workloadAgents = (Array.isArray(target.agent_names) ? target.agent_names : [])
      .filter((agent) => agent !== "DefenseClaw");
    const employeeInitials = employee
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();

    restrictedModelEmployee.textContent = employee;
    restrictedModelDepartment.textContent = target.department || "Department unavailable";
    restrictedModelEndpointId.textContent = endpoint;
    restrictedModelEndpointDetail.textContent = `AMD Ryzen AI Halo · ${target.site || "Site unavailable"}`;
    restrictedModelAgents.textContent = workloadAgents.length ? workloadAgents.join(" + ") : "No workload agents reported";
    restrictedModelNetworkAccess.textContent = target.network_access || "Access state unavailable";
    restrictedModelNetworkPolicy.textContent = `ISE policy · ${target.ise_policy || "Unavailable"}`;
    restrictedModelEndpointStatus.textContent = quarantined ? "Quarantined" : "Online · managed";
    restrictedModelEndpointStatus.classList.toggle("is-on", quarantined);
    restrictedModelResponseEndpoint.textContent = endpoint;
    restrictedModelResponseEmployee.textContent = employee;
    restrictedModelNotificationAvatar.textContent = employeeInitials || "U";

    document.querySelectorAll("[data-restricted-model-outcome]").forEach((outcome) => {
      outcome.classList.toggle("is-complete", quarantined);
      outcome.querySelector(":scope > span").textContent = quarantined ? "✓" : "○";
    });
    restrictedModelResponseLabel.textContent = quarantined ? "Response completed" : "Expected outcome";
    restrictedModelNotification.dataset.notificationState = quarantined ? "sent" : "preview";
    restrictedModelNotificationStatus.textContent = quarantined ? "Simulated notification sent" : "Preview only";
    restrictedModelNotificationTitle.textContent = quarantined
      ? `Message sent to ${employee}`
      : `Message ${employee} will receive`;
    restrictedModelNotificationMessage.textContent = quarantined
      ? `A restricted AI model was blocked on ${endpoint}. This device is temporarily quarantined with remediation-only network access. Contact your administrator for help.`
      : `A restricted AI model was blocked on ${endpoint}. This device will be temporarily quarantined with remediation-only network access. Contact your administrator for help.`;

    if (state.restrictedModelDemoRunning) {
      restrictedModelDemoButton.disabled = true;
      return;
    }

    restrictedModelDemo.dataset.incidentState = quarantined ? "quarantined" : armed ? "ready" : "setup-required";
    restrictedModelDemoButton.disabled = false;
    restrictedModelDemoButton.classList.toggle("button-primary", armed && !quarantined);
    restrictedModelDemoButton.classList.toggle("button-secondary", !armed || quarantined);
    restrictedModelDemoButton.textContent = quarantined
      ? "Reset test environment"
      : armed
        ? "Run response test"
        : "Review isolation settings";
    restrictedModelDemoState.textContent = quarantined
      ? "Test passed · endpoint quarantined"
      : armed
        ? "Ready to test"
        : "Setup required";
    restrictedModelDemoGuidance.textContent = quarantined
      ? `${endpoint} has remediation-only access.`
      : armed
        ? `Ready to isolate ${endpoint}.`
        : "Turn on automatic isolation to run.";
  }

  function renderNetworkPolicy() {
    const payload = fleetPayload();
    const policy = payload && payload.security_policy ? payload.security_policy : null;
    const devices = payload && Array.isArray(payload.devices) ? payload.devices : [];
    const armed = Boolean(policy && policy.auto_quarantine);
    autoQuarantineToggle.setAttribute("aria-checked", armed ? "true" : "false");
    autoQuarantineToggle.querySelector("b").textContent = armed ? "Enabled" : "Disabled";
    autoQuarantineToggle.disabled = !policy || Boolean(state.fleetError);
    fleetAutoQuarantineToggle.setAttribute("aria-checked", armed ? "true" : "false");
    fleetAutoQuarantineToggle.querySelector("b").textContent = armed ? "Enabled" : "Disabled";
    fleetAutoQuarantineToggle.disabled = !policy || Boolean(state.fleetError);
    autoQuarantineState.textContent = armed ? "Armed" : "Monitor";
    autoQuarantineState.classList.toggle("is-on", armed);
    autoQuarantineScope.textContent = policy ? policy.scope : "All Desksides";
    autoQuarantineIseAction.textContent = policy ? policy.ise_action : "QUARANTINE";
    autoQuarantineNote.textContent = armed
      ? "Critical incidents auto-isolate."
      : "Critical incidents log only.";
    networkMode.innerHTML = `<span aria-hidden="true"></span>${armed ? "Armed" : "Monitor"} · demo`;
    const quarantined = devices.some((device) => device.quarantined);
    onePolicyVersion.textContent = `v${Number((policy && policy.version) || 1)}`;
    policyNetworkState.textContent = quarantined ? "Quarantined" : armed ? "Armed" : "Monitor";
    policyNetworkState.style.color = quarantined || armed ? "#69e6a0" : "#f5bb57";
    renderNetworkTopology(payload);
    renderRestrictedModelDemo(policy, devices);

    const attentionDevices = devices.filter((device) => device.quarantined || device.risk === "critical" || device.risk === "review");
    renderNetworkAttention(attentionDevices);

    if (payload && payload.demo && payload.demo.network_actions_are_simulated) {
      setPageBanner(
        networkBanner,
        "warn",
        "Synthetic replay · no production network changes.",
      );
    } else {
      setPageBanner(networkBanner, "", "");
    }
  }

  function renderFleet() {
    const payload = fleetPayload();
    if (!payload) {
      fleetSummaryGrid.innerHTML = '<div class="empty-state">Fleet inventory is unavailable.</div>';
      providerUsage.innerHTML = '<div class="empty-state">Provider routing is unavailable.</div>';
      desksideList.innerHTML = '<div class="empty-state">Deskside inventory is unavailable.</div>';
      renderBehavior();
      autoQuarantineToggle.disabled = true;
      fleetAutoQuarantineToggle.disabled = true;
      return;
    }
    const fleet = payload.fleet || {};
    const devices = Array.isArray(payload.devices) ? payload.devices : [];
    const switchCount = new Set(devices.map((device) => device.switch_name).filter(Boolean)).size;
    const summaryDebug = state.summary && state.summary.debug ? state.summary.debug : {};
    const ledgerIsLive = Boolean(state.summary && summaryDebug.fixture_backed === false);
    fleetScopeName.textContent = `${fleet.name || "AMD Deskside fleet"} · ${formatNumber(fleet.total_devices)} devices`;
    fleetNetworkIdentity.textContent = `1 C9550 core pair · ${formatNumber(switchCount)} C9350 access · ${formatNumber(fleet.total_devices)} ISE-correlated endpoints`;
    fleetAgentIdentities.textContent = `${formatNumber(fleet.active_workload_agents)} workload · ${formatNumber(fleet.resident_defenseclaw_agents)} DefenseClaw residents`;
    fleetDataSource.textContent = ledgerIsLive
      ? "Synthetic fleet + 1-device live ledger"
      : "Synthetic fleet + fixture ledger";
    fleetLiveStatus.innerHTML = `<span aria-hidden="true"></span>Unified fleet · ${ledgerIsLive ? "live pilot ledger" : "fixture ledger"}`;
    renderFleetSummary();
    renderBehavior();
    renderProviderUsage();
    renderFleetPosture();
    renderFleetInventoryCard(fleet, devices);
    renderNetworkPolicy();
    setPageBanner(fleetBanner, "", "");
  }

  function renderAlerts() {
    const openAlerts = state.alerts.filter((row) => row.status === "open");
    if (!openAlerts.length) {
      alertsList.innerHTML = '<div class="empty-state">No open alerts.</div>';
      return;
    }
    alertsList.innerHTML = `
      <div class="detectors-table-wrap">
        <table class="detectors-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Alert</th>
              <th>Observed / Budget</th>
              <th>Status</th>
              <th>Time</th>
              <th><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            ${openAlerts
              .map((alert) => {
                const pillClass = alert.action === "deny" ? "pill-danger" : "pill-warn";
                const session = alert.session_id ? `Session ${alert.session_id}` : "Rolling 24h";
                const owningPolicy = state.policies.find((policy) => policy.policy_id === alert.policy_id);
                const releaseAgentId = owningPolicy ? owningPolicy.agent_id : alert.agent_id;
                return `
                  <tr>
                    <td>
                      <span class="agent-cell"><i aria-hidden="true"></i>${escapeHtml(alert.agent_name || alert.agent_id)}</span>
                      <small>${escapeHtml(session)}</small>
                    </td>
                    <td>${escapeHtml(alert.reason || "Budget threshold exceeded.")}</td>
                    <td>
                      <strong>${escapeHtml(formatNumber(alert.observed_value))}</strong>
                      <small>of ${escapeHtml(formatNumber(alert.budget_value))} ${escapeHtml(alert.metric || "")}</small>
                    </td>
                    <td>
                      <span class="pill ${pillClass}">${escapeHtml(alert.action)}</span>
                      <span class="pill pill-info">${escapeHtml(alert.window || "window")}</span>
                    </td>
                    <td>${escapeHtml(formatWhen(alert.updated_at))}</td>
                    <td>
                      <div class="table-actions">
                        <button class="button button-secondary" type="button" data-prefill-agent-id="${escapeHtml(alert.agent_id)}" data-prefill-agent-name="${escapeHtml(alert.agent_name || alert.agent_id)}">Apply policy</button>
                        <button class="button button-secondary" type="button" data-release-agent-id="${escapeHtml(releaseAgentId)}">Remove limit</button>
                      </div>
                    </td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderPolicies() {
    if (!state.policies.length) {
      policiesList.innerHTML = '<div class="empty-state">No policies.</div>';
      return;
    }
    policiesList.innerHTML = `<div class="budget-policy-grid">${state.policies
      .map((policy) => {
        return `
          <article class="budget-policy-card">
            <header>
              <h4>${escapeHtml(policy.agent_name || policy.agent_id)}</h4>
              <span class="pill ${policy.action === "deny" ? "pill-danger" : "pill-warn"}">${escapeHtml(policy.action === "deny" ? "Stop task" : "Switch model")}</span>
            </header>
            <div class="policy-limits">
              <div><span>Session tokens</span><strong>${escapeHtml(formatNumber(policy.session_token_budget || 0))}</strong></div>
              <div><span>24h tokens</span><strong>${escapeHtml(formatNumber(policy.daily_token_budget || 0))}</strong></div>
              <div><span>Session cost</span><strong>${formatCurrency(policy.session_cost_budget_usd || 0)}</strong></div>
              <div><span>24h cost</span><strong>${formatCurrency(policy.daily_cost_budget_usd || 0)}</strong></div>
            </div>
            <p>Updated ${escapeHtml(formatWhen(policy.updated_at))}</p>
            <div class="item-actions">
              <button class="button button-secondary" type="button" data-prefill-agent-id="${escapeHtml(policy.agent_id)}" data-prefill-agent-name="${escapeHtml(
                policy.agent_name || policy.agent_id,
              )}">
                Edit
              </button>
              <button class="button button-secondary" type="button" data-release-agent-id="${escapeHtml(policy.agent_id)}">
                Remove limit
              </button>
            </div>
          </article>
        `;
      })
      .join("")}</div>`;
  }

  function controlIsAllowed(targetType, targetName) {
    return state.allowedControls.some(
      (control) => control.target_type === targetType && control.target_name === targetName,
    );
  }

  function chatBudgetMode() {
    if (state.policiesError) {
      return { mode: "unavailable", policy: null };
    }
    const policy = state.policies.find((row) => row.agent_id === "*");
    if (!policy) {
      return { mode: "off", policy: null };
    }
    const isSimple100KPolicy =
      Number(policy.session_token_budget || 0) === 100000 &&
      Number(policy.daily_token_budget || 0) === 0 &&
      Number(policy.session_cost_budget_usd || 0) === 0 &&
      Number(policy.daily_cost_budget_usd || 0) === 0 &&
      policy.action === "deny";
    return { mode: isSimple100KPolicy ? "on" : "custom", policy };
  }

  function renderChatBudgetControl() {
    const budget = chatBudgetMode();
    const overrideCount = state.policies.filter((policy) => policy.agent_id && policy.agent_id !== "*").length;
    const overrideNote = overrideCount ? ` · ${overrideCount} override${overrideCount === 1 ? "" : "s"}` : "";
    chatBudgetState.classList.toggle("is-on", budget.mode === "on");
    chatBudgetState.classList.toggle("is-custom", budget.mode === "custom");
    chatBudgetToggle.setAttribute("aria-checked", budget.mode === "on" ? "true" : "false");
    chatBudgetToggle.disabled = budget.mode === "custom" || budget.mode === "unavailable";
    chatBudgetToggle.querySelector("b").textContent = budget.mode === "on" ? "Enabled" : "Disabled";

    if (budget.mode === "on") {
      chatBudgetState.textContent = "Enabled";
      chatBudgetNote.textContent = `Active for agents without overrides${overrideNote}.`;
    } else if (budget.mode === "custom") {
      chatBudgetState.textContent = "Custom policy";
      chatBudgetNote.innerHTML = 'Custom all-agent limit · <a href="/budgets">edit in Budgets</a>.';
    } else if (budget.mode === "unavailable") {
      chatBudgetState.textContent = "Unavailable";
      chatBudgetToggle.querySelector("b").textContent = "Disabled";
      chatBudgetNote.textContent = "Policy unavailable.";
    } else {
      chatBudgetState.textContent = "Not enabled";
      chatBudgetNote.textContent = "No catch-all limit.";
    }
  }

  function renderApprovedCommands() {
    const commands = state.allowedControls
      .filter((control) => control.target_type === "command")
      .sort((left, right) => String(left.target_name).localeCompare(String(right.target_name)));
    approvedCommandCount.textContent = `${commands.length} approved`;
    if (!commands.length) {
      approvedCommandsList.innerHTML = '<div class="empty-control-list">No exact commands are approved yet.</div>';
      return;
    }
    approvedCommandsList.innerHTML = commands
      .map(
        (control) => `
          <div class="control-list-row">
            <div>
              <strong><code>${escapeHtml(control.target_name)}</code></strong>
            </div>
            <button
              class="button button-secondary"
              type="button"
              data-remove-control-type="command"
              data-remove-control-name="${escapeHtml(control.target_name)}"
              ${state.controlsError ? "disabled" : ""}
            >Remove</button>
          </div>
        `,
      )
      .join("");
  }

  function renderToolScanExceptions() {
    const scanExceptions = state.allowedControls
      .filter((control) => control.target_type === "tool")
      .sort((left, right) => String(left.target_name).localeCompare(String(right.target_name)));
    toolExceptionCount.textContent = `${scanExceptions.length} exact scan exception${scanExceptions.length === 1 ? "" : "s"}`;
    if (!scanExceptions.length) {
      toolExceptionsList.innerHTML = '<div class="empty-control-list">No exact tool scan bypasses are configured.</div>';
      return;
    }
    toolExceptionsList.innerHTML = scanExceptions
      .map(
        (control) => `
          <div class="control-list-row">
            <div>
              <strong><code>${escapeHtml(control.target_name)}</code></strong>
              <p>Routine inspection bypass · exact tool name</p>
            </div>
            <button
              class="button button-secondary"
              type="button"
              data-remove-control-type="tool"
              data-remove-control-name="${escapeHtml(control.target_name)}"
              ${state.controlsError ? "disabled" : ""}
            >Remove bypass</button>
          </div>
        `,
      )
      .join("");
  }

  function toggleCapabilityPreview(button) {
    if (button.disabled) return;
    const enabled = button.getAttribute("aria-checked") !== "true";
    button.setAttribute("aria-checked", enabled ? "true" : "false");
    button.querySelector("b").textContent = enabled ? "Enabled" : "Disabled";
  }

  function renderAgentControls() {
    const debug = state.summary && state.summary.debug ? state.summary.debug : {};
    const gateway = debug.gateway || {};
    const payload = fleetPayload();
    const fleet = payload && payload.fleet ? payload.fleet : null;
    if (fleet) {
      const knownAgents = Number(fleet.active_workload_agents || 0) + Number(fleet.resident_defenseclaw_agents || 0);
      agentIdentityCount.textContent = formatNumber(knownAgents);
      agentIdentityNote.textContent = `${formatNumber(fleet.active_workload_agents)} workload + ${formatNumber(fleet.resident_defenseclaw_agents)} DefenseClaw`;
      agentFleetCoverage.textContent = `${formatNumber(fleet.protected_devices)} / ${formatNumber(fleet.total_devices)}`;
      agentFleetNote.textContent = `${formatNumber(fleet.online_devices)} reporting`;
    } else {
      agentIdentityCount.textContent = "—";
      agentIdentityNote.textContent = "Fleet unavailable";
      agentFleetCoverage.textContent = "—";
      agentFleetNote.textContent = "Fleet unavailable";
    }
    if (state.controlsError || state.policiesError) {
      controlsMode.innerHTML = '<span aria-hidden="true"></span>Controls unavailable';
      const errors = [state.policiesError, state.controlsError].filter(Boolean).join(" ");
      setControlsBanner("warn", `Controls unavailable · ${errors}`);
    } else if (debug.fixture_backed) {
      controlsMode.innerHTML = '<span aria-hidden="true"></span>Demo control state';
      setControlsBanner("warn", "Demo controls · reset on restart.");
    } else if (gateway.enabled === false) {
      controlsMode.innerHTML = '<span aria-hidden="true"></span>Gateway not configured';
      setControlsBanner("warn", "Gateway not configured · controls disabled.");
    } else {
      controlsMode.innerHTML = '<span aria-hidden="true"></span>DefenseClaw · live';
      setControlsBanner("", "");
    }
    const controlsLocked = Boolean(state.controlsError);
    approvedCommandInput.disabled = controlsLocked;
    approvedCommandForm.querySelector('button[type="submit"]').disabled = controlsLocked;
    document.querySelectorAll("[data-command-preset]").forEach((button) => {
      button.disabled = controlsLocked;
    });
    renderChatBudgetControl();
    renderApprovedCommands();
    renderToolScanExceptions();
  }

  async function refresh() {
    const [summaryResult, alertsResult, policiesResult, controlsResult, fleetResult, analyticsResult, infrastructureResult] = await Promise.allSettled([
      fetchJson(`${apiBase}/summary?include_galileo=true&window=${encodeURIComponent(usageWindow)}`),
      fetchJson(`${apiBase}/alerts?limit=100`),
      fetchJson(`${apiBase}/policies/effective`),
      fetchJson(`${apiBase}/agent-controls/allowed`),
      fetchJson(`${apiBase}/fleet/overview`),
      fetchJson(`${apiBase}/fleet/analytics`),
      fetchJson(`${apiBase}/fleet/infrastructure?window=-24h&resolution=1h`),
    ]);

    if (summaryResult.status === "fulfilled") {
      state.summary = summaryResult.value;
    }
    if (alertsResult.status === "fulfilled") {
      state.alerts = Array.isArray(alertsResult.value) ? alertsResult.value : [];
    }
    if (policiesResult.status === "fulfilled") {
      state.policies = Array.isArray(policiesResult.value) ? policiesResult.value : [];
      state.policiesError = "";
    } else {
      state.policiesError = `Budget policies: ${policiesResult.reason.message}`;
    }
    if (controlsResult.status === "fulfilled") {
      state.allowedControls = Array.isArray(controlsResult.value) ? controlsResult.value : [];
      state.controlsError = "";
    } else {
      state.controlsError = `Agent controls: ${controlsResult.reason.message}`;
    }
    if (fleetResult.status === "fulfilled") {
      state.fleet = fleetResult.value;
      state.fleetError = "";
    } else {
      state.fleetError = `Fleet overview: ${fleetResult.reason.message}`;
    }
    if (analyticsResult.status === "fulfilled") {
      state.analytics = analyticsResult.value;
      state.analyticsError = "";
    } else {
      state.analytics = null;
      state.analyticsError = `Fleet analytics: ${analyticsResult.reason.message}`;
    }
    if (infrastructureResult.status === "fulfilled") {
      state.infrastructure = infrastructureResult.value;
      state.infrastructureError = "";
    } else {
      state.infrastructure = null;
      state.infrastructureError = `Infrastructure telemetry: ${infrastructureResult.reason.message}`;
    }

    renderLedgerProvenance();
    renderTokenomicsAnalytics();
    renderInfrastructure();
    renderAlerts();
    renderPolicies();
    renderAgentControls();
    renderFleet();
    if (state.fleetError) {
      setPageBanner(fleetBanner, "warn", state.fleetError);
      setPageBanner(networkBanner, "warn", state.fleetError);
    }

    const refreshErrors = [summaryResult, alertsResult, policiesResult]
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason.message);
    const openAlerts = state.alerts.filter((row) => row.status === "open");
    const gatewayDebug = state.summary && state.summary.debug ? state.summary.debug.gateway : null;
    if (refreshErrors.length) {
      setBanner("warn", `Unable to refresh all tokenomics data: ${refreshErrors.join(" ")}`);
    } else if (openAlerts.length) {
      setBanner("danger", `${openAlerts.length} budget alert${openAlerts.length === 1 ? "" : "s"}.`);
    } else if (gatewayDebug && gatewayDebug.enabled === false) {
      setBanner("warn", "Fixture data · gateway not configured.");
    } else if (gatewayDebug && gatewayDebug.error) {
      setBanner("warn", `DefenseClaw gateway is configured but unavailable: ${gatewayDebug.error.detail || gatewayDebug.error.error || gatewayDebug.error}`);
    } else {
      setBanner("", "");
    }
  }

  function prefillAgent(agentId, agentName) {
    document.getElementById("agent-id").value = agentId || "";
    document.getElementById("agent-name").value = agentName || "";
  }

  function formPayload() {
    const raw = new FormData(form);
    const payload = {
      agent_id: String(raw.get("agent_id") || "").trim(),
      agent_name: String(raw.get("agent_name") || "").trim(),
      action: String(raw.get("action") || "deny").trim(),
      updated_by: "c3-tokenomics-ui",
      source: "c3-tokenomics-ui",
    };
    ["session_token_budget", "daily_token_budget"].forEach((key) => {
      const value = String(raw.get(key) || "").trim();
      if (value) {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed <= 0) {
          throw new Error(`${key} must be a positive whole number.`);
        }
        payload[key] = parsed;
      }
    });
    ["session_cost_budget_usd", "daily_cost_budget_usd"].forEach((key) => {
      const value = String(raw.get(key) || "").trim();
      if (value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(`${key} must be a positive USD amount.`);
        }
        payload[key] = parsed;
      }
    });
    if (
      payload.session_token_budget === undefined &&
      payload.daily_token_budget === undefined &&
      payload.session_cost_budget_usd === undefined &&
      payload.daily_cost_budget_usd === undefined
    ) {
      throw new Error("Set at least one token or cost budget.");
    }
    return payload;
  }

  async function applyPolicy(event) {
    event.preventDefault();
    try {
      const payload = formPayload();
      await fetchJson(`${apiBase}/controls/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await refresh();
      setBanner("warn", `Applied ${payload.action} policy for ${payload.agent_id}.`);
    } catch (error) {
      setBanner("warn", `Failed to apply policy: ${error.message}`);
    }
  }

  async function releasePolicy(agentId) {
    const target = agentId || document.getElementById("agent-id").value.trim();
    if (!target) {
      setBanner("warn", "Choose an agent before releasing a policy.");
      return;
    }
    try {
      await fetchJson(`${apiBase}/controls/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: target }),
      });
      await refresh();
      setBanner("warn", `Released policy for ${target}.`);
    } catch (error) {
      setBanner("warn", `Failed to release policy: ${error.message}`);
    }
  }

  function normalizeExactCommand(value) {
    const command = String(value || "").trim();
    if (!command) {
      throw new Error("Enter the exact command to approve.");
    }
    if (command.length > 512) {
      throw new Error("Approved commands must be 512 characters or fewer.");
    }
    if (/[\r\n\0]/.test(command)) {
      throw new Error("Approved commands must contain exactly one command line.");
    }
    return command;
  }

  async function changeRuntimeControl(action, targetType, targetName, reason) {
    await fetchJson(`${apiBase}/agent-controls/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_type: targetType,
        target_name: targetName,
        reason,
      }),
    });
    await refresh();
    if (state.controlsError) {
      throw new Error("DefenseClaw accepted the request, but the updated control state could not be confirmed.");
    }
    const shouldBeAllowed = action === "allow";
    if (controlIsAllowed(targetType, targetName) !== shouldBeAllowed) {
      throw new Error("DefenseClaw did not confirm the requested control state.");
    }
  }

  async function approveCommand(commandValue) {
    let command;
    try {
      command = normalizeExactCommand(commandValue);
    } catch (error) {
      setControlsBanner("danger", error.message);
      return;
    }
    if (controlIsAllowed("command", command)) {
      setControlsBanner("warn", `Already approved: “${command}”.`);
      return;
    }
    approvedCommandInput.disabled = true;
    approvedCommandForm.querySelector('button[type="submit"]').disabled = true;
    try {
      await changeRuntimeControl(
        "allow",
        "command",
        command,
        "Exact command approved through Agent Control",
      );
      approvedCommandInput.value = "";
      setControlsBanner("warn", `Approved exactly: “${command}”.`);
    } catch (error) {
      setControlsBanner("danger", `Could not approve “${command}”: ${error.message}`);
    } finally {
      approvedCommandInput.disabled = Boolean(state.controlsError);
      approvedCommandForm.querySelector('button[type="submit"]').disabled = Boolean(state.controlsError);
    }
  }

  async function removeRuntimeControl(targetType, targetName, button) {
    button.disabled = true;
    try {
      await changeRuntimeControl(
        "remove",
        targetType,
        targetName,
        "Approval removed through Agent Control",
      );
      setControlsBanner("warn", `Removed “${targetName}”.`);
    } catch (error) {
      setControlsBanner("danger", `Could not remove “${targetName}”: ${error.message}`);
      button.disabled = false;
    }
  }

  async function toggleChatBudget() {
    const before = chatBudgetMode();
    if (before.mode !== "on" && before.mode !== "off") {
      return;
    }
    const enabling = before.mode === "off";
    chatBudgetToggle.disabled = true;
    chatBudgetToggle.setAttribute("aria-busy", "true");
    try {
      if (enabling) {
        await fetchJson(`${apiBase}/controls/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_id: "*",
            agent_name: "All agents",
            session_token_budget: 100000,
            action: "deny",
            updated_by: "c3-tokenomics-agent-controls",
            source: "c3-tokenomics-agent-controls",
          }),
        });
      } else {
        await fetchJson(`${apiBase}/controls/release`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: "*" }),
        });
      }
      await refresh();
      const after = chatBudgetMode();
      if (after.mode !== (enabling ? "on" : "off")) {
        throw new Error("DefenseClaw did not confirm the requested all-agent budget state.");
      }
      setControlsBanner(
        "warn",
        enabling
          ? "100K hard stop enabled · overrides preserved."
          : "100K hard stop removed · overrides preserved.",
      );
    } catch (error) {
      setControlsBanner("danger", `Could not ${enabling ? "enable" : "release"} the 100K hard stop: ${error.message}`);
      renderChatBudgetControl();
    } finally {
      chatBudgetToggle.removeAttribute("aria-busy");
      if (chatBudgetMode().mode === "on" || chatBudgetMode().mode === "off") {
        chatBudgetToggle.disabled = false;
      }
    }
  }

  async function refreshFleetState() {
    const payload = await fetchJson(`${apiBase}/fleet/overview`);
    state.fleet = payload;
    state.fleetError = "";
    renderFleet();
    return payload;
  }

  async function toggleAutomaticIsolation() {
    const payload = fleetPayload();
    const policy = payload && payload.security_policy ? payload.security_policy : null;
    if (!policy || autoQuarantineToggle.disabled) {
      return;
    }
    const enabling = !policy.auto_quarantine;
    [autoQuarantineToggle, fleetAutoQuarantineToggle].forEach((button) => {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    });
    try {
      await fetchJson(`${apiBase}/security/policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: enabling,
          expected_version: Number(policy.version || 1),
          reason: enabling
            ? "Arm automatic Deskside isolation for critical Agent Control policy breaches"
            : "Return automatic Deskside isolation to monitor mode",
        }),
      });
      const updated = await refreshFleetState();
      const confirmed = Boolean(updated.security_policy && updated.security_policy.auto_quarantine);
      if (confirmed !== enabling) {
        throw new Error("Cloud Control did not confirm the requested policy state.");
      }
      setPageBanner(
        networkBanner,
        "warn",
        enabling
          ? "Automatic isolation armed · existing devices unchanged."
          : "Monitor mode · isolated devices unchanged.",
      );
    } catch (error) {
      renderNetworkPolicy();
      setPageBanner(networkBanner, "danger", `Could not update automatic isolation: ${error.message}`);
    } finally {
      [autoQuarantineToggle, fleetAutoQuarantineToggle].forEach((button) => {
        button.removeAttribute("aria-busy");
        button.disabled = Boolean(state.fleetError) || !fleetPayload();
      });
    }
  }

  function demoDelay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function runJiraGuardrailDemo() {
    if (state.jiraGuardrailRunning) {
      return;
    }
    state.jiraGuardrailRunning = true;
    jiraGuardrailDemoButton.disabled = true;
    jiraGuardrailDemoButton.textContent = "Evaluating prompt…";
    jiraGuardrailDemoResult.classList.remove("is-blocked");
    jiraGuardrailDemoResult.textContent = "Prompt received · resolving Jira tool intent.";
    await demoDelay(320);
    jiraGuardrailDemoResult.textContent = "jira.delete_issue requested · DefenseClaw evaluating policy.";
    await demoDelay(320);
    jiraGuardrailDemoResult.classList.add("is-blocked");
    jiraGuardrailDemoResult.textContent = "Blocked by DefenseClaw · SEC-1842 was not deleted.";
    jiraGuardrailDemoButton.textContent = "Replay guardrail";
    jiraGuardrailDemoButton.disabled = false;
    state.jiraGuardrailRunning = false;
    setControlsBanner("warn", "Jira deletion denied · SEC-1842 remains unchanged · no network action required.");
  }

  async function runRestrictedModelDemo() {
    const payload = fleetPayload();
    const policy = payload && payload.security_policy ? payload.security_policy : null;
    const devices = payload && Array.isArray(payload.devices) ? payload.devices : [];
    const target = devices.find((device) => device.device_id === "DSK-AUS-017");
    if (!policy || !target || state.restrictedModelDemoRunning) {
      return;
    }
    if (!target.quarantined && !policy.auto_quarantine) {
      setPageBanner(networkBanner, "warn", "Automatic isolation is off. Turn it on before running the response test.");
      document
        .querySelector(".isolation-control-card")
        .scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });
      autoQuarantineToggle.focus({ preventScroll: true });
      return;
    }

    const action = target.quarantined ? "restore" : "quarantine";
    state.restrictedModelDemoRunning = true;
    restrictedModelDemo.dataset.incidentState = action === "quarantine" ? "evaluating" : "resetting";
    restrictedModelDemo.setAttribute("aria-busy", "true");
    restrictedModelDemoButton.disabled = true;
    restrictedModelDemoButton.setAttribute("aria-busy", "true");
    try {
      if (action === "quarantine") {
        restrictedModelDemoButton.textContent = "Running response test…";
        restrictedModelDemoState.textContent = "Checking model provenance";
        restrictedModelDemoGuidance.textContent = "Verifying the publisher, digital signature, and restricted-model policy.";
        await demoDelay(320);
        restrictedModelDemoState.textContent = "Download blocked";
        restrictedModelDemoGuidance.textContent = "DefenseClaw prevented the unapproved model from being installed.";
        await demoDelay(320);
        restrictedModelDemoState.textContent = "Applying endpoint quarantine";
        restrictedModelDemoGuidance.textContent = `Cisco ISE is limiting ${target.device_id} to remediation services.`;
        await demoDelay(320);
      } else {
        restrictedModelDemoButton.textContent = "Resetting test environment…";
        restrictedModelDemoState.textContent = "Resetting test environment";
        restrictedModelDemoGuidance.textContent = "Restoring endpoint access and Automatic isolation to monitor mode.";
      }

      if (action === "restore") {
        await fetchJson(`${apiBase}/fleet/demo/reset`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Reset the restricted-model security replay to its pristine baseline" }),
        });
      } else {
        await fetchJson(`${apiBase}/fleet/desksides/${encodeURIComponent(target.device_id)}/network-action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            requested_by: "cloud-control-model-provenance-replay",
            reason: "Critical unsigned and denylisted model provenance violation",
          }),
        });
      }
      state.restrictedModelDemoRunning = false;
      await refreshFleetState();
      setPageBanner(
        networkBanner,
        "warn",
        action === "quarantine"
          ? "Response test passed · restricted model blocked · DSK-AUS-017 quarantined through simulated ISE/C9350 policy."
          : "Response test reset · endpoint access and monitor mode restored.",
      );
    } catch (error) {
      state.restrictedModelDemoRunning = false;
      renderRestrictedModelDemo(policy, devices);
      restrictedModelDemo.dataset.incidentState = "error";
      restrictedModelDemo.setAttribute("aria-busy", "false");
      restrictedModelDemoState.textContent = "Response test could not be completed";
      restrictedModelDemoGuidance.textContent = "Review the error and try again. No additional network action was taken.";
      setPageBanner(networkBanner, "danger", `Could not complete the restricted-model response test: ${error.message}`);
    }
  }

  async function changeDeviceNetworkAccess(deviceId, action, button) {
    button.disabled = true;
    try {
      await fetchJson(`${apiBase}/fleet/desksides/${encodeURIComponent(deviceId)}/network-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reason:
            action === "quarantine"
              ? "Operator isolated a critical-risk Deskside from Cloud Control"
              : "Operator restored a remediated Deskside from Cloud Control",
        }),
      });
      await refreshFleetState();
      setPageBanner(
        networkBanner,
        "warn",
        action === "quarantine"
          ? `${deviceId} isolated · simulated ISE/C9350.`
          : `${deviceId} restored · simulated ISE/C9350.`,
      );
    } catch (error) {
      setPageBanner(networkBanner, "danger", `Could not ${action === "quarantine" ? "isolate" : "restore"} ${deviceId}: ${error.message}`);
      button.disabled = false;
    }
  }

  refreshButton.addEventListener("click", refresh);
  infrastructureRefreshButton.addEventListener("click", refresh);
  form.addEventListener("submit", applyPolicy);
  releaseButton.addEventListener("click", function () {
    releasePolicy("");
  });
  approvedCommandForm.addEventListener("submit", function (event) {
    event.preventDefault();
    approveCommand(approvedCommandInput.value);
  });
  capabilityToggles.forEach((button) => {
    button.addEventListener("click", function () {
      toggleCapabilityPreview(button);
    });
  });
  chatBudgetToggle.addEventListener("click", toggleChatBudget);
  autoQuarantineToggle.addEventListener("click", toggleAutomaticIsolation);
  fleetAutoQuarantineToggle.addEventListener("click", toggleAutomaticIsolation);
  demoRunButton.addEventListener("click", runRoutingDemo);
  lemonadeRoutingToggle.addEventListener("click", toggleLemonadeRouting);
  jiraGuardrailDemoButton.addEventListener("click", runJiraGuardrailDemo);
  restrictedModelDemoButton.addEventListener("click", runRestrictedModelDemo);
  policyStudioForm.addEventListener("submit", generatePolicyStudioDraft);
  policyStudioInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      policyStudioForm.requestSubmit();
    }
  });
  policyStudioPresetRow.addEventListener("click", function (event) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("[data-policy-studio-preset]");
    if (!button || state.policyStudioGenerating || state.policyStudioStaging) return;
    policyStudioInput.value = button.dataset.policyStudioPreset || "";
    policyStudioInput.focus();
  });
  policyStudioReviewConfirmed.addEventListener("change", function () {
    const canStage =
      Boolean(state.policyStudioDraft) &&
      state.policyStudioDraft.status === "generated" &&
      policyStudioReviewConfirmed.checked &&
      !state.policyStudioGenerating &&
      !state.policyStudioStaging;
    policyStudioStageButton.disabled = !canStage;
  });
  policyStudioReviseButton.addEventListener("click", revisePolicyStudioDraft);
  policyStudioStageButton.addEventListener("click", stagePolicyStudioDraft);
  fleetInventoryViewToggle.addEventListener("click", function (event) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("[data-fleet-view]");
    if (button) activateFleetView(button.dataset.fleetView);
  });
  agentControlTabs.forEach((button, index) => {
    button.addEventListener("click", function () {
      activateAgentControlTab(button.dataset.agentControlTab, true);
    });
    button.addEventListener("keydown", function (event) {
      let nextIndex = index;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % agentControlTabs.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + agentControlTabs.length) % agentControlTabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = agentControlTabs.length - 1;
      else return;
      event.preventDefault();
      const nextButton = agentControlTabs[nextIndex];
      nextButton.focus();
      activateAgentControlTab(nextButton.dataset.agentControlTab, true);
    });
  });
  tokenomicsTabs.forEach((button, index) => {
    button.addEventListener("click", function () {
      activateTokenomicsTab(button.dataset.tokenomicsTab, true);
    });
    button.addEventListener("keydown", function (event) {
      let nextIndex = index;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tokenomicsTabs.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tokenomicsTabs.length) % tokenomicsTabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tokenomicsTabs.length - 1;
      else return;
      event.preventDefault();
      const nextButton = tokenomicsTabs[nextIndex];
      nextButton.focus();
      activateTokenomicsTab(nextButton.dataset.tokenomicsTab, true);
    });
  });
  tokenomicsWindowFilter.addEventListener("change", function () {
    state.analyticsWindow = tokenomicsWindowFilter.value;
    state.usageDetailPage = 1;
    renderTokenomicsAnalytics();
  });
  tokenomicsTeamFilter.addEventListener("change", function () {
    state.analyticsTeam = tokenomicsTeamFilter.value;
    state.usageDetailPage = 1;
    updateTokenomicsFilterUrl();
    renderTokenomicsAnalytics();
  });
  tokenomicsModelFilter.addEventListener("change", function () {
    state.analyticsModel = tokenomicsModelFilter.value;
    state.usageDetailPage = 1;
    updateTokenomicsFilterUrl();
    renderTokenomicsAnalytics();
  });
  tokenomicsAgentFilter.addEventListener("change", function () {
    state.analyticsAgent = tokenomicsAgentFilter.value;
    state.usageDetailPage = 1;
    updateTokenomicsFilterUrl();
    renderTokenomicsAnalytics();
  });
  tokenomicsClearFilters.addEventListener("click", function () {
    state.analyticsAgent = "all";
    state.analyticsModel = "all";
    state.analyticsTeam = "all";
    state.usageDetailPage = 1;
    state.usageDetailSearch = "";
    usageDetailSearch.value = "";
    updateTokenomicsFilterUrl();
    renderTokenomicsAnalytics();
  });
  costBreakdownControls.addEventListener("click", function (event) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("[data-cost-breakdown]");
    if (!button) return;
    state.costBreakdownDimension = button.dataset.costBreakdown;
    renderCostBreakdown();
  });
  usageDetailDimensions.addEventListener("click", function (event) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("[data-usage-dimension]");
    if (!button) return;
    state.usageDetailDimension = button.dataset.usageDimension;
    state.usageDetailPage = 1;
    renderUsageDetail();
  });
  usageDetailSearch.addEventListener("input", function () {
    state.usageDetailSearch = usageDetailSearch.value;
    state.usageDetailPage = 1;
    renderUsageDetail();
  });
  usagePagePrev.addEventListener("click", function () {
    state.usageDetailPage -= 1;
    renderUsageDetail();
  });
  usagePageNext.addEventListener("click", function () {
    state.usageDetailPage += 1;
    renderUsageDetail();
  });

  document.addEventListener("click", function (event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const prefillButton = target.closest("[data-prefill-agent-id]");
    if (prefillButton) {
      prefillAgent(
        prefillButton.dataset.prefillAgentId,
        prefillButton.dataset.prefillAgentName || prefillButton.dataset.prefillAgentId,
      );
    }
    const releasePolicyButton = target.closest("[data-release-agent-id]");
    if (releasePolicyButton) {
      releasePolicy(releasePolicyButton.dataset.releaseAgentId);
    }
    const presetButton = target.closest("[data-command-preset]");
    if (presetButton) {
      approvedCommandInput.value = presetButton.dataset.commandPreset;
      approveCommand(presetButton.dataset.commandPreset);
    }
    const removeButton = target.closest("[data-remove-control-type]");
    if (removeButton) {
      removeRuntimeControl(
        removeButton.dataset.removeControlType,
        removeButton.dataset.removeControlName,
        removeButton,
      );
    }
    const networkActionButton = target.closest("[data-network-action][data-device-id]");
    if (networkActionButton) {
      changeDeviceNetworkAccess(
        networkActionButton.dataset.deviceId,
        networkActionButton.dataset.networkAction,
        networkActionButton,
      );
    }
  });

  const initialUrl = new URL(window.location.href);
  const initialPath = initialUrl.pathname.replace(/\/+$/, "") || "/";
  if (
    (initialPath === "/budgets" || initialPath === "/tokenomics") &&
    initialUrl.searchParams.get("tab") === "infrastructure"
  ) {
    initialUrl.pathname = "/infrastructure";
    initialUrl.searchParams.delete("tab");
    window.history.replaceState({}, "", initialUrl);
  }

  activateShellPage();
  activateTokenomicsTab(new URLSearchParams(window.location.search).get("tab"), false);
  window.addEventListener("popstate", function () {
    activateShellPage();
    if (["/budgets", "/tokenomics"].includes(window.location.pathname.replace(/\/+$/, ""))) {
      activateTokenomicsTab(new URLSearchParams(window.location.search).get("tab"), false);
    }
  });
  renderRoutingDemo();
  refresh();
  window.setInterval(refresh, 30000);
})();
