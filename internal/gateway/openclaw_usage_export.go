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
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/defenseclaw/defenseclaw/internal/audit"
)

const openclawUsageExportIntervalDefault = 5 * time.Minute
const openclawUsageExportIntervalEnv = "DEFENSECLAW_OPENCLAW_USAGE_EXPORT_INTERVAL"
const openclawUsageExportIntervalMin = 10 * time.Second
const openclawUsageExportIntervalMax = time.Hour
const openclawUsageBaselineFile = "openclaw_usage_baseline.json"
const openclawUsageConnectPollInterval = 1 * time.Second
const openclawSessionInitialBackfillWindow = 24 * time.Hour

type openclawUsageTotals struct {
	Input              int64   `json:"input"`
	Output             int64   `json:"output"`
	CacheRead          int64   `json:"cacheRead"`
	CacheWrite         int64   `json:"cacheWrite"`
	TotalTokens        int64   `json:"totalTokens"`
	InputCost          float64 `json:"inputCost"`
	OutputCost         float64 `json:"outputCost"`
	CacheReadCost      float64 `json:"cacheReadCost"`
	CacheWriteCost     float64 `json:"cacheWriteCost"`
	TotalCost          float64 `json:"totalCost"`
	MissingCostEntries int64   `json:"missingCostEntries"`
}

type openclawUsageResponse struct {
	Aggregates struct {
		ByModel []struct {
			Provider string              `json:"provider"`
			Model    string              `json:"model"`
			Count    int64               `json:"count"`
			Totals   openclawUsageTotals `json:"totals"`
		} `json:"byModel"`
		Messages struct {
			Assistant   int64 `json:"assistant"`
			Errors      int64 `json:"errors"`
			ToolCalls   int64 `json:"toolCalls"`
			ToolResults int64 `json:"toolResults"`
			Total       int64 `json:"total"`
			User        int64 `json:"user"`
		} `json:"messages"`
		Tools struct {
			TotalCalls  int64 `json:"totalCalls"`
			UniqueTools int64 `json:"uniqueTools"`
			Tools       []struct {
				Name  string `json:"name"`
				Count int64  `json:"count"`
			} `json:"tools"`
		} `json:"tools"`
		Latency struct {
			AvgMS float64 `json:"avgMs"`
			Count int64   `json:"count"`
			MaxMS float64 `json:"maxMs"`
			MinMS float64 `json:"minMs"`
			P95MS float64 `json:"p95Ms"`
		} `json:"latency"`
	} `json:"aggregates"`
}

type openclawSessionsListResponse struct {
	Sessions []openclawSessionUsageEntry `json:"sessions"`
}

type openclawSessionUsageEntry struct {
	Key              string  `json:"key"`
	Label            string  `json:"label"`
	SessionID        string  `json:"sessionId"`
	UpdatedAt        int64   `json:"updatedAt"`
	StartedAt        int64   `json:"startedAt"`
	InputTokens      int64   `json:"inputTokens"`
	OutputTokens     int64   `json:"outputTokens"`
	EstimatedCostUSD float64 `json:"estimatedCostUsd"`
	ModelProvider    string  `json:"modelProvider"`
	Model            string  `json:"model"`
}

type openclawSessionBaseline struct {
	Key              string  `json:"key,omitempty"`
	Label            string  `json:"label,omitempty"`
	SessionID        string  `json:"session_id,omitempty"`
	AgentID          string  `json:"agent_id,omitempty"`
	AgentName        string  `json:"agent_name,omitempty"`
	Model            string  `json:"model,omitempty"`
	InputTokens      int64   `json:"input_tokens,omitempty"`
	OutputTokens     int64   `json:"output_tokens,omitempty"`
	EstimatedCostUSD float64 `json:"estimated_cost_usd,omitempty"`
	UpdatedAt        int64   `json:"updated_at,omitempty"`
	StartedAt        int64   `json:"started_at,omitempty"`
}

type openclawUsageBaseline struct {
	Date      string                             `json:"date"`
	ByModel   map[string]openclawUsageTotals     `json:"by_model"`
	BySession map[string]openclawSessionBaseline `json:"by_session,omitempty"`
}

func shouldExportOpenClawUsage(cfg interface{ ActiveConnectors() []string }) bool {
	if cfg == nil {
		return false
	}
	for _, name := range cfg.ActiveConnectors() {
		if strings.EqualFold(strings.TrimSpace(name), "openclaw") {
			return true
		}
	}
	return false
}

func (s *Sidecar) startOpenClawUsageExporter(ctx context.Context) {
	if s == nil || s.client == nil || s.logger == nil || s.cfg == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(openclawUsageExportIntervalFromEnv())
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				s.exportOpenClawUsageSnapshotWhenConnected(ctx)
			case <-ctx.Done():
				return
			}
		}
	}()
}

