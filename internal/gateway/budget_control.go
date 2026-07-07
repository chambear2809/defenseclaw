// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: Apache-2.0

package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/defenseclaw/defenseclaw/internal/audit"
	"github.com/defenseclaw/defenseclaw/internal/redaction"
	"github.com/defenseclaw/defenseclaw/internal/telemetry"
)

type budgetControlManager struct {
	store  *audit.Store
	logger *audit.Logger
	otel   *telemetry.Provider
	now    func() time.Time
}

type budgetControlSubject struct {
	Connector string
	AgentID   string
	AgentName string
	SessionID string
}

func (m *budgetControlManager) SetOTelProvider(provider *telemetry.Provider) {
	if m != nil {
		m.otel = provider
	}
}

type budgetControlDecision struct {
	Action   string
	Severity string
	Reason   string
	Findings []string
}

type budgetControlBreach struct {
	AlertKey string
	Window   string
	Metric   string
	Action   string
	Reason   string
	Observed float64
	Budget   float64
}

type budgetControlApplyRequest struct {
	AgentID              string  `json:"agent_id"`
	AgentName            string  `json:"agent_name,omitempty"`
	SessionTokenBudget   int64   `json:"session_token_budget,omitempty"`
	SessionCostBudgetUSD float64 `json:"session_cost_budget_usd,omitempty"`
	DailyTokenBudget     int64   `json:"daily_token_budget,omitempty"`
	DailyCostBudgetUSD   float64 `json:"daily_cost_budget_usd,omitempty"`
	Action               string  `json:"action,omitempty"`
	UpdatedBy            string  `json:"updated_by,omitempty"`
	Source               string  `json:"source,omitempty"`
}

type budgetControlReleaseRequest struct {
	AgentID string `json:"agent_id"`
	// SessionID is accepted for backwards compatibility. Policies are scoped
	// to agents, so release always removes the policy and all of its alerts.
	SessionID string `json:"session_id,omitempty"`
}

const (
	maxBudgetControlReadLimit = 5000
	maxBudgetControlLookback  = 365 * 24 * time.Hour
)

func newBudgetControlManager(store *audit.Store, logger *audit.Logger) *budgetControlManager {
	if store == nil {
		return nil
	}
	return &budgetControlManager{
		store:  store,
		logger: logger,
		now:    func() time.Time { return time.Now().UTC() },
	}
}

func normalizeBudgetPolicyAction(action string) string {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "steer", "alert", "warn":
		return "steer"
	default:
		return "deny"
	}
}

