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

package audit

import (
	"testing"
	"time"
)

func TestStore_ListBudgetUsageObservationsSince(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	base := time.Now().UTC().Truncate(time.Second)
	fixtures := []BudgetUsageObservation{
		{
			ID:               "obs-new",
			Timestamp:        base,
			Source:           "hook",
			Connector:        "langgraph,mcp",
			AgentID:          "incident-triage-agent",
			AgentName:        "incident-triage-agent",
			SessionID:        "sess-1",
			Model:            "gpt-4o-mini",
			PromptTokens:     1000,
			CompletionTokens: 250,
			TotalTokens:      1250,
			CostUSD:          0.12,
		},
		{
			ID:               "obs-old",
			Timestamp:        base.Add(-48 * time.Hour),
			Source:           "otlp",
			Connector:        "defenseclaw",
			AgentID:          "travel-planner-agent",
			AgentName:        "travel-planner-agent",
			SessionID:        "sess-2",
			Model:            "claude-sonnet-4-5",
			PromptTokens:     900,
			CompletionTokens: 300,
			TotalTokens:      1200,
			CostUSD:          0.09,
		},
	}
	for _, fixture := range fixtures {
		if err := store.InsertBudgetUsageObservation(fixture); err != nil {
			t.Fatalf("InsertBudgetUsageObservation(%s): %v", fixture.ID, err)
		}
	}

	rows, err := store.ListBudgetUsageObservationsSince(base.Add(-24*time.Hour), 100)
	if err != nil {
		t.Fatalf("ListBudgetUsageObservationsSince: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows=%d want 1", len(rows))
	}
	if rows[0].ID != "obs-new" {
		t.Fatalf("rows[0].ID=%q want obs-new", rows[0].ID)
	}
	if rows[0].AgentID != "incident-triage-agent" {
		t.Fatalf("rows[0].AgentID=%q want incident-triage-agent", rows[0].AgentID)
	}
	if rows[0].CostUSD != 0.12 {
		t.Fatalf("rows[0].CostUSD=%v want 0.12", rows[0].CostUSD)
	}
}

func TestStore_UpsertBudgetUsageObservationReplacesStableInterval(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	now := time.Now().UTC()
	first := BudgetUsageObservation{
		ID:           "stable-openclaw-interval",
		Timestamp:    now,
		Source:       "openclaw_session_snapshot",
		Connector:    "openclaw",
		AgentID:      "main",
		SessionID:    "session-1",
		PromptTokens: 100,
		TotalTokens:  100,
	}
	if err := store.UpsertBudgetUsageObservation(first); err != nil {
		t.Fatalf("first UpsertBudgetUsageObservation: %v", err)
	}
	updated := first
	updated.Timestamp = now.Add(time.Second)
	updated.PromptTokens = 140
	updated.CompletionTokens = 10
	updated.TotalTokens = 150
	if err := store.UpsertBudgetUsageObservation(updated); err != nil {
		t.Fatalf("second UpsertBudgetUsageObservation: %v", err)
	}

	rows, err := store.ListBudgetUsageObservationsSince(now.Add(-time.Minute), 10)
	if err != nil {
		t.Fatalf("ListBudgetUsageObservationsSince: %v", err)
	}
	if len(rows) != 1 || rows[0].TotalTokens != 150 {
		t.Fatalf("rows=%+v want one replacement totaling 150 tokens", rows)
	}
	totals, err := store.BudgetUsageTotals("main", "session-1", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("BudgetUsageTotals: %v", err)
	}
	if totals.SessionTokens != 150 || totals.DailyTokens != 150 {
		t.Fatalf("totals=%+v want session=daily=150", totals)
	}
}

func TestStore_BudgetUsageObservationCannotReduceSpend(t *testing.T) {
	store, cleanup := newTestStore(t)
	defer cleanup()

	now := time.Now().UTC()
	if err := store.InsertBudgetUsageObservation(BudgetUsageObservation{
		ID:               "malformed-usage",
		Timestamp:        now,
		Source:           "hook",
		AgentID:          "main",
		PromptTokens:     -50,
		CompletionTokens: 10,
		TotalTokens:      1,
		CostUSD:          -2.5,
	}); err != nil {
		t.Fatalf("InsertBudgetUsageObservation: %v", err)
	}
	rows, err := store.ListBudgetUsageObservationsSince(now.Add(-time.Minute), 10)
	if err != nil {
		t.Fatalf("ListBudgetUsageObservationsSince: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows=%+v want one observation", rows)
	}
	if rows[0].PromptTokens != 0 || rows[0].CompletionTokens != 10 || rows[0].TotalTokens != 10 {
		t.Fatalf("normalized tokens=%+v want prompt=0 completion=10 total=10", rows[0])
	}
	if rows[0].CostUSD != 0 {
		t.Fatalf("normalized cost=%v want 0", rows[0].CostUSD)
	}
}
