// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package gateway

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/defenseclaw/defenseclaw/internal/audit"
)

func TestParseBudgetControlWindow(t *testing.T) {
	tests := []struct {
		raw     string
		want    time.Duration
		wantErr bool
	}{
		{raw: "", want: -24 * time.Hour},
		{raw: "1h", want: -time.Hour},
		{raw: "-24h", want: -24 * time.Hour},
		{raw: "-7d", want: -7 * 24 * time.Hour},
		{raw: "-365d", want: -365 * 24 * time.Hour},
		{raw: "-366d", wantErr: true},
		{raw: "-30m", wantErr: true},
		{raw: "-24h-junk", wantErr: true},
		{raw: "bad", wantErr: true},
	}
	for _, tt := range tests {
		got, err := parseBudgetControlWindow(tt.raw)
		if tt.wantErr {
			if err == nil {
				t.Fatalf("parseBudgetControlWindow(%q) expected error", tt.raw)
			}
			continue
		}
		if err != nil {
			t.Fatalf("parseBudgetControlWindow(%q): %v", tt.raw, err)
		}
		if got != tt.want {
			t.Fatalf("parseBudgetControlWindow(%q)=%v want %v", tt.raw, got, tt.want)
		}
	}
}

func TestParseBudgetControlLimit(t *testing.T) {
	if got, err := parseBudgetControlLimit("", 50); err != nil || got != 50 {
		t.Fatalf("default limit=(%d, %v), want (50, nil)", got, err)
	}
	for _, raw := range []string{"0", "5001", "10junk"} {
		if _, err := parseBudgetControlLimit(raw, 50); err == nil {
			t.Fatalf("parseBudgetControlLimit(%q) expected error", raw)
		}
	}
}

func TestBudgetDecisionVerdict_SteerIsVisibleAlert(t *testing.T) {
	verdict := budgetDecisionVerdict(&budgetControlDecision{
		Action:   "steer",
		Severity: "MEDIUM",
		Reason:   "session budget nearly exhausted",
		Findings: []string{"budget-control:session:tokens:steer"},
	})
	if verdict.Action != guardrailActionAlert || verdict.RawAction != guardrailActionAlert {
		t.Fatalf("verdict=%+v want visible nonblocking alert", verdict)
	}
	if verdict.Mode != "budget-control" {
		t.Fatalf("mode=%q want budget-control", verdict.Mode)
	}
}