func (m *budgetControlManager) ApplyPolicy(req budgetControlApplyRequest) (*audit.BudgetPolicyRow, error) {
	if m == nil || m.store == nil {
		return nil, fmt.Errorf("budget control unavailable")
	}
	req.AgentID = strings.TrimSpace(req.AgentID)
	req.AgentName = strings.TrimSpace(req.AgentName)
	if req.AgentID == "" {
		return nil, fmt.Errorf("agent_id is required")
	}
	if req.SessionTokenBudget < 0 || req.SessionCostBudgetUSD < 0 ||
		req.DailyTokenBudget < 0 || req.DailyCostBudgetUSD < 0 {
		return nil, fmt.Errorf("budget thresholds cannot be negative")
	}
	if math.IsNaN(req.SessionCostBudgetUSD) || math.IsInf(req.SessionCostBudgetUSD, 0) ||
		math.IsNaN(req.DailyCostBudgetUSD) || math.IsInf(req.DailyCostBudgetUSD, 0) {
		return nil, fmt.Errorf("cost budget thresholds must be finite")
	}
	if req.SessionTokenBudget <= 0 && req.SessionCostBudgetUSD <= 0 &&
		req.DailyTokenBudget <= 0 && req.DailyCostBudgetUSD <= 0 {
		return nil, fmt.Errorf("at least one budget threshold is required")
	}
	existing, err := m.store.ResolveBudgetPolicy(req.AgentID)
	if err != nil {
		return nil, err
	}
	now := m.now()
	row := audit.BudgetPolicyRow{
		PolicyID:             "",
		AgentID:              req.AgentID,
		AgentName:            req.AgentName,
		SessionTokenBudget:   req.SessionTokenBudget,
		SessionCostBudgetUSD: req.SessionCostBudgetUSD,
		DailyTokenBudget:     req.DailyTokenBudget,
		DailyCostBudgetUSD:   req.DailyCostBudgetUSD,
		Action:               normalizeBudgetPolicyAction(req.Action),
		UpdatedAt:            now,
		UpdatedBy:            firstNonEmpty(req.UpdatedBy, "c3-tokenomics-ui"),
		Source:               firstNonEmpty(req.Source, "local"),
	}
	if existing != nil && existing.AgentID == req.AgentID {
		// Alert keys include policy_id. Preserve it across edits so updating
		// a threshold or action cannot orphan an older open alert.
		row.PolicyID = existing.PolicyID
	}
	if err := m.store.UpsertBudgetPolicy(row); err != nil {
		return nil, err
	}
	resolved, err := m.store.ResolveBudgetPolicy(req.AgentID)
	if err != nil || resolved == nil {
		return resolved, err
	}
	usageSubjects, err := m.store.ListBudgetUsageSubjects(req.AgentID, 5000)
	if err != nil {
		return nil, err
	}
	agents := map[string]budgetControlSubject{}
	if req.AgentID != "*" {
		agents[req.AgentID] = budgetControlSubject{
			AgentID:   req.AgentID,
			AgentName: firstNonEmpty(req.AgentName, resolved.AgentName, req.AgentID),
		}
	}
	for _, usageSubject := range usageSubjects {
		if _, ok := agents[usageSubject.AgentID]; !ok {
			agents[usageSubject.AgentID] = budgetControlSubject{
				AgentID:   usageSubject.AgentID,
				AgentName: firstNonEmpty(usageSubject.AgentName, usageSubject.AgentID),
			}
		}
	}
	// Reconcile daily scope once per concrete agent. For a catch-all policy,
	// evaluating the literal "*" would miss every existing ledger row.
	for _, subject := range agents {
		_, _, breaches, err := m.evaluateSubject(subject)
		if err != nil {
			return nil, err
		}
		if err := m.syncAlerts(*resolved, subject, breaches); err != nil {
			return nil, err
		}
	}
	// Session thresholds are reconciled immediately for every known session;
	// waiting for another model call would enforce correctly but leave C3's
	// alert feed stale after the policy was applied or edited.
	for _, usageSubject := range usageSubjects {
		if usageSubject.SessionID == "" {
			continue
		}
		sessionSubject := agents[usageSubject.AgentID]
		sessionSubject.SessionID = usageSubject.SessionID
		_, _, breaches, err := m.evaluateSubject(sessionSubject)
		if err != nil {
			return nil, err
		}
		if err := m.syncAlerts(*resolved, sessionSubject, breaches); err != nil {
			return nil, err
		}
	}
	return resolved, nil
}

func (m *budgetControlManager) ReleasePolicy(req budgetControlReleaseRequest) error {
	if m == nil || m.store == nil {
		return fmt.Errorf("budget control unavailable")
	}
	req.AgentID = strings.TrimSpace(req.AgentID)
	if req.AgentID == "" {
		return fmt.Errorf("agent_id is required")
	}
	return m.store.DeleteBudgetPolicyAndReleaseAlerts(req.AgentID, m.now())
}

func (m *budgetControlManager) ListEffectivePolicies(agentID string) ([]audit.BudgetPolicyRow, error) {
	if m == nil || m.store == nil {
		return nil, fmt.Errorf("budget control unavailable")
	}
	if strings.TrimSpace(agentID) == "" {
		return m.store.ListBudgetPolicies()
	}
	row, err := m.store.ResolveBudgetPolicy(agentID)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return []audit.BudgetPolicyRow{}, nil
	}
	return []audit.BudgetPolicyRow{*row}, nil
}

func (m *budgetControlManager) ListAlerts(limit int) ([]audit.BudgetAlertRow, error) {
	if m == nil || m.store == nil {
		return nil, fmt.Errorf("budget control unavailable")
	}
	return m.store.ListBudgetAlerts(limit)
}

func (m *budgetControlManager) ObserveUsage(ctx context.Context, obs audit.BudgetUsageObservation) error {
	return m.observeUsage(ctx, obs, false)
}

func (m *budgetControlManager) ObserveUsageUpsert(ctx context.Context, obs audit.BudgetUsageObservation) error {
	return m.observeUsage(ctx, obs, true)
}

