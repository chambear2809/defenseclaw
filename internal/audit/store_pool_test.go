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
	"context"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestStore_PolicyReadsBypassBusyWriterPool(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "audit.db")
	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.Init(); err != nil {
		t.Fatalf("Init: %v", err)
	}
	if err := store.SetActionField("tool", "shell", "install", "block", "test"); err != nil {
		t.Fatalf("seed action: %v", err)
	}
	if err := store.UpsertBudgetPolicy(BudgetPolicyRow{AgentID: "main", DailyTokenBudget: 10, Action: "deny"}); err != nil {
		t.Fatalf("seed budget policy: %v", err)
	}
	if err := store.InsertBudgetUsageObservation(BudgetUsageObservation{
		AgentID: "main", Source: "test", TotalTokens: 11,
	}); err != nil {
		t.Fatalf("seed budget usage: %v", err)
	}

	// Hold the primary pool's only connection. Before the dedicated read pool,
	// this made every inspect-time action lookup wait behind audit persistence.
	writerConn, err := store.db.Conn(context.Background())
	if err != nil {
		t.Fatalf("reserve writer connection: %v", err)
	}
	defer writerConn.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	blocked, err := store.HasActionContext(ctx, "tool", "shell", "install", "block")
	if err != nil {
		t.Fatalf("policy read queued behind writer pool: %v", err)
	}
	if !blocked {
		t.Fatal("policy read did not observe committed block action")
	}

	// Avoid deadlocking the test if a future regression routes either budget
	// query back through the occupied writer pool.
	releaseWriter := time.AfterFunc(500*time.Millisecond, func() { _ = writerConn.Close() })
	started := time.Now()
	policy, err := store.ResolveBudgetPolicy("main")
	if err != nil {
		t.Fatalf("resolve budget policy: %v", err)
	}
	if policy == nil || policy.DailyTokenBudget != 10 {
		t.Fatalf("unexpected budget policy: %+v", policy)
	}
	totals, err := store.BudgetUsageTotals("main", "", time.Now().UTC())
	if err != nil {
		t.Fatalf("budget usage totals: %v", err)
	}
	if totals.DailyTokens != 11 {
		t.Fatalf("daily tokens = %d, want 11", totals.DailyTokens)
	}
	if elapsed := time.Since(started); elapsed >= 250*time.Millisecond {
		t.Fatalf("budget reads queued behind writer pool for %s", elapsed)
	}
	releaseWriter.Stop()
}

// TestStore_ConcurrentWritersSerialize asserts that the audit store
// can absorb a burst of concurrent writers without returning any
// SQLITE_BUSY errors. The combination we depend on is:
//
//   - DSN-resident busy_timeout=5000 (so any in-driver contention
//     waits up to 5 seconds instead of failing fast),
//   - SetMaxOpenConns(1) (so Go's database/sql mutex serializes
//     writers cleanly instead of letting them race for the SQLite
//     write lock),
//   - retryBusy() (so any residual BUSY makes it through after
//     exponential backoff).
//
// Without these the test reliably hit `database is locked` on a
// busy laptop; with them in place we expect every row to land.
func TestStore_ConcurrentWritersSerialize(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "audit.db")
	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.Init(); err != nil {
		t.Fatalf("Init: %v", err)
	}

	const (
		writers       = 50
		eventsPerProc = 10
	)
	var wg sync.WaitGroup
	errs := make(chan error, writers*eventsPerProc)
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for j := 0; j < eventsPerProc; j++ {
				if err := store.LogEvent(Event{
					Timestamp: time.Now().UTC(),
					Action:    "burst.test",
					Target:    "concurrent.serialize",
					Details:   "",
				}); err != nil {
					errs <- err
					return
				}
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("LogEvent returned error under concurrency: %v", err)
		}
	}

	// All rows must be present — pool size of 1 plus retries means
	// no write should silently disappear.
	var count int
	row := store.db.QueryRow(`SELECT COUNT(*) FROM audit_events WHERE action='burst.test'`)
	if err := row.Scan(&count); err != nil {
		t.Fatalf("count audit_events: %v", err)
	}
	if want := writers * eventsPerProc; count != want {
		t.Fatalf("expected %d audit_events, got %d", want, count)
	}
}

// TestStore_PragmasAppliedAcrossPool checks that the pragmas we set
// in the DSN actually take effect. The bug this guards against:
// PRAGMA busy_timeout=5000 set via db.Exec only mutates the
// connection that ran the statement — every new pool connection
// starts at 0 unless the pragma is in the DSN. We assert the values
// against a fresh QueryRow that can pull any connection.
func TestStore_PragmasAppliedAcrossPool(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "audit.db")
	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.Init(); err != nil {
		t.Fatalf("Init: %v", err)
	}

	cases := []struct {
		pragma string
		want   int64
	}{
		{"busy_timeout", 5000},
		// synchronous: 0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA
		{"synchronous", 1},
		// foreign_keys: bool 0/1
		{"foreign_keys", 1},
	}
	for _, tc := range cases {
		var got int64
		if err := store.db.QueryRow("PRAGMA " + tc.pragma).Scan(&got); err != nil {
			t.Fatalf("read pragma %s: %v", tc.pragma, err)
		}
		if got != tc.want {
			t.Fatalf("pragma %s: want %d, got %d", tc.pragma, tc.want, got)
		}
	}

	// journal_mode is a string ("wal").
	var jm string
	if err := store.db.QueryRow("PRAGMA journal_mode").Scan(&jm); err != nil {
		t.Fatalf("read journal_mode: %v", err)
	}
	if jm != "wal" {
		t.Fatalf("journal_mode: want wal, got %q", jm)
	}
}
