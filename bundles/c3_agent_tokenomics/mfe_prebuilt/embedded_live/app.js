(function () {
  const searchParams = new URLSearchParams(window.location.search);
  const requestedWindow = searchParams.get("window");
  const usageWindow = /^-[1-9]\d{0,2}(?:h|d)$/.test(requestedWindow || "") ? requestedWindow : "-7d";
  const summaryUrl = `/v1/c3/agent-tokenomics/summary?include_galileo=true&window=${encodeURIComponent(usageWindow)}`;
  const rowsUrl = `/v1/c3/agent-tokenomics/usage/rows?window=${encodeURIComponent(usageWindow)}`;
  const viewLabels = { cost: "Cost", budget: "Budget", controls: "Controls", settings: "Settings" };
  const dimensionLabels = { model: "Model", agent: "Agent", provider: "Provider", connector: "Connector" };
  const requestedView = searchParams.get("view");
  const initialView = Object.prototype.hasOwnProperty.call(viewLabels, requestedView) ? requestedView : "cost";

  const state = {
    summaryPayload: null,
    rowPayload: { rows: [] },
    activeView: initialView,
    activeDimension: "model",
    search: "",
  };

  const refs = {
    dataMode: document.getElementById("data-mode"),
    updatedAt: document.getElementById("updated-at"),
    statusBanner: document.getElementById("status-banner"),
    windowChip: document.getElementById("window-chip"),
    surfaceChip: document.getElementById("surface-chip"),
    providerChip: document.getElementById("provider-chip"),
    agentChip: document.getElementById("agent-chip"),
    summaryGrid: document.getElementById("summary-grid"),
    breakdownMeta: document.getElementById("breakdown-meta"),
    breakdownBars: document.getElementById("breakdown-bars"),
    tokenMix: document.getElementById("token-mix"),
    breachFeed: document.getElementById("breach-feed"),
    tableSearch: document.getElementById("table-search"),
    tableContext: document.getElementById("table-context"),
    tablePanel: document.getElementById("table-panel"),
    budgetCards: document.getElementById("budget-cards"),
    budgetRecommendations: document.getElementById("budget-recommendations"),
    policiesPanel: document.getElementById("policies-panel"),
    consumersPanel: document.getElementById("consumers-panel"),
    controlsEvidence: document.getElementById("controls-evidence"),
    controlsRecommendations: document.getElementById("controls-recommendations"),
    settingsCards: document.getElementById("settings-cards"),
    sourceDetails: document.getElementById("source-details"),
    deepLinks: document.getElementById("deep-links"),
    views: {
      cost: document.getElementById("cost-view"),
      budget: document.getElementById("budget-view"),
      controls: document.getElementById("controls-view"),
      settings: document.getElementById("settings-view"),
    },
  };

  const viewButtons = Array.from(document.querySelectorAll(".view-tab"));
  const dimensionButtons = Array.from(document.querySelectorAll(".dimension-tab"));

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function safeExternalUrl(value) {
    try {
      const parsed = new URL(String(value || ""), window.location.origin);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
    } catch (_error) {
      return "";
    }
  }

  function formatCount(value) {
    const numeric = Number(value || 0);
    if (numeric >= 1000000) {
      return `${(numeric / 1000000).toFixed(1)}M`;
    }
    if (numeric >= 1000) {
      return `${(numeric / 1000).toFixed(1)}K`;
    }
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(numeric);
  }

  function formatExact(value) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value || 0));
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }

  function formatPercent(value) {
    return `${Number(value || 0).toFixed(1)}%`;
  }

  function formatDateTime(value) {
    if (!value) {
      return "Waiting for data";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  }

  function inferProvider(model) {
    const text = String(model || "").trim().toLowerCase();
    if (!text) {
      return "unknown";
    }
    if (text.startsWith("gpt") || text.startsWith("o1") || text.startsWith("o3") || text.startsWith("o4") || text.startsWith("openai/")) {
      return "openai";
    }
    if (text.startsWith("claude") || text.startsWith("anthropic/")) {
      return "anthropic";
    }
    if (text.startsWith("gemini") || text.startsWith("google/")) {
      return "google";
    }
    if (text.startsWith("llama") || text.startsWith("meta/")) {
      return "meta";
    }
    if (text.startsWith("command") || text.startsWith("cohere/")) {
      return "cohere";
    }
    if (text.startsWith("mistral") || text.startsWith("mixtral")) {
      return "mistral";
    }
    return "unknown";
  }

  function firstNonEmpty() {
    for (let index = 0; index < arguments.length; index += 1) {
      const candidate = arguments[index];
      if (candidate !== undefined && candidate !== null && String(candidate).trim() !== "") {
        return candidate;
      }
    }
    return "";
  }

  function setBanner(kind, message) {
    if (!message) {
      refs.statusBanner.className = "status-banner hidden";
      refs.statusBanner.textContent = "";
      return;
    }
    refs.statusBanner.className = `status-banner${kind === "warn" ? " warn" : ""}`;
    refs.statusBanner.textContent = message;
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (_error) {
        payload = { error: text };
      }
    }
    if (!response.ok) {
      throw new Error(payload.error || `${response.status} ${response.statusText}`);
    }
    return payload;
  }

  function getSummaryPayload() {
    return state.summaryPayload || {};
  }

  function getUsageRows() {
    if (state.rowPayload && Array.isArray(state.rowPayload.rows)) {
      return state.rowPayload.rows;
    }
    return [];
  }

  function normalizeRow(row) {
    const model = String(firstNonEmpty(row.model, "unknown"));
    return {
      agentName: String(firstNonEmpty(row.agent_name, row.agent_id, "unknown")),
      connector: String(firstNonEmpty(row.connector, "unknown")),
      cost: Number(row.cost_usd || 0),
      model,
      provider: String(firstNonEmpty(row.provider, inferProvider(model), "unknown")),
      requestID: String(firstNonEmpty(row.request_id, row.id, "")),
      serviceName: String(firstNonEmpty(row.service_name, "unknown")),
      sessionID: String(firstNonEmpty(row.session_id, "")),
      tokenType: String(firstNonEmpty(row.token_type, "input")),
      tokens: Number(row.tokens || 0),
    };
  }

  function aggregateUsageRows(rows, dimension) {
    const buckets = new Map();
    rows.map(normalizeRow).forEach((row) => {
      const key = String(
        dimension === "model"
          ? row.model
          : dimension === "agent"
            ? row.agentName
            : dimension === "provider"
              ? row.provider
              : row.connector,
      );
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          name: key,
          tokens: 0,
          totalCost: 0,
          inputCost: 0,
          outputCost: 0,
          requests: new Set(),
          sessions: new Set(),
          providers: new Set(),
          connectors: new Set(),
          agents: new Set(),
          models: new Set(),
          services: new Set(),
        });
      }
      const bucket = buckets.get(key);
      bucket.tokens += row.tokens;
      bucket.totalCost += row.cost;
      if (row.tokenType === "input") {
        bucket.inputCost += row.cost;
      } else if (row.tokenType === "output") {
        bucket.outputCost += row.cost;
      }
      if (row.requestID) {
        bucket.requests.add(row.requestID);
      }
      if (row.sessionID) {
        bucket.sessions.add(row.sessionID);
      }
      bucket.providers.add(row.provider);
      bucket.connectors.add(row.connector);
      bucket.agents.add(row.agentName);
      bucket.models.add(row.model);
      bucket.services.add(row.serviceName);
    });

    return Array.from(buckets.values())
      .map((bucket) => {
        const providerCount = Array.from(bucket.providers).filter(Boolean).length;
        const connectorCount = Array.from(bucket.connectors).filter(Boolean).length;
        const agentCount = Array.from(bucket.agents).filter(Boolean).length;
        const modelCount = Array.from(bucket.models).filter(Boolean).length;
        const secondary =
          dimension === "model"
            ? Array.from(bucket.providers).find(Boolean) || "unknown"
            : dimension === "agent"
              ? Array.from(bucket.connectors).find(Boolean) || "unknown"
              : dimension === "provider"
                ? `${modelCount} model${modelCount === 1 ? "" : "s"}`
                : `${agentCount} agent${agentCount === 1 ? "" : "s"}`;
        return {
          key: bucket.key,
          name: bucket.name,
          secondary,
          requestCount: bucket.requests.size,
          sessionCount: bucket.sessions.size,
          providerCount,
          connectorCount,
          agentCount,
          modelCount,
          tokens: bucket.tokens,
          totalCost: bucket.totalCost,
          inputCost: bucket.inputCost,
          outputCost: bucket.outputCost,
        };
      })
      .sort((left, right) => right.totalCost - left.totalCost || right.tokens - left.tokens);
  }

  function filteredAggregates(rows) {
    const query = state.search.trim().toLowerCase();
    if (!query) {
      return rows;
    }
    return rows.filter((row) =>
      [row.name, row.secondary].some((value) => String(value || "").toLowerCase().includes(query)),
    );
  }

  function tokenTypeClass(tokenType) {
    const normalized = String(tokenType || "input").toLowerCase();
    if (["input", "output", "cached", "reasoning", "tool"].includes(normalized)) {
      return `type-${normalized}`;
    }
    return "type-input";
  }

  function uniqueCount(rows, key) {
    const values = new Set();
    rows.map(normalizeRow).forEach((row) => values.add(row[key]));
    return Array.from(values).filter((value) => value && value !== "unknown").length;
  }

  function renderToolbar(payload, rows) {
    const summary = payload.summary || {};
    const debug = payload.debug || {};
    const filters = debug.requested_filters || {};
    const windowText = String(filters.window || "-24h");
    refs.windowChip.textContent = `Window: ${windowText}`;
    refs.surfaceChip.textContent = `Surface: ${viewLabels[state.activeView]}`;
    refs.providerChip.textContent = `Providers: ${uniqueCount(rows, "provider") || 0}`;
    refs.agentChip.textContent = `Active agents: ${formatCount(summary.active_agents || 0)}`;
  }

  function renderSummaryCards(payload) {
    const summary = payload.summary || {};
    const topAgent = Array.isArray(payload.top_agents) && payload.top_agents.length ? payload.top_agents[0] : null;
    const evidenceCount = Array.isArray(payload.runtime_governance_evidence) ? payload.runtime_governance_evidence.length : 0;
    const cards = [
      {
        detail: `${formatCount(summary.request_count || 0)} requests in current window`,
        label: "Total Tokens",
        tone: "tone-accent",
        value: formatCount(summary.total_tokens || 0),
      },
      {
        detail: `${escapeHtml(summary.cost && summary.cost.pricing_status ? summary.cost.pricing_status : "unpriced")} usage cost proxy`,
        label: "Estimated Spend",
        tone: "tone-orange",
        value: formatCurrency(summary.cost && summary.cost.total),
      },
      {
        detail: `${formatCount(summary.session_count || 0)} active sessions`,
        label: "Active Agents",
        tone: "tone-green",
        value: formatCount(summary.active_agents || 0),
      },
      {
        detail: topAgent ? `${escapeHtml(topAgent.agent_name)} is the current top consumer` : "No live evidence is open",
        label: "Open Budget Alerts",
        tone: evidenceCount > 0 ? "tone-red" : "tone-green",
        value: formatCount(evidenceCount),
      },
    ];
    refs.summaryGrid.innerHTML = cards
      .map(
        (card) => `
          <article class="summary-card ${card.tone}">
            <div class="label">${card.label}</div>
            <div class="value">${card.value}</div>
            <div class="detail">${card.detail}</div>
          </article>
        `,
      )
      .join("");
  }

  function renderBreakdown(payload, rows) {
    const aggregates = filteredAggregates(aggregateUsageRows(rows, state.activeDimension));
    const topRows = aggregates.slice(0, 6);
    const maxCost = topRows.length ? Math.max.apply(null, topRows.map((row) => row.totalCost)) : 0;
    refs.breakdownMeta.innerHTML = `
      <span class="chip">${dimensionLabels[state.activeDimension]} view</span>
      <span class="chip">${topRows.length} groups shown</span>
      <span class="chip">${formatCount(rows.length)} usage rows</span>
    `;
    refs.breakdownBars.innerHTML = topRows.length
      ? topRows
          .map((row) => {
            const width = maxCost > 0 ? Math.max(6, (row.totalCost / maxCost) * 100) : 6;
            return `
              <div class="breakdown-row">
                <div class="breakdown-copy">
                  <strong>${escapeHtml(row.name)}</strong>
                  <span>${escapeHtml(row.secondary)}</span>
                </div>
                <div class="breakdown-track">
                  <div class="breakdown-fill" style="width:${width}%"></div>
                </div>
                <div class="breakdown-metrics">
                  <strong>${formatCurrency(row.totalCost)}</strong>
                  <span>${formatCount(row.tokens)} tokens</span>
                </div>
              </div>
            `;
          })
          .join("")
      : '<div class="empty-state">No usage detail rows are available yet.</div>';

    const tokenMix = Array.isArray(payload.token_mix) ? payload.token_mix : [];
    refs.tokenMix.innerHTML = tokenMix.length
      ? tokenMix
          .map(
            (row) => `
              <article class="mix-card ${tokenTypeClass(row.token_type)}">
                <span class="mix-label">${escapeHtml(row.token_type)}</span>
                <span class="mix-value">${formatPercent(row.percentage)}</span>
                <span class="mix-detail">${formatCount(row.tokens)} tokens</span>
              </article>
            `,
          )
          .join("")
      : '<div class="empty-state">No token mix is available yet.</div>';
  }

  function evidenceItem(row) {
    const decisionClass = row.decision === "deny" ? "pill-danger" : row.decision === "warn" ? "pill-warn" : "pill-info";
    const safeDeepLink = safeExternalUrl(row.deep_link);
    const deepLink = safeDeepLink
      ? `<a href="${escapeHtml(safeDeepLink)}" target="_blank" rel="noreferrer">Open trace</a>`
      : "Local policy evidence";
    return `
      <article class="feed-item">
        <h3>${escapeHtml(row.agent_name || "unknown-agent")}</h3>
        <p>${escapeHtml(row.reason || "Budget threshold exceeded.")}</p>
        <div class="meta-row">
          <span class="pill ${decisionClass}">${escapeHtml(row.decision || "steer")}</span>
          <span class="pill pill-info">${escapeHtml(row.severity || "MEDIUM")}</span>
          <span class="pill">${escapeHtml(row.target || "runtime")}</span>
        </div>
        <div class="meta-row">
          <span class="row-secondary">${deepLink}</span>
        </div>
      </article>
    `;
  }

  function renderBreachFeed(payload) {
    const evidence = Array.isArray(payload.runtime_governance_evidence) ? payload.runtime_governance_evidence : [];
    refs.breachFeed.innerHTML = evidence.length
      ? evidence.slice(0, 4).map(evidenceItem).join("")
      : '<div class="empty-state">No live budget evidence is open.</div>';
  }

  function secondaryHeaderForDimension() {
    if (state.activeDimension === "model") {
      return "Provider";
    }
    if (state.activeDimension === "agent") {
      return "Connector";
    }
    if (state.activeDimension === "provider") {
      return "Models";
    }
    return "Agents";
  }

  function estimatedSpendFromShare(tokens, summary) {
    const totalTokens = Number(summary && summary.total_tokens ? summary.total_tokens : 0);
    const totalCost = Number(summary && summary.cost && summary.cost.total ? summary.cost.total : 0);
    if (tokens <= 0 || totalTokens <= 0 || totalCost <= 0) {
      return 0;
    }
    return (Number(tokens) / totalTokens) * totalCost;
  }

  function renderUsageTable(rows) {
    const aggregates = filteredAggregates(aggregateUsageRows(rows, state.activeDimension));
    refs.tableContext.textContent = `${aggregates.length} ${dimensionLabels[state.activeDimension].toLowerCase()} groups`;
    if (!aggregates.length) {
      refs.tablePanel.innerHTML = '<div class="empty-state">No usage detail rows match the current filters.</div>';
      return;
    }
    refs.tablePanel.innerHTML = `
      <table class="usage-table">
        <thead>
          <tr>
            <th>${dimensionLabels[state.activeDimension]}</th>
            <th>${secondaryHeaderForDimension()}</th>
            <th>Requests</th>
            <th>Sessions</th>
            <th>Total Tokens</th>
            <th>Input Spend</th>
            <th>Output Spend</th>
            <th>Total Cost</th>
          </tr>
        </thead>
        <tbody>
          ${aggregates
            .map(
              (row) => `
                <tr>
                  <td>
                    <span class="row-primary">${escapeHtml(row.name)}</span>
                    <span class="row-secondary">${escapeHtml(dimensionLabels[state.activeDimension])}</span>
                  </td>
                  <td><span class="row-primary">${escapeHtml(row.secondary)}</span></td>
                  <td>${formatExact(row.requestCount)}</td>
                  <td>${formatExact(row.sessionCount)}</td>
                  <td class="cost-strong">${formatCount(row.tokens)}</td>
                  <td>${formatCurrency(row.inputCost)}</td>
                  <td>${formatCurrency(row.outputCost)}</td>
                  <td class="cost-strong">${formatCurrency(row.totalCost)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderMetricCards(cards, target) {
    target.innerHTML = cards.length
      ? cards
          .map(
            (card) => `
              <article class="metric-card">
                <span class="metric-label">${escapeHtml(card.title || card.label || "Metric")}</span>
                <span class="metric-value">${escapeHtml(formatExact(card.value))}</span>
                <span class="metric-detail">${escapeHtml(card.subtitle || card.detail || "")}</span>
              </article>
            `,
          )
          .join("")
      : '<div class="empty-state">No metrics are available yet.</div>';
  }

  function renderRecommendations(rows, target) {
    target.innerHTML = rows.length
      ? rows
          .map(
            (row) => `
              <article class="stack-item">
                <h3>${escapeHtml(row.title || "Recommendation")}</h3>
                <p>${escapeHtml(row.why || "")}</p>
                <div class="meta-row">
                  <span class="pill pill-info">${escapeHtml(row.action || "review")}</span>
                </div>
              </article>
            `,
          )
          .join("")
      : '<div class="empty-state">No recommendations are available yet.</div>';
  }

  function extractPolicies(payload) {
    if (Array.isArray(payload.runtime_governance_policies) && payload.runtime_governance_policies.length) {
      return payload.runtime_governance_policies;
    }
    const topAgents = Array.isArray(payload.top_agents) ? payload.top_agents : [];
    return topAgents
      .filter((row) => row.budget_control)
      .map((row) => ({
        action: row.budget_control.action,
        agent_id: row.agent_id || row.agent_name,
        agent_name: row.agent_name,
        daily_cost_budget_usd: row.budget_control.daily_cost_budget_usd,
        daily_token_budget: row.budget_control.daily_token_budget,
        session_cost_budget_usd: row.budget_control.session_cost_budget_usd,
        session_token_budget: row.budget_control.session_token_budget,
      }));
  }

  function renderPolicies(payload) {
    const policies = extractPolicies(payload);
    if (!policies.length) {
      refs.policiesPanel.innerHTML = '<div class="empty-state">No effective local budget policies are active.</div>';
      return;
    }
    refs.policiesPanel.innerHTML = `
      <table class="usage-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Action</th>
            <th>Session Token Budget</th>
            <th>Daily Token Budget</th>
            <th>Session Cost Budget</th>
            <th>Daily Cost Budget</th>
          </tr>
        </thead>
        <tbody>
          ${policies
            .map(
              (row) => `
                <tr>
                  <td><span class="row-primary">${escapeHtml(row.agent_name || row.agent_id || "unknown")}</span></td>
                  <td><span class="pill ${row.action === "deny" ? "pill-danger" : "pill-warn"}">${escapeHtml(row.action || "steer")}</span></td>
                  <td>${escapeHtml(formatExact(row.session_token_budget || 0))}</td>
                  <td>${escapeHtml(formatExact(row.daily_token_budget || 0))}</td>
                  <td>${formatCurrency(row.session_cost_budget_usd || 0)}</td>
                  <td>${formatCurrency(row.daily_cost_budget_usd || 0)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderConsumers(payload) {
    const summary = payload.summary || {};
    const topAgents = Array.isArray(payload.top_agents) ? payload.top_agents : [];
    refs.consumersPanel.innerHTML = topAgents.length
      ? topAgents
          .map((row) => {
            const estimatedSpend = row.estimated_spend !== undefined ? row.estimated_spend : estimatedSpendFromShare(row.tokens, summary);
            return `
              <article class="stack-item">
                <h3>${escapeHtml(row.agent_name || "unknown-agent")}</h3>
                <p>${escapeHtml(row.connector || "unknown")} connector, ${escapeHtml(row.primary_model || "unknown")} primary model.</p>
                <div class="meta-row">
                  <span class="pill pill-info">${formatCount(row.tokens)} tokens</span>
                  <span class="pill pill-info">${formatCurrency(estimatedSpend)}</span>
                  ${row.budget_control && row.budget_control.has_open_alert ? '<span class="pill pill-danger">Open alert</span>' : ""}
                  ${row.runtime_only ? '<span class="pill pill-good">Policy only</span>' : ""}
                </div>
              </article>
            `;
          })
          .join("")
      : '<div class="empty-state">No agent consumers have been reported yet.</div>';
  }

  function renderSettings(payload, rowsPayload) {
    const debug = payload.debug || {};
    const gateway = debug.gateway || {};
    const galileo = debug.galileo || {};
    const settingsCards = [
      {
        detail: debug.fixture_backed ? "Summary is using fallback fixture data." : "Summary is sourced from the live DefenseClaw ledger.",
        label: "Summary Source",
        value: payload.source || "unknown",
      },
      {
        detail: rowsPayload.debug && rowsPayload.debug.fixture_backed ? "Detail rows are fixture-backed." : "Detail rows come from live usage observations.",
        label: "Usage Row Source",
        value: rowsPayload.source || "unknown",
      },
      {
        detail: galileo.project || galileo.project_id || "Galileo runtime config not attached.",
        label: "Galileo",
        value: galileo.api_key_configured ? "Configured" : "Not configured",
      },
      {
        detail: gateway.base_url || "Gateway not configured",
        label: "DefenseClaw Gateway",
        value: gateway.enabled ? (gateway.reachable === false ? "Degraded" : "Connected") : "Disabled",
      },
    ];
    refs.settingsCards.innerHTML = settingsCards
      .map(
        (card) => `
          <article class="settings-card">
            <span class="settings-label">${escapeHtml(card.label)}</span>
            <span class="settings-value">${escapeHtml(card.value)}</span>
            <span class="settings-detail">${escapeHtml(card.detail)}</span>
          </article>
        `,
      )
      .join("");

    const sourceItems = [
      {
        title: "Executive Banner",
        value: payload.executive_banner || "No executive deployment note was provided by the BFF.",
      },
      {
        title: "Requested Filters",
        value: JSON.stringify(debug.requested_filters || {}, null, 2),
      },
      {
        title: "Live Row Diagnostics",
        value: JSON.stringify(rowsPayload.debug || {}, null, 2),
      },
    ];
    refs.sourceDetails.innerHTML = sourceItems
      .map(
        (row) => `
          <article class="detail-item">
            <h3>${escapeHtml(row.title)}</h3>
            <p>${escapeHtml(row.value)}</p>
          </article>
        `,
      )
      .join("");

    const deepLinks = payload.deep_links || {};
    const deepLinkItems = Object.keys(deepLinks)
      .map((key) => ({
        href: safeExternalUrl(deepLinks[key]),
        label: key.replaceAll("_", " "),
      }))
      .filter((row) => row.href);
    refs.deepLinks.innerHTML = deepLinkItems.length
      ? deepLinkItems
          .map(
            (row) => `
              <article class="detail-item">
                <h3>${escapeHtml(row.label)}</h3>
                <p><a href="${escapeHtml(row.href)}" target="_blank" rel="noreferrer">${escapeHtml(row.href)}</a></p>
              </article>
            `,
          )
          .join("")
      : '<div class="empty-state">No deep links are available yet.</div>';
  }

  function render() {
    const payload = getSummaryPayload();
    const rowsPayload = state.rowPayload || { rows: [] };
    const rows = getUsageRows();
    const debug = payload.debug || {};
    const sourceLabel = debug.fixture_backed ? "Fixture-backed API" : "Live DefenseClaw ledger";

    refs.dataMode.textContent = sourceLabel;
    refs.updatedAt.textContent = `Updated ${formatDateTime(firstNonEmpty(rowsPayload.generated_at, payload.generated_at))}`;

    renderToolbar(payload, rows);
    renderSummaryCards(payload);
    renderBreakdown(payload, rows);
    renderBreachFeed(payload);
    renderUsageTable(rows);
    renderMetricCards(Array.isArray(payload.runtime_governance_cards) ? payload.runtime_governance_cards : [], refs.budgetCards);
    renderRecommendations(Array.isArray(payload.recommendations) ? payload.recommendations : [], refs.budgetRecommendations);
    renderPolicies(payload);
    renderConsumers(payload);
    refs.controlsEvidence.innerHTML = Array.isArray(payload.runtime_governance_evidence) && payload.runtime_governance_evidence.length
      ? payload.runtime_governance_evidence.map(evidenceItem).join("")
      : '<div class="empty-state">No control evidence is open.</div>';
    renderRecommendations(Array.isArray(payload.recommendations) ? payload.recommendations : [], refs.controlsRecommendations);
    renderSettings(payload, rowsPayload);
  }

  function activateView(viewName) {
    state.activeView = viewName;
    viewButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.view === viewName));
    Object.keys(refs.views).forEach((key) => refs.views[key].classList.toggle("hidden", key !== viewName));
    refs.surfaceChip.textContent = `Surface: ${viewLabels[viewName]}`;
  }

  function activateDimension(dimension) {
    state.activeDimension = dimension;
    dimensionButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.dimension === dimension));
    renderBreakdown(getSummaryPayload(), getUsageRows());
    renderUsageTable(getUsageRows());
  }

  async function refresh() {
    try {
      const [summaryResult, rowsResult] = await Promise.allSettled([fetchJson(summaryUrl), fetchJson(rowsUrl)]);
      if (summaryResult.status !== "fulfilled") {
        throw summaryResult.reason;
      }
      state.summaryPayload = summaryResult.value;
      state.rowPayload = rowsResult.status === "fulfilled" ? rowsResult.value : { rows: [] };
      render();

      const payload = getSummaryPayload();
      const evidenceCount = Array.isArray(payload.runtime_governance_evidence) ? payload.runtime_governance_evidence.length : 0;
      if (evidenceCount > 0) {
        setBanner("danger", `${evidenceCount} live budget evidence row${evidenceCount === 1 ? "" : "s"} detected in the current window.`);
        return;
      }
      if (rowsResult.status !== "fulfilled") {
        setBanner("warn", `Summary loaded but usage detail rows are unavailable: ${rowsResult.reason.message}`);
        return;
      }
      if (payload.debug && payload.debug.fixture_backed) {
        setBanner("warn", payload.executive_banner || "Tokenomics is running without live DefenseClaw usage observations yet.");
        return;
      }
      setBanner("", "");
    } catch (error) {
      setBanner("warn", `Unable to load live tokenomics summary: ${error.message}`);
    }
  }

  refs.tableSearch.addEventListener("input", function (event) {
    state.search = event.target.value || "";
    renderBreakdown(getSummaryPayload(), getUsageRows());
    renderUsageTable(getUsageRows());
  });

  viewButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const nextView = button.dataset.view || "cost";
      activateView(nextView);
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("view", nextView);
      window.history.replaceState({}, "", nextUrl);
    });
  });

  dimensionButtons.forEach((button) => {
    button.addEventListener("click", function () {
      activateDimension(button.dataset.dimension || "model");
    });
  });

  activateView(initialView);
  activateDimension("model");
  refresh();
  window.setInterval(refresh, 30000);
})();