func (m *budgetControlManager) observeUsage(ctx context.Context, obs audit.BudgetUsageObservation, upsert bool) error {
	if m == nil || m.store == nil || strings.TrimSpace(obs.AgentID) == "" {
		return nil
	}
	var err error
	if upsert {
		err = m.store.UpsertBudgetUsageObservation(obs)
	} else {
		err = m.store.InsertBudgetUsageObservation(obs)
	}
	if err != nil {
		return err
	}
	policy, _, breaches, err := m.evaluateSubject(budgetControlSubject{
		Connector: obs.Connector,
		AgentID:   obs.AgentID,
		AgentName: obs.AgentName,
		SessionID: obs.SessionID,
	})
	if err != nil || policy == nil {
		return err
	}
	return m.syncAlerts(*policy, budgetControlSubject{
		Connector: obs.Connector,
		AgentID:   obs.AgentID,
		AgentName: obs.AgentName,
		SessionID: obs.SessionID,
	}, breaches)
}

func (m *budgetControlManager) ActiveDecision(subject budgetControlSubject) (*budgetControlDecision, error) {
	policy, _, breaches, err := m.evaluateSubject(subject)
	if err != nil || policy == nil || len(breaches) == 0 {
		return nil, err
	}
	decision := &budgetControlDecision{
		Action:   "steer",
		Severity: "MEDIUM",
	}
	reasons := make([]string, 0, len(breaches))
	for _, breach := range breaches {
		reasons = append(reasons, breach.Reason)
		decision.Findings = append(decision.Findings, budgetControlFinding(breach))
		if breach.Action == "deny" {
			decision.Action = "deny"
			decision.Severity = "HIGH"
		}
	}
	decision.Reason = strings.Join(reasons, "; ")
	return decision, nil
}

func (m *budgetControlManager) evaluateSubject(subject budgetControlSubject) (*audit.BudgetPolicyRow, audit.BudgetUsageTotals, []budgetControlBreach, error) {
	if m == nil || m.store == nil || strings.TrimSpace(subject.AgentID) == "" {
		return nil, audit.BudgetUsageTotals{}, nil, nil
	}
	policy, err := m.store.ResolveBudgetPolicy(subject.AgentID)
	if err != nil || policy == nil {
		return policy, audit.BudgetUsageTotals{}, nil, err
	}
	totals, err := m.store.BudgetUsageTotals(subject.AgentID, subject.SessionID, m.now())
	if err != nil {
		return nil, audit.BudgetUsageTotals{}, nil, err
	}
	action := normalizeBudgetPolicyAction(policy.Action)
	var breaches []budgetControlBreach
	if subject.SessionID != "" && policy.SessionTokenBudget > 0 && totals.SessionTokens > policy.SessionTokenBudget {
		breaches = append(breaches, budgetControlBreach{
			AlertKey: budgetAlertKey(policy.PolicyID, subject.AgentID, subject.SessionID, "session", "tokens"),
			Window:   "session",
			Metric:   "tokens",
			Action:   action,
			Observed: float64(totals.SessionTokens),
			Budget:   float64(policy.SessionTokenBudget),
			Reason:   fmt.Sprintf("session token budget exceeded for %s: %.0f > %.0f", subject.AgentID, float64(totals.SessionTokens), float64(policy.SessionTokenBudget)),
		})
	}
	if subject.SessionID != "" && policy.SessionCostBudgetUSD > 0 && totals.SessionCostUSD > policy.SessionCostBudgetUSD {
		breaches = append(breaches, budgetControlBreach{
			AlertKey: budgetAlertKey(policy.PolicyID, subject.AgentID, subject.SessionID, "session", "cost_usd"),
			Window:   "session",
			Metric:   "cost_usd",
			Action:   action,
			Observed: totals.SessionCostUSD,
			Budget:   policy.SessionCostBudgetUSD,
			Reason:   fmt.Sprintf("session cost budget exceeded for %s: %.4f > %.4f USD", subject.AgentID, totals.SessionCostUSD, policy.SessionCostBudgetUSD),
		})
	}
	if policy.DailyTokenBudget > 0 && totals.DailyTokens > policy.DailyTokenBudget {
		breaches = append(breaches, budgetControlBreach{
			AlertKey: budgetAlertKey(policy.PolicyID, subject.AgentID, "", "daily", "tokens"),
			Window:   "daily",
			Metric:   "tokens",
			Action:   action,
			Observed: float64(totals.DailyTokens),
			Budget:   float64(policy.DailyTokenBudget),
			Reason:   fmt.Sprintf("rolling 24h token budget exceeded for %s: %.0f > %.0f", subject.AgentID, float64(totals.DailyTokens), float64(policy.DailyTokenBudget)),
		})
	}
	if policy.DailyCostBudgetUSD > 0 && totals.DailyCostUSD > policy.DailyCostBudgetUSD {
		breaches = append(breaches, budgetControlBreach{
			AlertKey: budgetAlertKey(policy.PolicyID, subject.AgentID, "", "daily", "cost_usd"),
			Window:   "daily",
			Metric:   "cost_usd",
			Action:   action,
			Observed: totals.DailyCostUSD,
			Budget:   policy.DailyCostBudgetUSD,
			Reason:   fmt.Sprintf("rolling 24h cost budget exceeded for %s: %.4f > %.4f USD", subject.AgentID, totals.DailyCostUSD, policy.DailyCostBudgetUSD),
		})
	}
	return policy, totals, breaches, nil
}