func openclawUsageExportIntervalFromEnv() time.Duration {
	raw := strings.TrimSpace(os.Getenv(openclawUsageExportIntervalEnv))
	if raw == "" {
		return openclawUsageExportIntervalDefault
	}
	interval, err := time.ParseDuration(raw)
	if err != nil || interval < openclawUsageExportIntervalMin || interval > openclawUsageExportIntervalMax {
		return openclawUsageExportIntervalDefault
	}
	return interval
}

func (s *Sidecar) exportOpenClawUsageSnapshotWhenConnected(ctx context.Context) {
	if s == nil || s.client == nil {
		return
	}
	if !waitForOpenClawGatewayConnection(ctx, s.client) {
		return
	}
	s.exportOpenClawUsageSnapshot(ctx)
}

func waitForOpenClawGatewayConnection(ctx context.Context, client interface{ Connected() bool }) bool {
	if client == nil {
		return false
	}
	if client.Connected() {
		return true
	}
	ticker := time.NewTicker(openclawUsageConnectPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return false
		case <-ticker.C:
			if client.Connected() {
				return true
			}
		}
	}
}

func (s *Sidecar) exportOpenClawUsageSnapshot(ctx context.Context) {
	reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	now := time.Now().UTC()
	day := now.Format("2006-01-02")
	params := map[string]any{
		"startDate":            day,
		"endDate":              day,
		"mode":                 "utc",
		"limit":                1000,
		"includeContextWeight": false,
	}
	raw, err := s.client.Request(reqCtx, "sessions.usage", params)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[sidecar] openclaw usage snapshot export failed: %v\n", err)
		return
	}
	var resp openclawUsageResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		fmt.Fprintf(os.Stderr, "[sidecar] openclaw usage snapshot decode failed: %v\n", err)
		return
	}
	sessionResp := openclawSessionsListResponse{}
	sessionRaw, err := s.client.Request(reqCtx, "sessions.list", map[string]any{
		"limit": 1000,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "[sidecar] openclaw sessions.list export failed: %v\n", err)
	} else if err := json.Unmarshal(sessionRaw, &sessionResp); err != nil {
		fmt.Fprintf(os.Stderr, "[sidecar] openclaw sessions.list decode failed: %v\n", err)
	}
	metrics := openclawUsageMetricsFromResponse(raw)
	for i := range metrics {
		if s.cfg != nil {
			metrics[i].gatewayHost = s.cfg.Gateway.Host
		}
	}
	persistDashboardMetricAuditEvents(s.logger, s.store, "openclaw", "", "openclaw:usage:snapshot", metrics)
	s.observeOpenClawUsageSnapshot(now, day, resp, sessionResp)
}

func openclawUsageMetricsFromResponse(raw []byte) []otelDashboardMetric {
	var resp openclawUsageResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil
	}
	out := make([]otelDashboardMetric, 0, len(resp.Aggregates.ByModel)*7+8)
	for _, row := range resp.Aggregates.ByModel {
		provider := firstNonEmpty(row.Provider, "unknown")
		model := firstNonEmpty(row.Model, "unknown")
		out = appendUsageTokenMetric(out, "openclaw.tokens", row.Totals.TotalTokens, provider, model, "total")
		out = appendUsageTokenMetric(out, "openclaw.tokens.input", row.Totals.Input, provider, model, "input")
		out = appendUsageTokenMetric(out, "openclaw.tokens.output", row.Totals.Output, provider, model, "output")
		out = appendUsageTokenMetric(out, "openclaw.tokens.cache_read", row.Totals.CacheRead, provider, model, "cache_read")
		out = appendUsageTokenMetric(out, "openclaw.tokens.cache_write", row.Totals.CacheWrite, provider, model, "cache_write")
		out = appendUsageFloatMetric(out, "openclaw.cost.usd", row.Totals.TotalCost, "usd", provider, model, "cost")
		out = appendUsageFloatMetric(out, "openclaw.messages.assistant", float64(row.Count), "1", provider, model, "usage")
	}
	out = appendUsageFloatMetric(out, "openclaw.messages.total", float64(resp.Aggregates.Messages.Total), "1", "openclaw", "all", "usage")
	out = appendUsageFloatMetric(out, "openclaw.messages.errors", float64(resp.Aggregates.Messages.Errors), "1", "openclaw", "all", "usage")
	out = appendUsageFloatMetric(out, "openclaw.tool.calls", float64(resp.Aggregates.Tools.TotalCalls), "1", "openclaw", "all", "tool")
	out = appendUsageFloatMetric(out, "openclaw.tool.unique", float64(resp.Aggregates.Tools.UniqueTools), "1", "openclaw", "all", "tool")
	out = appendUsageFloatMetric(out, "openclaw.latency.avg_ms", resp.Aggregates.Latency.AvgMS, "ms", "openclaw", "all", "latency")
	out = appendUsageFloatMetric(out, "openclaw.latency.p95_ms", resp.Aggregates.Latency.P95MS, "ms", "openclaw", "all", "latency")
	out = appendUsageFloatMetric(out, "openclaw.latency.max_ms", resp.Aggregates.Latency.MaxMS, "ms", "openclaw", "all", "latency")
	return out
}

