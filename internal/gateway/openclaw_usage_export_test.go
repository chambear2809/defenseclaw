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
	"math"
	"path/filepath"
	"testing"
	"time"

	"github.com/defenseclaw/defenseclaw/internal/audit"
	"github.com/defenseclaw/defenseclaw/internal/config"
)

func TestOpenClawUsageExportIntervalFromEnv(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want time.Duration
	}{
		{name: "default", want: openclawUsageExportIntervalDefault},
		{name: "demo cadence", raw: "30s", want: 30 * time.Second},
		{name: "too fast", raw: "5s", want: openclawUsageExportIntervalDefault},
		{name: "too slow", raw: "2h", want: openclawUsageExportIntervalDefault},
		{name: "invalid", raw: "fast", want: openclawUsageExportIntervalDefault},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv(openclawUsageExportIntervalEnv, tt.raw)
			if got := openclawUsageExportIntervalFromEnv(); got != tt.want {
				t.Fatalf("openclawUsageExportIntervalFromEnv()=%s want %s", got, tt.want)
			}
		})
	}
}

func TestOpenClawUsageMetricsFromResponse(t *testing.T) {
	raw := []byte(`{
		"aggregates": {
			"byModel": [{
				"provider": "openai",
				"model": "gpt-5.4",
				"count": 1543,
				"totals": {
					"input": 10000000,
					"output": 5000000,
					"cacheRead": 1000,
					"cacheWrite": 2000,
					"totalTokens": 15003000,
					"totalCost": 17.38
				}
			}],
			"messages": {
				"assistant": 1543,
				"errors": 1402,
				"toolCalls": 55,
				"total": 3055,
				"user": 1492
			},
			"tools": {
				"totalCalls": 55,
				"uniqueTools": 6
			},
			"latency": {
				"avgMs": 12.5,
				"p95Ms": 45.5,
				"maxMs": 120
			}
		}
	}`)

	metrics := openclawUsageMetricsFromResponse(raw)
	if len(metrics) == 0 {
		t.Fatal("expected usage metrics")
	}

	tokens := requireUsageMetric(t, metrics, "openclaw.tokens", "openai", "gpt-5.4")
	if tokens.value != 15003000 {
		t.Fatalf("openclaw.tokens value = %v, want 15003000", tokens.value)
	}
	if tokens.unit != "tokens" || tokens.tokenType != "total" || tokens.component != "openclaw_usage_rpc" || tokens.temporality != "snapshot" || tokens.sourceSignal != "openclaw_rpc" {
		t.Fatalf("openclaw.tokens labels = unit=%q tokenType=%q component=%q temporality=%q sourceSignal=%q",
			tokens.unit, tokens.tokenType, tokens.component, tokens.temporality, tokens.sourceSignal)
	}

	cost := requireUsageMetric(t, metrics, "openclaw.cost.usd", "openai", "gpt-5.4")
	if cost.value != 17.38 || cost.unit != "usd" {
		t.Fatalf("openclaw.cost.usd = %v %q, want 17.38 usd", cost.value, cost.unit)
	}

	errors := requireUsageMetric(t, metrics, "openclaw.messages.errors", "openclaw", "all")
	if errors.value != 1402 {
		t.Fatalf("openclaw.messages.errors = %v, want 1402", errors.value)
	}

	tools := requireUsageMetric(t, metrics, "openclaw.tool.calls", "openclaw", "all")
	if tools.value != 55 {
		t.Fatalf("openclaw.tool.calls = %v, want 55", tools.value)
	}
}

func TestOpenClawSessionUsageBudgetObservations_UsesSessionDeltas(t *testing.T) {
	now := time.Date(2026, time.July, 7, 2, 40, 0, 0, time.UTC)
	baseline := openclawUsageBaseline{
		Date: "2026-07-07",
		BySession: map[string]openclawSessionBaseline{
			"da2498d6-dcd1-4652-91bd-a166416e60bc": {
				SessionID:        "da2498d6-dcd1-4652-91bd-a166416e60bc",
				AgentID:          "main",
				AgentName:        "main",
				Model:            "gpt-4o-mini",
				InputTokens:      63000,
				OutputTokens:     2,
				EstimatedCostUSD: 1.1,
			},
		},
	}
	resp := openclawSessionsListResponse{
		Sessions: []openclawSessionUsageEntry{
			{
				Key:              "agent:main:explicit:tokenomics-live-20260706",
				SessionID:        "da2498d6-dcd1-4652-91bd-a166416e60bc",
				UpdatedAt:        now.UnixMilli(),
				StartedAt:        now.Add(-2 * time.Minute).UnixMilli(),
				InputTokens:      63342,
				OutputTokens:     3,
				EstimatedCostUSD: 1.6,
				ModelProvider:    "bridgeit",
				Model:            "gpt-4o-mini",
			},
		},
	}

	observations, next := openclawSessionUsageBudgetObservations(now, baseline, resp)
	if len(observations) != 1 {
		t.Fatalf("observations=%d want 1", len(observations))
	}
	got := observations[0]
	if got.AgentID != "main" || got.AgentName != "main" {
		t.Fatalf("agent=%q/%q want main/main", got.AgentID, got.AgentName)
	}
	if got.SessionID != "da2498d6-dcd1-4652-91bd-a166416e60bc" {
		t.Fatalf("session=%q want da2498d6-dcd1-4652-91bd-a166416e60bc", got.SessionID)
	}
	if got.Model != "gpt-4o-mini" {
		t.Fatalf("model=%q want gpt-4o-mini", got.Model)
	}
	if got.ID == "" {
		t.Fatal("stable snapshot interval ID is empty")
	}
	if got.PromptTokens != 342 || got.CompletionTokens != 1 || got.TotalTokens != 343 {
		t.Fatalf("delta tokens=%+v want prompt=342 completion=1 total=343", got)
	}
	if math.Abs(got.CostUSD-0.5) > 1e-9 {
		t.Fatalf("cost=%v want 0.5", got.CostUSD)
	}
	if next["da2498d6-dcd1-4652-91bd-a166416e60bc"].InputTokens != 63342 {
		t.Fatalf("next input tokens=%d want 63342", next["da2498d6-dcd1-4652-91bd-a166416e60bc"].InputTokens)
	}

	// If saving the baseline fails and the cumulative source advances, the
	// retry must address the same interval so the ledger upsert replaces it.
	resp.Sessions[0].InputTokens = 63442
	retry, _ := openclawSessionUsageBudgetObservations(now.Add(time.Minute), baseline, resp)
	if len(retry) != 1 || retry[0].ID != got.ID {
		t.Fatalf("retry interval id=%q want %q", retry[0].ID, got.ID)
	}
	if retry[0].TotalTokens != 443 {
		t.Fatalf("retry total tokens=%d want 443", retry[0].TotalTokens)
	}
}