func (m *budgetControlManager) syncAlerts(policy audit.BudgetPolicyRow, subject budgetControlSubject, breaches []budgetControlBreach) error {
	existing, err := m.store.ListOpenBudgetAlerts(subject.AgentID, subject.SessionID)
	if err != nil {
		return err
	}
	now := m.now()
	existingByKey := make(map[string]audit.BudgetAlertRow, len(existing))
	for _, row := range existing {
		existingByKey[row.AlertKey] = row
	}
	for _, breach := range breaches {
		existingRow, hadExisting := existingByKey[breach.AlertKey]
		delete(existingByKey, breach.AlertKey)
		row := audit.BudgetAlertRow{
			AlertKey:         breach.AlertKey,
			PolicyID:         policy.PolicyID,
			AgentID:          subject.AgentID,
			AgentName:        firstNonEmpty(subject.AgentName, policy.AgentName),
			SessionID:        budgetAlertSessionID(breach.Window, subject.SessionID),
			Window:           breach.Window,
			Metric:           breach.Metric,
			Action:           breach.Action,
			Status:           "open",
			Reason:           breach.Reason,
			ObservedValue:    breach.Observed,
			BudgetValue:      breach.Budget,
			FirstTriggeredAt: now,
			UpdatedAt:        now,
		}
		if hadExisting {
			row.FirstTriggeredAt = existingRow.FirstTriggeredAt
		}
		if err := m.store.UpsertBudgetAlert(row); err != nil {
			return err
		}
		if !hadExisting && m.logger != nil {
			details := fmt.Sprintf(
				"policy_id=%s action=%s window=%s metric=%s observed=%.4f budget=%.4f session_id=%s reason=%s",
				policy.PolicyID, breach.Action, breach.Window, breach.Metric, breach.Observed, breach.Budget,
				subject.SessionID, breach.Reason,
			)
			if err := m.logger.LogAction("budget-control-breach", subject.AgentID, details); err != nil {
				fmt.Fprintf(os.Stderr, "[budget-control] breach audit failed (agent=%s alert=%s): %v\n", subject.AgentID, breach.AlertKey, err)
			}
		}
		if !hadExisting && m.otel != nil {
			m.otel.EmitPolicyDecision("budget-control", breach.Action, subject.AgentID, "agent", breach.Reason, map[string]string{
				"policy_id":      policy.PolicyID,
				"alert_key":      breach.AlertKey,
				"session_id":     subject.SessionID,
				"window":         breach.Window,
				"metric":         breach.Metric,
				"observed_value": strconv.FormatFloat(breach.Observed, 'f', 4, 64),
				"budget_value":   strconv.FormatFloat(breach.Budget, 'f', 4, 64),
			})
		}
		if !hadExisting {
			emitLifecycle(context.Background(), "budget-control", "alert", map[string]string{
				"agent_id":       subject.AgentID,
				"policy_id":      policy.PolicyID,
				"alert_key":      breach.AlertKey,
				"session_id":     subject.SessionID,
				"window":         breach.Window,
				"metric":         breach.Metric,
				"action":         breach.Action,
				"observed_value": strconv.FormatFloat(breach.Observed, 'f', 4, 64),
				"budget_value":   strconv.FormatFloat(breach.Budget, 'f', 4, 64),
			})
		}
	}
	for _, stale := range existingByKey {
		stale.Status = "resolved"
		stale.UpdatedAt = now
		stale.ReleasedAt = &now
		if err := m.store.UpsertBudgetAlert(stale); err != nil {
			return err
		}
		if m.logger != nil {
			details := fmt.Sprintf(
				"policy_id=%s action=%s window=%s metric=%s observed=%.4f budget=%.4f session_id=%s",
				stale.PolicyID, stale.Action, stale.Window, stale.Metric, stale.ObservedValue, stale.BudgetValue,
				stale.SessionID,
			)
			if err := m.logger.LogAction("budget-control-breach-resolved", stale.AgentID, details); err != nil {
				fmt.Fprintf(os.Stderr, "[budget-control] resolution audit failed (agent=%s alert=%s): %v\n", stale.AgentID, stale.AlertKey, err)
			}
		}
		if m.otel != nil {
			m.otel.EmitPolicyDecision("budget-control", "resolved", stale.AgentID, "agent", "budget breach resolved", map[string]string{
				"policy_id":  stale.PolicyID,
				"alert_key":  stale.AlertKey,
				"session_id": stale.SessionID,
				"window":     stale.Window,
				"metric":     stale.Metric,
			})
		}
		emitLifecycle(context.Background(), "budget-control", "restored", map[string]string{
			"agent_id":   stale.AgentID,
			"policy_id":  stale.PolicyID,
			"alert_key":  stale.AlertKey,
			"session_id": stale.SessionID,
			"window":     stale.Window,
			"metric":     stale.Metric,
			"action":     stale.Action,
		})
	}
	return nil
}

