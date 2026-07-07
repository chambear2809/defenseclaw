(function () {
  const apiOrigin = (() => {
    const url = new URL(window.location.href);
    url.port = "8787";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.origin;
  })();
  const apiBase = `${apiOrigin}/v1/c3/agent-tokenomics`;

  const state = {
    alerts: [],
    policies: [],
    summary: null,
  };

  const summaryGrid = document.getElementById("summary-grid");
  const alertsList = document.getElementById("alerts-list");
  const policiesList = document.getElementById("policies-list");
  const statusBanner = document.getElementById("status-banner");
  const refreshButton = document.getElementById("refresh-button");
  const form = document.getElementById("policy-form");
  const releaseButton = document.getElementById("release-button");
  const embeddedFrame = document.getElementById("embedded-frame");

  function escapeHtml(value) {
    return String(value || "")
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

  function renderSummary() {
    const summary = state.summary && state.summary.summary ? state.summary.summary : null;
    const openAlerts = state.alerts.filter((row) => row.status === "open");
    const cost = summary && summary.cost ? summary.cost.total : 0;
    const cards = [
      {
        label: "Total Tokens",
        value: summary ? formatNumber(summary.total_tokens) : "0",
        detail: summary ? `${formatNumber(summary.request_count)} requests in current window` : "Waiting for summary",
      },
      {
        label: "Estimated Spend",
        value: summary && summary.cost ? formatCurrency(cost) : "$0.00",
        detail: summary && summary.cost ? `${summary.cost.pricing_status || "unknown"} pricing status` : "Fixture-backed summary",
      },
      {
        label: "Active Agents",
        value: summary ? formatNumber(summary.active_agents) : "0",
        detail: summary ? `${formatNumber(summary.session_count)} active sessions` : "No agents reported",
      },
      {
        label: "Open Budget Alerts",
        value: formatNumber(openAlerts.length),
        detail: openAlerts.length ? `${openAlerts.filter((row) => row.action === "deny").length} hard-stop alerts` : "No live budget breaches",
      },
    ];
    summaryGrid.innerHTML = cards
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
  }

  function renderAlerts() {
    const openAlerts = state.alerts.filter((row) => row.status === "open");
    if (!openAlerts.length) {
      alertsList.innerHTML = '<div class="empty-state">No live budget alerts are open right now.</div>';
      return;
    }
    alertsList.innerHTML = openAlerts
      .map((alert) => {
        const pillClass = alert.action === "deny" ? "pill-danger" : "pill-warn";
        const session = alert.session_id ? `Session ${escapeHtml(alert.session_id)}` : "Rolling 24h window";
        const owningPolicy = state.policies.find((policy) => policy.policy_id === alert.policy_id);
        const releaseAgentId = owningPolicy ? owningPolicy.agent_id : alert.agent_id;
        return `
          <article class="stack-item">
            <h4>${escapeHtml(alert.agent_name || alert.agent_id)}</h4>
            <p>${escapeHtml(alert.reason || "Budget threshold exceeded.")}</p>
            <div class="stack-meta">
              <span class="pill ${pillClass}">${escapeHtml(alert.action)}</span>
              <span class="pill pill-info">${escapeHtml(alert.window)} ${escapeHtml(alert.metric)}</span>
              <span class="pill pill-info">${session}</span>
            </div>
            <div class="stack-meta">
              <span>Observed: <strong>${escapeHtml(formatNumber(alert.observed_value))}</strong></span>
              <span>Budget: <strong>${escapeHtml(formatNumber(alert.budget_value))}</strong></span>
              <span>Updated: <strong>${escapeHtml(formatWhen(alert.updated_at))}</strong></span>
            </div>
            <div class="item-actions">
              <button class="button button-secondary" type="button" data-prefill-agent-id="${escapeHtml(alert.agent_id)}" data-prefill-agent-name="${escapeHtml(alert.agent_name || alert.agent_id)}">
                Use Agent
              </button>
              <button class="button button-secondary" type="button" data-release-agent-id="${escapeHtml(releaseAgentId)}">
                Release ${releaseAgentId === "*" ? "Catch-all Policy" : "Policy"}
              </button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderPolicies() {
    if (!state.policies.length) {
      policiesList.innerHTML = '<div class="empty-state">No effective local budget policies.</div>';
      return;
    }
    policiesList.innerHTML = state.policies
      .map((policy) => {
        const tokenBudget = `Session: ${formatNumber(policy.session_token_budget || 0)} tokens, daily: ${formatNumber(
          policy.daily_token_budget || 0,
        )} tokens`;
        const costBudget = `Session: ${formatCurrency(policy.session_cost_budget_usd || 0)}, daily: ${formatCurrency(
          policy.daily_cost_budget_usd || 0,
        )}`;
        return `
          <article class="stack-item">
            <h4>${escapeHtml(policy.agent_name || policy.agent_id)}</h4>
            <p>${escapeHtml(tokenBudget)}.</p>
            <p>${escapeHtml(costBudget)}.</p>
            <div class="stack-meta">
              <span class="pill ${policy.action === "deny" ? "pill-danger" : "pill-warn"}">${escapeHtml(policy.action)}</span>
              <span class="pill pill-info">Updated ${escapeHtml(formatWhen(policy.updated_at))}</span>
            </div>
            <div class="item-actions">
              <button class="button button-secondary" type="button" data-prefill-agent-id="${escapeHtml(policy.agent_id)}" data-prefill-agent-name="${escapeHtml(
                policy.agent_name || policy.agent_id,
              )}">
                Edit
              </button>
              <button class="button button-secondary" type="button" data-release-agent-id="${escapeHtml(policy.agent_id)}">
                Release
              </button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  async function refresh() {
    try {
      const [summary, alerts, policies] = await Promise.all([
        fetchJson(`${apiBase}/summary?include_galileo=true`),
        fetchJson(`${apiBase}/alerts?limit=100`),
        fetchJson(`${apiBase}/policies/effective`),
      ]);
      state.summary = summary;
      state.alerts = Array.isArray(alerts) ? alerts : [];
      state.policies = Array.isArray(policies) ? policies : [];
      renderSummary();
      renderAlerts();
      renderPolicies();

      const openAlerts = state.alerts.filter((row) => row.status === "open");
      const gatewayDebug = summary && summary.debug ? summary.debug.gateway : null;
      if (openAlerts.length) {
        setBanner("danger", `${openAlerts.length} live budget alert${openAlerts.length === 1 ? "" : "s"} detected. Apply or release policy from this page.`);
      } else if (gatewayDebug && gatewayDebug.enabled === false) {
        setBanner("warn", "Tokenomics is running in fixture mode. DefenseClaw gateway control is not configured.");
      } else if (gatewayDebug && gatewayDebug.error) {
        setBanner("warn", `DefenseClaw gateway is configured but unavailable: ${gatewayDebug.error.detail || gatewayDebug.error.error || gatewayDebug.error}`);
      } else {
        setBanner("", "");
      }
    } catch (error) {
      setBanner("warn", `Unable to refresh tokenomics control data: ${error.message}`);
    }
  }

  function syncEmbeddedFrameHeight() {
    if (!(embeddedFrame instanceof HTMLIFrameElement)) {
      return;
    }
    try {
      const doc = embeddedFrame.contentDocument || (embeddedFrame.contentWindow && embeddedFrame.contentWindow.document);
      if (!doc || !doc.documentElement) {
        return;
      }
      const nextHeight = Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0, 960);
      embeddedFrame.style.height = `${nextHeight + 24}px`;
    } catch (_error) {
      // Same-origin access is expected in the shell. If that changes, keep the default height.
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

  refreshButton.addEventListener("click", refresh);
  form.addEventListener("submit", applyPolicy);
  releaseButton.addEventListener("click", function () {
    releasePolicy("");
  });

  document.addEventListener("click", function (event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.dataset.prefillAgentId) {
      prefillAgent(target.dataset.prefillAgentId, target.dataset.prefillAgentName || target.dataset.prefillAgentId);
    }
    if (target.dataset.releaseAgentId) {
      releasePolicy(target.dataset.releaseAgentId);
    }
  });

  if (embeddedFrame instanceof HTMLIFrameElement) {
    embeddedFrame.addEventListener("load", function () {
      syncEmbeddedFrameHeight();
      window.setTimeout(syncEmbeddedFrameHeight, 600);
    });
    window.setInterval(syncEmbeddedFrameHeight, 2500);
  }

  refresh();
  window.setInterval(refresh, 30000);
})();