func TestOpenClawSessionUsageBudgetObservations_SkipsStaleInitialBackfill(t *testing.T) {
	now := time.Date(2026, time.July, 7, 2, 40, 0, 0, time.UTC)
	resp := openclawSessionsListResponse{
		Sessions: []openclawSessionUsageEntry{
			{
				Key:           "agent:main:explicit:old-session",
				SessionID:     "old-session",
				UpdatedAt:     now.Add(-48 * time.Hour).UnixMilli(),
				StartedAt:     now.Add(-72 * time.Hour).UnixMilli(),
				InputTokens:   4000,
				OutputTokens:  200,
				ModelProvider: "bridgeit",
				Model:         "gpt-4o-mini",
			},
		},
	}
	observations, next := openclawSessionUsageBudgetObservations(now, openclawUsageBaseline{}, resp)
	if len(observations) != 0 {
		t.Fatalf("observations=%d want 0", len(observations))
	}
	if next["old-session"].InputTokens != 4000 || next["old-session"].OutputTokens != 200 {
		t.Fatalf("next=%+v want cached stale baseline", next["old-session"])
	}
}

func TestObserveOpenClawUsageSnapshot_SerializesBaselineUpdate(t *testing.T) {
	dataDir := t.TempDir()
	store, err := audit.NewStore(filepath.Join(dataDir, "audit.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.Init(); err != nil {
		t.Fatalf("Init: %v", err)
	}
	s := &Sidecar{
		cfg:           &config.Config{DataDir: dataDir},
		store:         store,
		budgetControl: newBudgetControlManager(store, nil),
	}
	now := time.Now().UTC()
	response := openclawSessionsListResponse{Sessions: []openclawSessionUsageEntry{{
		Key:          "agent:main:explicit:concurrent-snapshot",
		SessionID:    "concurrent-snapshot",
		UpdatedAt:    now.UnixMilli(),
		StartedAt:    now.Add(-time.Minute).UnixMilli(),
		InputTokens:  100,
		OutputTokens: 10,
		Model:        "gpt-4o-mini",
	}}}

	// Holding the mutex must keep the whole baseline-to-ledger transaction out.
	s.openClawUsageMu.Lock()
	done := make(chan struct{})
	go func() {
		s.observeOpenClawUsageSnapshot(now, now.Format("2006-01-02"), openclawUsageResponse{}, response)
		close(done)
	}()
	select {
	case <-done:
		t.Fatal("snapshot update bypassed serialization lock")
	case <-time.After(50 * time.Millisecond):
	}
	s.openClawUsageMu.Unlock()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("snapshot update did not complete after lock release")
	}

	rows, err := store.ListBudgetUsageObservationsSince(now.Add(-time.Minute), 10)
	if err != nil {
		t.Fatalf("ListBudgetUsageObservationsSince: %v", err)
	}
	if len(rows) != 1 || rows[0].TotalTokens != 110 {
		t.Fatalf("usage rows = %+v, want one 110-token observation", rows)
	}

	// A repeated cumulative snapshot sees the saved baseline and adds nothing.
	s.observeOpenClawUsageSnapshot(now.Add(time.Second), now.Format("2006-01-02"), openclawUsageResponse{}, response)
	rows, err = store.ListBudgetUsageObservationsSince(now.Add(-time.Minute), 10)
	if err != nil {
		t.Fatalf("ListBudgetUsageObservationsSince after repeat: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("repeat snapshot duplicated usage: %+v", rows)
	}
}

func requireUsageMetric(t *testing.T, metrics []otelDashboardMetric, name, provider, model string) otelDashboardMetric {
	t.Helper()
	for _, metric := range metrics {
		if metric.metricName == name && metric.provider == provider && metric.model == model {
			return metric
		}
	}
	t.Fatalf("metric %s provider=%s model=%s not found in %#v", name, provider, model, metrics)
	return otelDashboardMetric{}
}