func TestActiveBudgetDecision_StoreFailureDeniesFailClosed(t *testing.T) {
	store, err := audit.NewStore(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	if err := store.Init(); err != nil {
		t.Fatalf("Store.Init: %v", err)
	}
	manager := newBudgetControlManager(store, nil)
	if err := store.Close(); err != nil {
		t.Fatalf("Store.Close: %v", err)
	}

	api := &APIServer{budgetControl: manager}
	decision := api.activeBudgetDecision(budgetControlSubject{AgentID: "main"})
	if decision == nil || decision.Action != "deny" || decision.Severity != "HIGH" {
		t.Fatalf("decision=%+v want fail-closed deny", decision)
	}
	if len(decision.Findings) != 1 || decision.Findings[0] != "budget-control:state:error:deny" {
		t.Fatalf("findings=%v want budget-control state error", decision.Findings)
	}
}

func TestHandleBudgetControlUsageObservations(t *testing.T) {
	store, err := audit.NewStore(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatalf("Store.Init: %v", err)
	}
	if err := store.InsertBudgetUsageObservation(audit.BudgetUsageObservation{
		ID:               "obs-1",
		Timestamp:        time.Now().UTC(),
		Source:           "hook",
		Connector:        "langgraph,mcp",
		AgentID:          "incident-triage-agent",
		AgentName:        "incident-triage-agent",
		SessionID:        "sess-1",
		Model:            "gpt-4o-mini",
		PromptTokens:     1200,
		CompletionTokens: 300,
		TotalTokens:      1500,
		CostUSD:          0.15,
	}); err != nil {
		t.Fatalf("InsertBudgetUsageObservation: %v", err)
	}

	api := &APIServer{
		store:         store,
		budgetControl: newBudgetControlManager(store, nil),
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/budget-control/usage/observations?window=-24h&limit=10", nil)
	rec := httptest.NewRecorder()
	api.handleBudgetControlUsageObservations(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var rows []audit.BudgetUsageObservation
	if err := json.Unmarshal(rec.Body.Bytes(), &rows); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows=%d want 1", len(rows))
	}
	if rows[0].ID != "obs-1" {
		t.Fatalf("rows[0].ID=%q want obs-1", rows[0].ID)
	}
}

func TestBudgetControlApplyPolicy_EvaluatesExistingDailyUsage(t *testing.T) {
	store, err := audit.NewStore(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatalf("Store.Init: %v", err)
	}
	manager := newBudgetControlManager(store, nil)
	now := time.Date(2026, time.July, 6, 23, 45, 0, 0, time.UTC)
	manager.now = func() time.Time { return now }

	if err := store.InsertBudgetUsageObservation(audit.BudgetUsageObservation{
		ID:          "obs-1",
		Timestamp:   now.Add(-15 * time.Minute),
		Source:      "openclaw_usage_snapshot",
		Connector:   "openclaw",
		AgentID:     "openclaw",
		AgentName:   "openclaw",
		Model:       "gpt-4o-mini",
		TotalTokens: 2500,
		CostUSD:     12.5,
	}); err != nil {
		t.Fatalf("InsertBudgetUsageObservation: %v", err)
	}

	row, err := manager.ApplyPolicy(budgetControlApplyRequest{
		AgentID:          "openclaw",
		AgentName:        "openclaw",
		DailyTokenBudget: 2000,
		Action:           "deny",
	})
	if err != nil {
		t.Fatalf("ApplyPolicy: %v", err)
	}
	if row == nil {
		t.Fatal("ApplyPolicy returned nil row")
	}

	alerts, err := manager.ListAlerts(10)
	if err != nil {
		t.Fatalf("ListAlerts: %v", err)
	}
	if len(alerts) != 1 {
		t.Fatalf("alerts=%d want 1", len(alerts))
	}
	if alerts[0].AgentID != "openclaw" {
		t.Fatalf("alert agent_id=%q want openclaw", alerts[0].AgentID)
	}
	if alerts[0].Status != "open" {
		t.Fatalf("alert status=%q want open", alerts[0].Status)
	}
	if alerts[0].Metric != "tokens" || alerts[0].Window != "daily" {
		t.Fatalf("alert=%+v want daily token breach", alerts[0])
	}
}

func TestBudgetControlBreachLifecycleEmitsAuditTransitions(t *testing.T) {
	store, err := audit.NewStore(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatalf("Store.Init: %v", err)
	}
	manager := newBudgetControlManager(store, audit.NewLogger(store))
	if _, err := manager.ApplyPolicy(budgetControlApplyRequest{
		AgentID:          "audit-agent",
		DailyTokenBudget: 50,
		Action:           "deny",
	}); err != nil {
		t.Fatalf("ApplyPolicy: %v", err)
	}
	if err := manager.ObserveUsage(t.Context(), audit.BudgetUsageObservation{
		ID:          "audit-agent-usage",
		Timestamp:   time.Now().UTC(),
		Source:      "test",
		AgentID:     "audit-agent",
		TotalTokens: 100,
	}); err != nil {
		t.Fatalf("ObserveUsage: %v", err)
	}
	// Re-observing the same stable interval updates the open alert without
	// producing another lifecycle event.
	if err := manager.ObserveUsageUpsert(t.Context(), audit.BudgetUsageObservation{
		ID:          "audit-agent-usage",
		Timestamp:   time.Now().UTC(),
		Source:      "test",
		AgentID:     "audit-agent",
		TotalTokens: 100,
	}); err != nil {
		t.Fatalf("ObserveUsageUpsert: %v", err)
	}
	if _, err := manager.ApplyPolicy(budgetControlApplyRequest{
		AgentID:          "audit-agent",
		DailyTokenBudget: 200,
		Action:           "deny",
	}); err != nil {
		t.Fatalf("ApplyPolicy resolve: %v", err)
	}

	events, err := store.ListEvents(10)
	if err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("lifecycle events=%d want 2: %+v", len(events), events)
	}
	if events[0].Action != "budget-control-breach-resolved" || events[1].Action != "budget-control-breach" {
		t.Fatalf("lifecycle actions=%q,%q", events[0].Action, events[1].Action)
	}
}

func TestBudgetControlApplyPolicy_RejectsNegativeThreshold(t *testing.T) {
	store, err := audit.NewStore(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatalf("Store.Init: %v", err)
	}
	manager := newBudgetControlManager(store, nil)
	_, err = manager.ApplyPolicy(budgetControlApplyRequest{
		AgentID:            "main",
		SessionTokenBudget: -1,
		DailyTokenBudget:   100,
		Action:             "deny",
	})
	if err == nil || !strings.Contains(err.Error(), "cannot be negative") {
		t.Fatalf("ApplyPolicy error=%v want negative-threshold rejection", err)
	}
}

func TestBudgetControlApplyPolicy_NormalizesAgentIDAndRejectsNonFiniteCost(t *testing.T) {
	store, err := audit.NewStore(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatalf("Store.Init: %v", err)
	}
	manager := newBudgetControlManager(store, nil)

	policy, err := manager.ApplyPolicy(budgetControlApplyRequest{
		AgentID:          "  main  ",
		AgentName:        "  Primary Agent  ",
		DailyTokenBudget: 100,
		Action:           "deny",
	})
	if err != nil {
		t.Fatalf("ApplyPolicy: %v", err)
	}
	if policy.AgentID != "main" || policy.AgentName != "Primary Agent" {
		t.Fatalf("policy identifiers were not normalized: %+v", policy)
	}
	if _, err := manager.ApplyPolicy(budgetControlApplyRequest{
		AgentID:            "main",
		DailyCostBudgetUSD: math.NaN(),
	}); err == nil || !strings.Contains(err.Error(), "must be finite") {
		t.Fatalf("non-finite cost error=%v", err)
	}
}

func TestBudgetControlApplyPolicy_CatchAllReconcilesConcreteAgents(t *testing.T) {
	store, err := audit.NewStore(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatalf("Store.Init: %v", err)
	}
	manager := newBudgetControlManager(store, nil)
	now := time.Date(2026, time.July, 7, 4, 0, 0, 0, time.UTC)
	manager.now = func() time.Time { return now }
	if err := manager.ObserveUsage(t.Context(), audit.BudgetUsageObservation{
		ID:          "existing-main-usage",
		Timestamp:   now.Add(-time.Minute),
		Source:      "openclaw_session_snapshot",
		Connector:   "openclaw",
		AgentID:     "main",
		AgentName:   "Primary OpenClaw Agent",
		SessionID:   "session-main",
		TotalTokens: 100,
	}); err != nil {
		t.Fatalf("ObserveUsage: %v", err)
	}

	policy, err := manager.ApplyPolicy(budgetControlApplyRequest{
		AgentID:          "*",
		AgentName:        "All agents",
		DailyTokenBudget: 50,
		Action:           "deny",
	})
	if err != nil {
		t.Fatalf("ApplyPolicy: %v", err)
	}
	if policy == nil || policy.AgentID != "*" {
		t.Fatalf("policy=%+v want catch-all", policy)
	}
	alerts, err := manager.ListAlerts(10)
	if err != nil {
		t.Fatalf("ListAlerts: %v", err)
	}
	if len(alerts) != 1 || alerts[0].AgentID != "main" || alerts[0].Status != "open" {
		t.Fatalf("alerts=%+v want concrete main agent breach", alerts)
	}
	decision, err := manager.ActiveDecision(budgetControlSubject{AgentID: "main", SessionID: "session-main"})
	if err != nil {
		t.Fatalf("ActiveDecision: %v", err)
	}
	if decision == nil || decision.Action != "deny" {
		t.Fatalf("decision=%+v want catch-all deny", decision)
	}
}

func TestInspectRequestBudgetDecision_UsesSessionLedgerAgent(t *testing.T) {
	store, err := audit.NewStore(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatalf("Store.Init: %v", err)
	}
	manager := newBudgetControlManager(store, nil)
	now := time.Date(2026, time.July, 7, 2, 58, 0, 0, time.UTC)
	manager.now = func() time.Time { return now }

	if err := store.InsertBudgetUsageObservation(audit.BudgetUsageObservation{
		ID:          "obs-main-1",
		Timestamp:   now.Add(-1 * time.Minute),
		Source:      "openclaw_session_snapshot",
		Connector:   "openclaw",
		AgentID:     "main",
		AgentName:   "main",
		SessionID:   "sess-main-live",
		Model:       "gpt-4o-mini",
		TotalTokens: 63345,
	}); err != nil {
		t.Fatalf("InsertBudgetUsageObservation: %v", err)
	}
	if _, err := manager.ApplyPolicy(budgetControlApplyRequest{
		AgentID:            "main",
		AgentName:          "main",
		SessionTokenBudget: 50000,
		DailyTokenBudget:   60000,
		Action:             "deny",
	}); err != nil {
		t.Fatalf("ApplyPolicy: %v", err)
	}

	api := &APIServer{
		store:         store,
		logger:        audit.NewLogger(store),
		budgetControl: manager,
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/inspect/request",
		strings.NewReader(`{"content":"Reply with exactly OK","model":"gpt-4o-mini","session_id":"sess-main-live"}`))
	rec := httptest.NewRecorder()
	api.handleInspectRequest(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var verdict ToolInspectVerdict
	if err := json.Unmarshal(rec.Body.Bytes(), &verdict); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	if verdict.Action != "block" {
		t.Fatalf("action=%q want block", verdict.Action)
	}
	if verdict.RawAction != "block" {
		t.Fatalf("raw_action=%q want block", verdict.RawAction)
	}
	if !strings.Contains(verdict.Reason, "rolling 24h token budget exceeded for main: 63345 > 60000") {
		t.Fatalf("reason=%q missing daily budget breach", verdict.Reason)
	}
	events, err := store.ListEvents(10)
	if err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
	if len(events) != 1 || events[0].Action != "budget-control-deny" || events[0].Target != "pre-request" {
		t.Fatalf("budget enforcement audit events=%+v", events)
	}
}

func TestInspectBudgetDecision_PrecedesEmptyContentAllow(t *testing.T) {
	store, err := audit.NewStore(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatalf("Store.Init: %v", err)
	}
	manager := newBudgetControlManager(store, nil)
	now := time.Date(2026, time.July, 7, 6, 30, 0, 0, time.UTC)
	manager.now = func() time.Time { return now }
	if err := manager.ObserveUsage(t.Context(), audit.BudgetUsageObservation{
		ID:          "empty-content-budget-usage",
		Timestamp:   now.Add(-time.Minute),
		Source:      "openclaw_session_snapshot",
		Connector:   "openclaw",
		AgentID:     "main",
		SessionID:   "empty-content-session",
		TotalTokens: 100,
	}); err != nil {
		t.Fatalf("ObserveUsage: %v", err)
	}
	if _, err := manager.ApplyPolicy(budgetControlApplyRequest{
		AgentID:            "main",
		SessionTokenBudget: 50,
		Action:             "deny",
	}); err != nil {
		t.Fatalf("ApplyPolicy: %v", err)
	}

	api := &APIServer{store: store, budgetControl: manager}
	tests := []struct {
		name    string
		handler http.HandlerFunc
		path    string
	}{
		{name: "request", handler: api.handleInspectRequest, path: "/api/v1/inspect/request"},
		{name: "response", handler: api.handleInspectResponse, path: "/api/v1/inspect/response"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, tt.path,
				strings.NewReader(`{"content":"","session_id":"empty-content-session"}`))
			rec := httptest.NewRecorder()
			tt.handler(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
			var verdict ToolInspectVerdict
			if err := json.Unmarshal(rec.Body.Bytes(), &verdict); err != nil {
				t.Fatalf("json.Unmarshal: %v", err)
			}
			if verdict.Action != guardrailActionBlock {
				t.Fatalf("verdict=%+v want budget block", verdict)
			}
		})
	}
}

func TestBudgetControlApplyPolicy_ReconcilesExistingSessionAlerts(t *testing.T) {
	store, err := audit.NewStore(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatalf("Store.Init: %v", err)
	}
	manager := newBudgetControlManager(store, nil)
	now := time.Date(2026, time.July, 7, 3, 30, 0, 0, time.UTC)
	manager.now = func() time.Time { return now }

	if err := manager.ObserveUsage(t.Context(), audit.BudgetUsageObservation{
		ID:          "session-usage",
		Timestamp:   now.Add(-time.Minute),
		Source:      "openclaw_session_snapshot",
		Connector:   "openclaw",
		AgentID:     "main",
		SessionID:   "session-a",
		TotalTokens: 100,
	}); err != nil {
		t.Fatalf("ObserveUsage: %v", err)
	}
	first, err := manager.ApplyPolicy(budgetControlApplyRequest{
		AgentID:            "main",
		SessionTokenBudget: 50,
		Action:             "deny",
	})
	if err != nil {
		t.Fatalf("first ApplyPolicy: %v", err)
	}
	alerts, err := manager.ListAlerts(10)
	if err != nil {
		t.Fatalf("ListAlerts after first apply: %v", err)
	}
	if len(alerts) != 1 || alerts[0].Status != "open" || alerts[0].SessionID != "session-a" {
		t.Fatalf("alerts=%+v want one open session-a alert", alerts)
	}

	// A sessionless usage event only reconciles daily scope and must not
	// resolve the existing session alert.
	if err := manager.ObserveUsage(t.Context(), audit.BudgetUsageObservation{
		ID:          "sessionless-usage",
		Timestamp:   now,
		Source:      "otlp",
		Connector:   "codex",
		AgentID:     "main",
		TotalTokens: 1,
	}); err != nil {
		t.Fatalf("sessionless ObserveUsage: %v", err)
	}
	alerts, err = manager.ListAlerts(10)
	if err != nil {
		t.Fatalf("ListAlerts after sessionless usage: %v", err)
	}
	if len(alerts) != 1 || alerts[0].Status != "open" {
		t.Fatalf("sessionless reconciliation changed session alert: %+v", alerts)
	}

	second, err := manager.ApplyPolicy(budgetControlApplyRequest{
		AgentID:            "main",
		SessionTokenBudget: 200,
		Action:             "steer",
	})
	if err != nil {
		t.Fatalf("second ApplyPolicy: %v", err)
	}
	if second.PolicyID != first.PolicyID {
		t.Fatalf("policy id changed across update: %q -> %q", first.PolicyID, second.PolicyID)
	}
	alerts, err = manager.ListAlerts(10)
	if err != nil {
		t.Fatalf("ListAlerts after second apply: %v", err)
	}
	if len(alerts) != 1 || alerts[0].Status != "resolved" {
		t.Fatalf("alerts=%+v want prior session alert resolved", alerts)
	}
}

func TestBudgetControlReleasePolicy_ReleasesAllCatchAllAlerts(t *testing.T) {
	store, err := audit.NewStore(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatalf("Store.Init: %v", err)
	}
	manager := newBudgetControlManager(store, nil)
	now := time.Date(2026, time.July, 7, 6, 0, 0, 0, time.UTC)
	manager.now = func() time.Time { return now }

	for index, agentID := range []string{"main", "incident-agent"} {
		if err := manager.ObserveUsage(t.Context(), audit.BudgetUsageObservation{
			ID:          fmt.Sprintf("usage-%d", index),
			Timestamp:   now.Add(-time.Minute),
			Source:      "openclaw_session_snapshot",
			Connector:   "openclaw",
			AgentID:     agentID,
			SessionID:   fmt.Sprintf("session-%d", index),
			TotalTokens: 100,
		}); err != nil {
			t.Fatalf("ObserveUsage(%s): %v", agentID, err)
		}
	}
	if _, err := manager.ApplyPolicy(budgetControlApplyRequest{
		AgentID:            "*",
		SessionTokenBudget: 50,
		DailyTokenBudget:   50,
		Action:             "deny",
	}); err != nil {
		t.Fatalf("ApplyPolicy: %v", err)
	}

	before, err := manager.ListAlerts(20)
	if err != nil {
		t.Fatalf("ListAlerts before release: %v", err)
	}
	if len(before) != 4 {
		t.Fatalf("alerts before release=%d want 4", len(before))
	}
	if err := manager.ReleasePolicy(budgetControlReleaseRequest{AgentID: "*", SessionID: "session-0"}); err != nil {
		t.Fatalf("ReleasePolicy: %v", err)
	}
	policies, err := manager.ListEffectivePolicies("")
	if err != nil {
		t.Fatalf("ListEffectivePolicies: %v", err)
	}
	if len(policies) != 0 {
		t.Fatalf("policies after release=%+v want none", policies)
	}
	after, err := manager.ListAlerts(20)
	if err != nil {
		t.Fatalf("ListAlerts after release: %v", err)
	}
	for _, alert := range after {
		if alert.Status != "released" {
			t.Fatalf("alert remained open after catch-all release: %+v", alert)
		}
	}
}

func TestObserveBudgetOTLPUsage_SkipsOpenClawAuthoritativeSnapshotOverlap(t *testing.T) {
	store, err := audit.NewStore(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatalf("Store.Init: %v", err)
	}
	api := &APIServer{store: store, budgetControl: newBudgetControlManager(store, nil)}
	usage := []otelTokenUsage{{
		agentID:   "main",
		agentName: "main",
		sessionID: "session-a",
		model:     "gpt-4o-mini",
		tokenType: "input",
		tokens:    100,
	}}

	api.observeBudgetOTLPUsage("openclaw", "session-a", usage)
	rows, err := store.ListBudgetUsageObservationsSince(time.Now().Add(-time.Minute), 10)
	if err != nil {
		t.Fatalf("ListBudgetUsageObservationsSince: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("OpenClaw OTLP duplicated authoritative snapshot ledger: %+v", rows)
	}

	api.observeBudgetOTLPUsage("codex", "session-a", usage)
	rows, err = store.ListBudgetUsageObservationsSince(time.Now().Add(-time.Minute), 10)
	if err != nil {
		t.Fatalf("ListBudgetUsageObservationsSince after codex: %v", err)
	}
	if len(rows) != 1 || rows[0].TotalTokens != 100 {
		t.Fatalf("non-OpenClaw OTLP usage was not promoted: %+v", rows)
	}
}

func TestObserveBudgetOTLPUsage_DoesNotDoubleCountExplicitTotal(t *testing.T) {
	store, err := audit.NewStore(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatalf("Store.Init: %v", err)
	}
	api := &APIServer{store: store, budgetControl: newBudgetControlManager(store, nil)}
	usage := []otelTokenUsage{
		{agentID: "agent-a", sessionID: "session-a", model: "model-a", tokenType: "input", tokens: 70},
		{agentID: "agent-a", sessionID: "session-a", model: "model-a", tokenType: "output", tokens: 30},
		{agentID: "agent-a", sessionID: "session-a", model: "model-a", tokenType: "total", tokens: 100},
	}

	api.observeBudgetOTLPUsage("codex", "session-a", usage)
	rows, err := store.ListBudgetUsageObservationsSince(time.Now().Add(-time.Minute), 10)
	if err != nil {
		t.Fatalf("ListBudgetUsageObservationsSince: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows=%d want 1: %+v", len(rows), rows)
	}
	if rows[0].PromptTokens != 70 || rows[0].CompletionTokens != 30 || rows[0].TotalTokens != 100 {
		t.Fatalf("usage was double-counted: %+v", rows[0])
	}
}

func TestSaturatingBudgetTokenAdd(t *testing.T) {
	if got := saturatingBudgetTokenAdd(math.MaxInt64-2, 3); got != math.MaxInt64 {
		t.Fatalf("overflow result=%d want %d", got, int64(math.MaxInt64))
	}
	if got := saturatingBudgetTokenAdd(10, -1); got != 10 {
		t.Fatalf("negative delta result=%d want 10", got)
	}
}