func budgetAlertKey(policyID, agentID, sessionID, window, metric string) string {
	return strings.Join([]string{policyID, agentID, sessionID, window, metric}, "|")
}

func budgetAlertSessionID(window, sessionID string) string {
	if window == "session" {
		return sessionID
	}
	return ""
}

func budgetControlFinding(breach budgetControlBreach) string {
	return fmt.Sprintf("budget-control:%s:%s:%s", breach.Window, breach.Metric, breach.Action)
}

func budgetControlHookSourceAllowed(connectorName string) bool {
	switch strings.ToLower(strings.TrimSpace(connectorName)) {
	case "codex", "claudecode", "geminicli", "copilot", "openclaw", "zeptoclaw":
		return false
	default:
		return true
	}
}

func (a *APIServer) budgetSubjectFromSession(sessionID string) budgetControlSubject {
	subject := budgetControlSubject{SessionID: sessionID}
	if a != nil && a.store != nil && strings.TrimSpace(sessionID) != "" {
		obs, err := a.store.LatestBudgetUsageObservationForSession(sessionID)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[budget-control] session subject lookup failed: %v\n", err)
		} else if obs != nil && strings.TrimSpace(obs.AgentID) != "" {
			subject.Connector = obs.Connector
			subject.AgentID = obs.AgentID
			subject.AgentName = firstNonEmpty(obs.AgentName, obs.AgentID)
			return subject
		}
	}
	if reg := SharedAgentRegistry(); reg != nil {
		subject.AgentID = reg.AgentID()
		subject.AgentName = firstNonEmpty(reg.AgentName(), subject.AgentID)
	}
	subject.Connector = a.connectorName()
	return subject
}

func (a *APIServer) budgetSubjectFromHook(ctx context.Context, req agentHookRequest) budgetControlSubject {
	identity := AgentIdentityFromContext(ctx)
	subject := budgetControlSubject{
		Connector: req.ConnectorName,
		AgentID:   firstNonEmpty(req.AgentID, identity.AgentID),
		AgentName: firstNonEmpty(req.AgentName, identity.AgentName, req.AgentID, identity.AgentID),
		SessionID: firstNonEmpty(req.SessionID, SessionIDFromContext(ctx)),
	}
	if snapshot, ok := a.hookLifecycleSnapshot(req.ConnectorName, subject.SessionID, subject.AgentID); ok {
		subject.AgentID = firstNonEmpty(subject.AgentID, snapshot.AgentID)
		subject.AgentName = firstNonEmpty(subject.AgentName, snapshot.AgentName, snapshot.AgentID)
	}
	return subject
}