func appendUsageTokenMetric(out []otelDashboardMetric, name string, value int64, provider, model, tokenType string) []otelDashboardMetric {
	if value <= 0 {
		return out
	}
	return append(out, otelDashboardMetric{
		metricName:   name,
		value:        float64(value),
		unit:         "tokens",
		provider:     provider,
		model:        model,
		operation:    "chat",
		tokenType:    tokenType,
		channel:      "usage",
		component:    "openclaw_usage_rpc",
		temporality:  "snapshot",
		sourceSignal: "openclaw_rpc",
	})
}

func appendUsageFloatMetric(out []otelDashboardMetric, name string, value float64, unit, provider, model, operation string) []otelDashboardMetric {
	if value <= 0 {
		return out
	}
	return append(out, otelDashboardMetric{
		metricName:   name,
		value:        value,
		unit:         unit,
		provider:     provider,
		model:        model,
		operation:    operation,
		channel:      "usage",
		component:    "openclaw_usage_rpc",
		temporality:  "snapshot",
		sourceSignal: "openclaw_rpc",
	})
}

func (s *Sidecar) observeOpenClawUsageSnapshot(
	now time.Time,
	day string,
	resp openclawUsageResponse,
	sessionResp openclawSessionsListResponse,
) {
	if s == nil || s.budgetControl == nil || s.store == nil || s.cfg == nil {
		return
	}
	// Reconnect and periodic exports can overlap. Serialize the baseline read,
	// ledger inserts, and baseline replacement so one cumulative delta is never
	// charged twice.
	s.openClawUsageMu.Lock()
	defer s.openClawUsageMu.Unlock()

	path := filepath.Join(s.cfg.DataDir, openclawUsageBaselineFile)
	baseline, err := loadOpenClawUsageBaseline(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[sidecar] openclaw usage baseline load failed: %v\n", err)
		baseline = openclawUsageBaseline{}
	}
	observations, sessionBaseline := openclawSessionUsageBudgetObservations(now, baseline, sessionResp)
	persisted := true
	for _, obs := range observations {
		if err := s.budgetControl.ObserveUsageUpsert(context.Background(), obs); err != nil {
			persisted = false
			fmt.Fprintf(os.Stderr, "[sidecar] openclaw usage budget observe failed (agent=%s session=%s model=%s): %v\n",
				obs.AgentID, obs.SessionID, obs.Model, err)
		}
	}
	if !persisted {
		// Keep the old baseline so every failed interval is retried. Stable
		// observation IDs make successful rows in a partial batch replaceable
		// rather than additive on the next attempt.
		return
	}
	next := openclawUsageBaseline{
		Date:      day,
		ByModel:   openclawUsageBaselineByModel(resp),
		BySession: sessionBaseline,
	}
	if err := saveOpenClawUsageBaseline(path, next); err != nil {
		fmt.Fprintf(os.Stderr, "[sidecar] openclaw usage baseline save failed: %v\n", err)
	}
}

func openclawUsageBaselineByModel(resp openclawUsageResponse) map[string]openclawUsageTotals {
	next := map[string]openclawUsageTotals{}
	for _, row := range resp.Aggregates.ByModel {
		key := openclawUsageBaselineKey(firstNonEmpty(row.Provider, "unknown"), firstNonEmpty(row.Model, "unknown"))
		next[key] = row.Totals
	}
	return next
}