func (a *APIServer) activeBudgetDecision(subject budgetControlSubject) *budgetControlDecision {
	if a == nil || a.budgetControl == nil {
		return nil
	}
	decision, err := a.budgetControl.ActiveDecision(subject)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[budget-control] active decision failed: %v\n", err)
		return &budgetControlDecision{
			Action:   "deny",
			Severity: "HIGH",
			Reason:   "budget control state is unavailable; denying execution fail-closed",
			Findings: []string{"budget-control:state:error:deny"},
		}
	}
	return decision
}

func budgetDecisionVerdict(decision *budgetControlDecision) *ToolInspectVerdict {
	if decision == nil {
		return nil
	}
	verdict := &ToolInspectVerdict{
		Action:   guardrailActionAllow,
		Severity: decision.Severity,
		Reason:   decision.Reason,
		Findings: append([]string(nil), decision.Findings...),
		Mode:     "budget-control",
	}
	switch decision.Action {
	case "deny":
		verdict.Action = guardrailActionBlock
		verdict.RawAction = guardrailActionBlock
	default:
		verdict.Action = guardrailActionAlert
		verdict.RawAction = guardrailActionAlert
	}
	return verdict
}

func (a *APIServer) budgetDecisionHookResponse(req agentHookRequest, decision *budgetControlDecision) agentHookResponse {
	profile := a.hookProfileForConnector(req.ConnectorName)
	caps := profile.Capabilities
	if decision == nil {
		return agentHookResponse{}
	}
	rawAction := guardrailActionAlert
	action := guardrailActionAllow
	wouldBlock := false
	if decision.Action == "deny" {
		rawAction = guardrailActionBlock
		action, wouldBlock = mapHookActionForProfile(rawAction, "action", req.HookEventName, caps, profile)
	}
	return agentHookResponseForProfile(profile, req, action, rawAction, decision.Severity, decision.Reason, decision.Findings, "budget-control", wouldBlock, caps)
}

func (a *APIServer) observeBudgetHookUsage(ctx context.Context, connectorName string, req agentHookRequest) {
	if a == nil || a.budgetControl == nil || !budgetControlHookSourceAllowed(connectorName) {
		return
	}
	subject := a.budgetSubjectFromHook(ctx, req)
	if strings.TrimSpace(subject.AgentID) == "" {
		return
	}
	usage := extractHookPayloadTokenUsage(req.Payload)
	reportedCost := extractHookPayloadReportedCost(req.Payload)
	costUSD := 0.0
	if reportedCost.Present && !reportedCost.Cumulative {
		costUSD = reportedCost.USD
	}
	if usage.TotalTokens <= 0 && costUSD <= 0 {
		return
	}
	err := a.budgetControl.ObserveUsage(ctx, audit.BudgetUsageObservation{
		Timestamp:        time.Now().UTC(),
		Source:           "hook",
		Connector:        connectorName,
		AgentID:          subject.AgentID,
		AgentName:        subject.AgentName,
		SessionID:        subject.SessionID,
		Model:            usage.Model,
		PromptTokens:     usage.PromptTokens,
		CompletionTokens: usage.CompletionTokens,
		TotalTokens:      usage.TotalTokens,
		CostUSD:          costUSD,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "[budget-control] hook observe failed (connector=%s session=%s): %v\n", connectorName, subject.SessionID, err)
	}
}