func openclawSessionUsageBudgetObservations(
	now time.Time,
	baseline openclawUsageBaseline,
	resp openclawSessionsListResponse,
) ([]audit.BudgetUsageObservation, map[string]openclawSessionBaseline) {
	next := map[string]openclawSessionBaseline{}
	if len(baseline.BySession) > 0 {
		for key, row := range baseline.BySession {
			next[key] = row
		}
	}
	var observations []audit.BudgetUsageObservation
	for _, row := range resp.Sessions {
		key := openclawSessionBaselineKey(row)
		if key == "" {
			continue
		}
		agentID := openclawSessionAgentID(row.Key)
		if agentID == "" {
			agentID = "openclaw"
		}
		agentName := firstNonEmpty(agentID, "openclaw")
		currentPrompt := maxInt64(row.InputTokens, 0)
		currentCompletion := maxInt64(row.OutputTokens, 0)
		previous := next[key]
		deltaPrompt := deltaInt64(currentPrompt, previous.InputTokens)
		deltaCompletion := deltaInt64(currentCompletion, previous.OutputTokens)
		costDelta := deltaFloat64(row.EstimatedCostUSD, previous.EstimatedCostUSD)
		if previous.SessionID == "" && !shouldBackfillOpenClawSession(now, row) {
			deltaPrompt = 0
			deltaCompletion = 0
			costDelta = 0
		}
		if deltaPrompt > 0 || deltaCompletion > 0 || costDelta > 0 {
			observations = append(observations, audit.BudgetUsageObservation{
				ID: stableLLMEventID(
					"budget-openclaw",
					key,
					strconv.FormatInt(previous.InputTokens, 10),
					strconv.FormatInt(previous.OutputTokens, 10),
					strconv.FormatFloat(previous.EstimatedCostUSD, 'g', -1, 64),
				),
				Timestamp:        now.UTC(),
				Source:           "openclaw_session_snapshot",
				Connector:        "openclaw",
				AgentID:          agentID,
				AgentName:        agentName,
				SessionID:        row.SessionID,
				Model:            firstNonEmpty(row.Model, previous.Model, "unknown"),
				PromptTokens:     deltaPrompt,
				CompletionTokens: deltaCompletion,
				TotalTokens:      deltaPrompt + deltaCompletion,
				CostUSD:          costDelta,
			})
		}
		next[key] = openclawSessionBaseline{
			Key:              row.Key,
			Label:            row.Label,
			SessionID:        row.SessionID,
			AgentID:          agentID,
			AgentName:        agentName,
			Model:            firstNonEmpty(row.Model, previous.Model),
			InputTokens:      currentPrompt,
			OutputTokens:     currentCompletion,
			EstimatedCostUSD: maxFloat64(row.EstimatedCostUSD, 0),
			UpdatedAt:        row.UpdatedAt,
			StartedAt:        row.StartedAt,
		}
	}
	return observations, next
}

func openclawUsageBaselineKey(provider, model string) string {
	return strings.TrimSpace(provider) + "|" + strings.TrimSpace(model)
}

func deltaInt64(current, previous int64) int64 {
	if current <= 0 {
		return 0
	}
	if previous <= 0 {
		return current
	}
	if current <= previous {
		return 0
	}
	return current - previous
}

func deltaFloat64(current, previous float64) float64 {
	if current <= 0 {
		return 0
	}
	if previous <= 0 {
		return current
	}
	if current <= previous {
		return 0
	}
	return current - previous
}

func loadOpenClawUsageBaseline(path string) (openclawUsageBaseline, error) {
	if strings.TrimSpace(path) == "" {
		return openclawUsageBaseline{}, nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return openclawUsageBaseline{}, nil
	}
	if err != nil {
		return openclawUsageBaseline{}, err
	}
	var baseline openclawUsageBaseline
	if err := json.Unmarshal(data, &baseline); err != nil {
		return openclawUsageBaseline{}, err
	}
	if baseline.ByModel == nil {
		baseline.ByModel = map[string]openclawUsageTotals{}
	}
	if baseline.BySession == nil {
		baseline.BySession = map[string]openclawSessionBaseline{}
	}
	return baseline, nil
}

func saveOpenClawUsageBaseline(path string, baseline openclawUsageBaseline) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	if baseline.ByModel == nil {
		baseline.ByModel = map[string]openclawUsageTotals{}
	}
	if baseline.BySession == nil {
		baseline.BySession = map[string]openclawSessionBaseline{}
	}
	data, err := json.MarshalIndent(baseline, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func openclawSessionBaselineKey(row openclawSessionUsageEntry) string {
	return firstNonEmpty(strings.TrimSpace(row.SessionID), strings.TrimSpace(row.Key))
}

func openclawSessionAgentID(sessionKey string) string {
	parts := strings.SplitN(strings.TrimSpace(sessionKey), ":", 3)
	if len(parts) >= 3 && strings.EqualFold(parts[0], "agent") {
		return strings.TrimSpace(parts[1])
	}
	return ""
}

func shouldBackfillOpenClawSession(now time.Time, row openclawSessionUsageEntry) bool {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	updatedAt := unixMillisUTC(row.UpdatedAt)
	if updatedAt.IsZero() {
		return false
	}
	if updatedAt.Before(now.Add(-openclawSessionInitialBackfillWindow)) || updatedAt.After(now.Add(5*time.Minute)) {
		return false
	}
	startedAt := unixMillisUTC(row.StartedAt)
	if startedAt.IsZero() {
		return true
	}
	return !startedAt.Before(now.Add(-openclawSessionInitialBackfillWindow))
}

func unixMillisUTC(ms int64) time.Time {
	if ms <= 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms).UTC()
}

func maxInt64(a, b int64) int64 {
	if a >= b {
		return a
	}
	return b
}

func maxFloat64(a, b float64) float64 {
	if a >= b {
		return a
	}
	return b
}