func (a *APIServer) observeBudgetOTLPUsage(source, sessionID string, usages []otelTokenUsage) {
	if a == nil || a.budgetControl == nil || len(usages) == 0 {
		return
	}
	if strings.EqualFold(strings.TrimSpace(source), "openclaw") {
		// OpenClaw's sessions.list snapshot is the authoritative budget
		// source: it is unsampled, session-scoped, and includes reported
		// cost. Its OTLP diagnostics still flow to Galileo and Splunk, but
		// promoting them into this ledger would charge the same tokens twice.
		return
	}
	type aggregate struct {
		model            string
		agentID          string
		agentName        string
		sessionID        string
		promptTokens     int64
		completionTokens int64
		componentTokens  int64
		explicitTotal    int64
	}
	grouped := map[string]*aggregate{}
	for _, usage := range usages {
		if usage.tokens <= 0 {
			continue
		}
		usageSessionID := firstNonEmpty(usage.sessionID, sessionID)
		agentName := usage.agentName
		agentID := usage.agentID
		if agentID == "" {
			if reg := SharedAgentRegistry(); reg != nil {
				agentID = reg.AgentID()
			}
		}
		if snapshot, ok := a.hookLifecycleSnapshot(source, usageSessionID, ""); ok {
			agentName = firstNonEmpty(snapshot.AgentName, agentName)
			agentID = firstNonEmpty(snapshot.AgentID, agentID)
		}
		agentID = firstNonEmpty(agentID, agentName, source)
		key := strings.Join([]string{agentID, usageSessionID, usage.model}, "|")
		current := grouped[key]
		if current == nil {
			current = &aggregate{
				model:     usage.model,
				agentID:   agentID,
				agentName: firstNonEmpty(agentName, agentID),
				sessionID: usageSessionID,
			}
			grouped[key] = current
		}
		switch usage.tokenType {
		case "input", "prompt":
			current.promptTokens = saturatingBudgetTokenAdd(current.promptTokens, usage.tokens)
			current.componentTokens = saturatingBudgetTokenAdd(current.componentTokens, usage.tokens)
		case "output":
			current.completionTokens = saturatingBudgetTokenAdd(current.completionTokens, usage.tokens)
			current.componentTokens = saturatingBudgetTokenAdd(current.componentTokens, usage.tokens)
		case "total":
			current.explicitTotal = saturatingBudgetTokenAdd(current.explicitTotal, usage.tokens)
		default:
			// Cache and provider-specific token classes are billable components
			// even when they do not map cleanly to prompt/completion columns.
			current.componentTokens = saturatingBudgetTokenAdd(current.componentTokens, usage.tokens)
		}
	}
	for _, agg := range grouped {
		totalTokens := max(agg.componentTokens, agg.explicitTotal)
		if totalTokens <= 0 {
			continue
		}
		if err := a.budgetControl.ObserveUsage(context.Background(), audit.BudgetUsageObservation{
			Timestamp:        time.Now().UTC(),
			Source:           "otlp",
			Connector:        source,
			AgentID:          agg.agentID,
			AgentName:        agg.agentName,
			SessionID:        agg.sessionID,
			Model:            agg.model,
			PromptTokens:     agg.promptTokens,
			CompletionTokens: agg.completionTokens,
			TotalTokens:      totalTokens,
		}); err != nil {
			fmt.Fprintf(os.Stderr, "[budget-control] otlp observe failed (source=%s session=%s): %v\n", source, agg.sessionID, err)
		}
	}
}

func saturatingBudgetTokenAdd(current, delta int64) int64 {
	if delta <= 0 {
		return current
	}
	if current > math.MaxInt64-delta {
		return math.MaxInt64
	}
	return current + delta
}

func (a *APIServer) handleBudgetControlPoliciesEffective(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if a.budgetControl == nil {
		a.writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "budget control unavailable"})
		return
	}
	rows, err := a.budgetControl.ListEffectivePolicies(r.URL.Query().Get("agent_id"))
	if err != nil {
		a.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if rows == nil {
		rows = []audit.BudgetPolicyRow{}
	}
	a.writeJSON(w, http.StatusOK, rows)
}

func (a *APIServer) handleBudgetControlAlerts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if a.budgetControl == nil {
		a.writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "budget control unavailable"})
		return
	}
	limit, err := parseBudgetControlLimit(r.URL.Query().Get("limit"), 50)
	if err != nil {
		a.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	rows, err := a.budgetControl.ListAlerts(limit)
	if err != nil {
		a.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if rows == nil {
		rows = []audit.BudgetAlertRow{}
	}
	a.writeJSON(w, http.StatusOK, rows)
}

func parseBudgetControlWindow(raw string) (time.Duration, error) {
	window := strings.TrimSpace(raw)
	if window == "" {
		window = "-24h"
	}
	if !strings.HasPrefix(window, "-") {
		window = "-" + window
	}
	if strings.HasSuffix(window, "d") {
		daysText := strings.TrimSuffix(strings.TrimPrefix(window, "-"), "d")
		days, err := parseInt(daysText)
		if err != nil || days <= 0 || days > 365 {
			return 0, fmt.Errorf("window must be between -1h and -365d")
		}
		return -time.Duration(days) * 24 * time.Hour, nil
	}
	dur, err := time.ParseDuration(window)
	if err != nil || dur > -time.Hour || dur < -maxBudgetControlLookback {
		return 0, fmt.Errorf("window must be between -1h and -365d")
	}
	return dur, nil
}

func (a *APIServer) handleBudgetControlUsageObservations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if a.budgetControl == nil || a.budgetControl.store == nil {
		a.writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "budget control unavailable"})
		return
	}
	limit, err := parseBudgetControlLimit(r.URL.Query().Get("limit"), maxBudgetControlReadLimit)
	if err != nil {
		a.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	lookback, err := parseBudgetControlWindow(r.URL.Query().Get("window"))
	if err != nil {
		a.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	since := time.Now().UTC().Add(lookback)
	rows, err := a.budgetControl.store.ListBudgetUsageObservationsSince(since, limit)
	if err != nil {
		a.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if rows == nil {
		rows = []audit.BudgetUsageObservation{}
	}
	a.writeJSON(w, http.StatusOK, rows)
}

func (a *APIServer) handleBudgetControlApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if a.budgetControl == nil {
		a.writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "budget control unavailable"})
		return
	}
	var req budgetControlApplyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		a.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	req.Source = firstNonEmpty(req.Source, "c3-tokenomics-ui")
	req.UpdatedBy = firstNonEmpty(req.UpdatedBy, "c3-tokenomics-ui")
	policy, err := a.budgetControl.ApplyPolicy(req)
	if err != nil {
		a.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if a.logger != nil && policy != nil {
		_ = a.logger.LogActionCtx(r.Context(), "budget-control-apply", policy.AgentID,
			fmt.Sprintf("action=%s session_tokens=%d daily_tokens=%d", policy.Action, policy.SessionTokenBudget, policy.DailyTokenBudget))
	}
	a.writeJSON(w, http.StatusOK, policy)
}

func (a *APIServer) handleBudgetControlRelease(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if a.budgetControl == nil {
		a.writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "budget control unavailable"})
		return
	}
	var req budgetControlReleaseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		a.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if err := a.budgetControl.ReleasePolicy(req); err != nil {
		a.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if a.logger != nil {
		_ = a.logger.LogActionCtx(r.Context(), "budget-control-release", req.AgentID, "released via REST API")
	}
	a.writeJSON(w, http.StatusOK, map[string]string{"status": "released"})
}

func parseInt(raw string) (int, error) {
	return strconv.Atoi(strings.TrimSpace(raw))
}

func parseBudgetControlLimit(raw string, defaultLimit int) (int, error) {
	if strings.TrimSpace(raw) == "" {
		return defaultLimit, nil
	}
	limit, err := parseInt(raw)
	if err != nil || limit <= 0 || limit > maxBudgetControlReadLimit {
		return 0, fmt.Errorf("limit must be between 1 and %d", maxBudgetControlReadLimit)
	}
	return limit, nil
}

func budgetDecisionAuditReason(decision *budgetControlDecision) string {
	if decision == nil {
		return ""
	}
	return string(redaction.ForSinkReason(decision.Reason))
}

func budgetControlResponseForInspect(
	a *APIServer,
	w http.ResponseWriter,
	r *http.Request,
	targetType string,
	target string,
	decision *budgetControlDecision,
) bool {
	if decision == nil {
		return false
	}
	verdict := budgetDecisionVerdict(decision)
	if a.logger != nil {
		details := fmt.Sprintf("action=%s severity=%s mode=budget-control reason=%s", decision.Action, decision.Severity, budgetDecisionAuditReason(decision))
		if err := a.logger.LogActionCtx(r.Context(), "budget-control-"+decision.Action, target, details); err != nil {
			fmt.Fprintf(os.Stderr, "[budget-control] inspect audit failed (target=%s): %v\n", target, err)
		}
	}
	if a.otel != nil {
		a.otel.EmitPolicyDecision("budget-control", decision.Action, target, targetType, decision.Reason, map[string]string{
			"mode":     "budget-control",
			"severity": decision.Severity,
		})
		a.otel.RecordInspectEvaluation(r.Context(), "budget-control:"+target, verdict.Action, verdict.Severity)
	}
	a.writeJSON(w, http.StatusOK, verdict)
	return true
}
