// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: Apache-2.0

package audit

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
)

type BudgetPolicyRow struct {
	PolicyID             string    `json:"policy_id"`
	AgentID              string    `json:"agent_id"`
	AgentName            string    `json:"agent_name,omitempty"`
	SessionTokenBudget   int64     `json:"session_token_budget,omitempty"`
	SessionCostBudgetUSD float64   `json:"session_cost_budget_usd,omitempty"`
	DailyTokenBudget     int64     `json:"daily_token_budget,omitempty"`
	DailyCostBudgetUSD   float64   `json:"daily_cost_budget_usd,omitempty"`
	Action               string    `json:"action"`
	UpdatedAt            time.Time `json:"updated_at"`
	UpdatedBy            string    `json:"updated_by,omitempty"`
	Source               string    `json:"source,omitempty"`
}

type BudgetUsageObservation struct {
	ID               string    `json:"id"`
	Timestamp        time.Time `json:"timestamp"`
	Source           string    `json:"source"`
	Connector        string    `json:"connector,omitempty"`
	AgentID          string    `json:"agent_id"`
	AgentName        string    `json:"agent_name,omitempty"`
	SessionID        string    `json:"session_id,omitempty"`
	Model            string    `json:"model,omitempty"`
	PromptTokens     int64     `json:"prompt_tokens,omitempty"`
	CompletionTokens int64     `json:"completion_tokens,omitempty"`
	TotalTokens      int64     `json:"total_tokens,omitempty"`
	CostUSD          float64   `json:"cost_usd,omitempty"`
}

type BudgetUsageTotals struct {
	SessionTokens  int64   `json:"session_tokens,omitempty"`
	SessionCostUSD float64 `json:"session_cost_usd,omitempty"`
	DailyTokens    int64   `json:"daily_tokens,omitempty"`
	DailyCostUSD   float64 `json:"daily_cost_usd,omitempty"`
}

type BudgetUsageSubjectRow struct {
	AgentID   string `json:"agent_id"`
	AgentName string `json:"agent_name,omitempty"`
	SessionID string `json:"session_id,omitempty"`
}

type BudgetAlertRow struct {
	AlertKey         string     `json:"alert_key"`
	PolicyID         string     `json:"policy_id"`
	AgentID          string     `json:"agent_id"`
	AgentName        string     `json:"agent_name,omitempty"`
	SessionID        string     `json:"session_id,omitempty"`
	Window           string     `json:"window"`
	Metric           string     `json:"metric"`
	Action           string     `json:"action"`
	Status           string     `json:"status"`
	Reason           string     `json:"reason"`
	ObservedValue    float64    `json:"observed_value"`
	BudgetValue      float64    `json:"budget_value"`
	FirstTriggeredAt time.Time  `json:"first_triggered_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	ReleasedAt       *time.Time `json:"released_at,omitempty"`
}

func normalizeBudgetAction(action string) string {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "deny", "block":
		return "deny"
	default:
		return "steer"
	}
}

func parseStoredAuditTime(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, nil
	}
	if parsed, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return parsed, nil
	}
	return time.Parse(time.RFC3339, raw)
}

func (s *Store) UpsertBudgetPolicy(row BudgetPolicyRow) error {
	row.AgentID = strings.TrimSpace(row.AgentID)
	row.AgentName = strings.TrimSpace(row.AgentName)
	row.PolicyID = strings.TrimSpace(row.PolicyID)
	if row.AgentID == "" {
		return fmt.Errorf("audit: upsert budget policy: agent_id is required")
	}
	if row.PolicyID == "" {
		row.PolicyID = uuid.New().String()
	}
	if row.UpdatedAt.IsZero() {
		row.UpdatedAt = time.Now().UTC()
	}
	row.Action = normalizeBudgetAction(row.Action)
	if row.Source == "" {
		row.Source = "local"
	}
	_, err := s.execDB(context.Background(), "audit",
		`INSERT INTO budget_control_policies
		 (policy_id, agent_id, agent_name, session_token_budget, session_cost_budget_usd, daily_token_budget, daily_cost_budget_usd, action, updated_at, updated_by, source)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(agent_id) DO UPDATE SET
		 policy_id = excluded.policy_id,
		 agent_name = excluded.agent_name,
		 session_token_budget = excluded.session_token_budget,
		 session_cost_budget_usd = excluded.session_cost_budget_usd,
		 daily_token_budget = excluded.daily_token_budget,
		 daily_cost_budget_usd = excluded.daily_cost_budget_usd,
		 action = excluded.action,
		 updated_at = excluded.updated_at,
		 updated_by = excluded.updated_by,
		 source = excluded.source`,
		row.PolicyID,
		row.AgentID,
		nullStr(row.AgentName),
		nullInt64(row.SessionTokenBudget),
		nullFloat64(row.SessionCostBudgetUSD),
		nullInt64(row.DailyTokenBudget),
		nullFloat64(row.DailyCostBudgetUSD),
		row.Action,
		row.UpdatedAt.UTC().Format(time.RFC3339Nano),
		nullStr(row.UpdatedBy),
		nullStr(row.Source),
	)
	if err != nil {
		return fmt.Errorf("audit: upsert budget policy: %w", err)
	}
	return nil
}

func (s *Store) DeleteBudgetPolicy(agentID string) error {
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return fmt.Errorf("audit: delete budget policy: agent_id is required")
	}
	if _, err := s.execDB(context.Background(), "audit", `DELETE FROM budget_control_policies WHERE agent_id = ?`, agentID); err != nil {
		return fmt.Errorf("audit: delete budget policy: %w", err)
	}
	return nil
}

// DeleteBudgetPolicyAndReleaseAlerts removes one agent-scoped policy and
// releases every alert it produced in the same transaction. Alerts generated
// by a catch-all policy carry concrete agent IDs, so policy_id is the primary
// release key; agent_id also cleans up any orphaned alerts from older policy
// revisions.
func (s *Store) DeleteBudgetPolicyAndReleaseAlerts(agentID string, releasedAt time.Time) error {
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return fmt.Errorf("audit: release budget policy: agent_id is required")
	}
	if releasedAt.IsZero() {
		releasedAt = time.Now().UTC()
	}
	timestamp := releasedAt.UTC().Format(time.RFC3339Nano)
	ctx := context.Background()
	err := retryBusy(ctx, "budget_policy_release", func() error {
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback() //nolint:errcheck

		var policyID string
		err = tx.QueryRowContext(ctx,
			`SELECT policy_id FROM budget_control_policies WHERE agent_id = ?`,
			agentID,
		).Scan(&policyID)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM budget_control_policies WHERE agent_id = ?`, agentID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE budget_control_alerts
			    SET status = 'released', updated_at = ?, released_at = ?
			  WHERE status = 'open'
			    AND (agent_id = ? OR (? != '' AND policy_id = ?))`,
			timestamp, timestamp, agentID, policyID, policyID,
		); err != nil {
			return err
		}
		return tx.Commit()
	})
	if err != nil {
		return fmt.Errorf("audit: release budget policy: %w", err)
	}
	return nil
}

func (s *Store) ResolveBudgetPolicy(agentID string) (*BudgetPolicyRow, error) {
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return nil, nil
	}
	rows, err := s.queryReadDB(context.Background(), "budget_policy_resolve",
		`SELECT policy_id, agent_id, agent_name, session_token_budget, session_cost_budget_usd,
		        daily_token_budget, daily_cost_budget_usd, action, updated_at, updated_by, source
		   FROM budget_control_policies
		  WHERE agent_id IN (?, '*')
		  ORDER BY CASE WHEN agent_id = ? THEN 0 ELSE 1 END
		  LIMIT 1`,
		agentID, agentID,
	)
	if err != nil {
		return nil, fmt.Errorf("audit: resolve budget policy: %w", err)
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, nil
	}
	row, err := scanBudgetPolicyRow(rows)
	if err != nil {
		return nil, err
	}
	return &row, rows.Err()
}

func (s *Store) ListBudgetPolicies() ([]BudgetPolicyRow, error) {
	rows, err := s.queryReadDB(context.Background(), "budget_policy_list",
		`SELECT policy_id, agent_id, agent_name, session_token_budget, session_cost_budget_usd,
		        daily_token_budget, daily_cost_budget_usd, action, updated_at, updated_by, source
		   FROM budget_control_policies
		  ORDER BY CASE WHEN agent_id = '*' THEN 1 ELSE 0 END, agent_id ASC`,
	)
	if err != nil {
		return nil, fmt.Errorf("audit: list budget policies: %w", err)
	}
	defer rows.Close()
	var out []BudgetPolicyRow
	for rows.Next() {
		row, err := scanBudgetPolicyRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func scanBudgetPolicyRow(rows rowScanner) (BudgetPolicyRow, error) {
	var (
		row                                     BudgetPolicyRow
		agentName, updatedBy, source, updatedAt sql.NullString
		sessionTokenBudget, dailyTokenBudget    sql.NullInt64
		sessionCostBudget, dailyCostBudget      sql.NullFloat64
	)
	if err := rows.Scan(
		&row.PolicyID,
		&row.AgentID,
		&agentName,
		&sessionTokenBudget,
		&sessionCostBudget,
		&dailyTokenBudget,
		&dailyCostBudget,
		&row.Action,
		&updatedAt,
		&updatedBy,
		&source,
	); err != nil {
		return BudgetPolicyRow{}, fmt.Errorf("audit: scan budget policy: %w", err)
	}
	row.AgentName = agentName.String
	row.SessionTokenBudget = sessionTokenBudget.Int64
	row.SessionCostBudgetUSD = sessionCostBudget.Float64
	row.DailyTokenBudget = dailyTokenBudget.Int64
	row.DailyCostBudgetUSD = dailyCostBudget.Float64
	row.UpdatedBy = updatedBy.String
	row.Source = source.String
	if updatedAt.Valid {
		parsed, err := parseStoredAuditTime(updatedAt.String)
		if err != nil {
			return BudgetPolicyRow{}, fmt.Errorf("audit: parse budget policy updated_at: %w", err)
		}
		row.UpdatedAt = parsed
	}
	return row, nil
}

func (s *Store) InsertBudgetUsageObservation(obs BudgetUsageObservation) error {
	return s.writeBudgetUsageObservation(obs, false)
}

// UpsertBudgetUsageObservation records a stable, cumulative-source interval.
// Callers must provide an ID that identifies the interval independently of its
// current value. Retries can then replace a partially persisted snapshot
// without double-counting it in budget totals.
func (s *Store) UpsertBudgetUsageObservation(obs BudgetUsageObservation) error {
	return s.writeBudgetUsageObservation(obs, true)
}

func (s *Store) writeBudgetUsageObservation(obs BudgetUsageObservation, upsert bool) error {
	obs.AgentID = strings.TrimSpace(obs.AgentID)
	obs.AgentName = strings.TrimSpace(obs.AgentName)
	obs.SessionID = strings.TrimSpace(obs.SessionID)
	if obs.AgentID == "" {
		return fmt.Errorf("audit: insert budget usage: agent_id is required")
	}
	if strings.TrimSpace(obs.Source) == "" {
		obs.Source = "unknown"
	}
	if obs.ID == "" {
		obs.ID = uuid.New().String()
	}
	if obs.Timestamp.IsZero() {
		obs.Timestamp = time.Now().UTC()
	}
	obs.PromptTokens = maxBudgetInt64(obs.PromptTokens, 0)
	obs.CompletionTokens = maxBudgetInt64(obs.CompletionTokens, 0)
	componentTotal := obs.PromptTokens
	if obs.CompletionTokens > math.MaxInt64-componentTotal {
		componentTotal = math.MaxInt64
	} else {
		componentTotal += obs.CompletionTokens
	}
	obs.TotalTokens = maxBudgetInt64(obs.TotalTokens, componentTotal)
	if obs.CostUSD < 0 || math.IsNaN(obs.CostUSD) || math.IsInf(obs.CostUSD, 0) {
		obs.CostUSD = 0
	}
	query := `INSERT INTO budget_usage_ledger
		 (id, timestamp, source, connector, agent_id, agent_name, session_id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	if upsert {
		query += ` ON CONFLICT(id) DO UPDATE SET
		 timestamp = excluded.timestamp,
		 source = excluded.source,
		 connector = excluded.connector,
		 agent_id = excluded.agent_id,
		 agent_name = excluded.agent_name,
		 session_id = excluded.session_id,
		 model = excluded.model,
		 prompt_tokens = excluded.prompt_tokens,
		 completion_tokens = excluded.completion_tokens,
		 total_tokens = excluded.total_tokens,
		 cost_usd = excluded.cost_usd`
	}
	_, err := s.execDB(context.Background(), "audit",
		query,
		obs.ID,
		obs.Timestamp.UTC().Format(time.RFC3339Nano),
		obs.Source,
		nullStr(obs.Connector),
		obs.AgentID,
		nullStr(obs.AgentName),
		nullStr(obs.SessionID),
		nullStr(obs.Model),
		nullInt64(obs.PromptTokens),
		nullInt64(obs.CompletionTokens),
		nullInt64(obs.TotalTokens),
		nullFloat64(obs.CostUSD),
	)
	if err != nil {
		return fmt.Errorf("audit: insert budget usage: %w", err)
	}
	return nil
}

func (s *Store) BudgetUsageTotals(agentID, sessionID string, now time.Time) (BudgetUsageTotals, error) {
	if strings.TrimSpace(agentID) == "" {
		return BudgetUsageTotals{}, nil
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	var totals BudgetUsageTotals
	since := now.Add(-24 * time.Hour).UTC().Format(time.RFC3339Nano)
	if err := s.scanRow(context.Background(), "budget_usage_daily",
		s.readDBForQuery().QueryRowContext(context.Background(),
			`SELECT COALESCE(SUM(total_tokens), 0), COALESCE(SUM(cost_usd), 0)
			   FROM budget_usage_ledger
			  WHERE agent_id = ? AND timestamp >= ?`,
			agentID, since,
		),
		&totals.DailyTokens, &totals.DailyCostUSD,
	); err != nil {
		return BudgetUsageTotals{}, fmt.Errorf("audit: budget usage daily totals: %w", err)
	}
	if strings.TrimSpace(sessionID) == "" {
		return totals, nil
	}
	if err := s.scanRow(context.Background(), "budget_usage_session",
		s.readDBForQuery().QueryRowContext(context.Background(),
			`SELECT COALESCE(SUM(total_tokens), 0), COALESCE(SUM(cost_usd), 0)
			   FROM budget_usage_ledger
			  WHERE agent_id = ? AND session_id = ?`,
			agentID, sessionID,
		),
		&totals.SessionTokens, &totals.SessionCostUSD,
	); err != nil {
		return BudgetUsageTotals{}, fmt.Errorf("audit: budget usage session totals: %w", err)
	}
	return totals, nil
}

func (s *Store) LatestBudgetUsageObservationForSession(sessionID string) (*BudgetUsageObservation, error) {
	if strings.TrimSpace(sessionID) == "" {
		return nil, nil
	}
	rows, err := s.queryReadDB(context.Background(), "budget_usage_latest_session",
		`SELECT id, timestamp, source, connector, agent_id, agent_name, session_id, model,
		        prompt_tokens, completion_tokens, total_tokens, cost_usd
		   FROM budget_usage_ledger
		  WHERE session_id = ?
		  ORDER BY timestamp DESC
		  LIMIT 1`,
		sessionID,
	)
	if err != nil {
		return nil, fmt.Errorf("audit: latest budget usage observation for session: %w", err)
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, nil
	}
	row, err := scanBudgetUsageObservation(rows)
	if err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &row, nil
}

func (s *Store) ListBudgetUsageSubjects(agentID string, limit int) ([]BudgetUsageSubjectRow, error) {
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 5000
	}
	query := `SELECT agent_id, COALESCE(MAX(agent_name), agent_id), COALESCE(session_id, '')
		   FROM budget_usage_ledger
		  WHERE agent_id != ''`
	args := []any{}
	if agentID != "*" {
		query += ` AND agent_id = ?`
		args = append(args, agentID)
	}
	query += `
		  GROUP BY agent_id, COALESCE(session_id, '')
		  ORDER BY MAX(timestamp) DESC
		  LIMIT ?`
	args = append(args, limit)
	rows, err := s.queryReadDB(context.Background(), "budget_usage_subjects", query, args...)
	if err != nil {
		return nil, fmt.Errorf("audit: list budget usage subjects: %w", err)
	}
	defer rows.Close()
	var out []BudgetUsageSubjectRow
	for rows.Next() {
		var row BudgetUsageSubjectRow
		if err := rows.Scan(&row.AgentID, &row.AgentName, &row.SessionID); err != nil {
			return nil, fmt.Errorf("audit: scan budget usage subject: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *Store) ListBudgetUsageObservationsSince(since time.Time, limit int) ([]BudgetUsageObservation, error) {
	if limit <= 0 {
		limit = 5000
	}
	rows, err := s.queryReadDB(context.Background(), "budget_usage_list",
		`SELECT id, timestamp, source, connector, agent_id, agent_name, session_id, model,
		        prompt_tokens, completion_tokens, total_tokens, cost_usd
		   FROM budget_usage_ledger
		  WHERE timestamp >= ?
		  ORDER BY timestamp DESC
		  LIMIT ?`,
		since.UTC().Format(time.RFC3339Nano), limit,
	)
	if err != nil {
		return nil, fmt.Errorf("audit: list budget usage observations: %w", err)
	}
	defer rows.Close()
	var out []BudgetUsageObservation
	for rows.Next() {
		row, err := scanBudgetUsageObservation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func scanBudgetUsageObservation(rows rowScanner) (BudgetUsageObservation, error) {
	var (
		row                                    BudgetUsageObservation
		timestamp, connector, agentName        sql.NullString
		sessionID, model, source               sql.NullString
		promptTokens, completionTokens, totals sql.NullInt64
		costUSD                                sql.NullFloat64
	)
	if err := rows.Scan(
		&row.ID,
		&timestamp,
		&source,
		&connector,
		&row.AgentID,
		&agentName,
		&sessionID,
		&model,
		&promptTokens,
		&completionTokens,
		&totals,
		&costUSD,
	); err != nil {
		return BudgetUsageObservation{}, fmt.Errorf("audit: scan budget usage observation: %w", err)
	}
	if timestamp.Valid {
		parsed, err := parseStoredAuditTime(timestamp.String)
		if err != nil {
			return BudgetUsageObservation{}, fmt.Errorf("audit: parse budget usage timestamp: %w", err)
		}
		row.Timestamp = parsed
	}
	row.Source = source.String
	row.Connector = connector.String
	row.AgentName = agentName.String
	row.SessionID = sessionID.String
	row.Model = model.String
	row.PromptTokens = promptTokens.Int64
	row.CompletionTokens = completionTokens.Int64
	row.TotalTokens = totals.Int64
	row.CostUSD = costUSD.Float64
	return row, nil
}

func (s *Store) UpsertBudgetAlert(row BudgetAlertRow) error {
	if strings.TrimSpace(row.AlertKey) == "" {
		return fmt.Errorf("audit: upsert budget alert: alert_key is required")
	}
	if row.FirstTriggeredAt.IsZero() {
		row.FirstTriggeredAt = time.Now().UTC()
	}
	if row.UpdatedAt.IsZero() {
		row.UpdatedAt = row.FirstTriggeredAt
	}
	if row.Status == "" {
		row.Status = "open"
	}
	row.Action = normalizeBudgetAction(row.Action)
	var releasedAt sql.NullString
	if row.ReleasedAt != nil && !row.ReleasedAt.IsZero() {
		releasedAt = sql.NullString{String: row.ReleasedAt.UTC().Format(time.RFC3339Nano), Valid: true}
	}
	_, err := s.execDB(context.Background(), "audit",
		`INSERT INTO budget_control_alerts
		 (alert_key, policy_id, agent_id, agent_name, session_id, window, metric, action, status, reason, observed_value, budget_value, first_triggered_at, updated_at, released_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(alert_key) DO UPDATE SET
		 policy_id = excluded.policy_id,
		 agent_name = excluded.agent_name,
		 session_id = excluded.session_id,
		 window = excluded.window,
		 metric = excluded.metric,
		 action = excluded.action,
		 status = excluded.status,
		 reason = excluded.reason,
		 observed_value = excluded.observed_value,
		 budget_value = excluded.budget_value,
		 updated_at = excluded.updated_at,
		 released_at = excluded.released_at`,
		row.AlertKey,
		row.PolicyID,
		row.AgentID,
		nullStr(row.AgentName),
		nullStr(row.SessionID),
		row.Window,
		row.Metric,
		row.Action,
		row.Status,
		row.Reason,
		row.ObservedValue,
		row.BudgetValue,
		row.FirstTriggeredAt.UTC().Format(time.RFC3339Nano),
		row.UpdatedAt.UTC().Format(time.RFC3339Nano),
		releasedAt,
	)
	if err != nil {
		return fmt.Errorf("audit: upsert budget alert: %w", err)
	}
	return nil
}

func (s *Store) ReleaseBudgetAlerts(agentID, sessionID string, releasedAt time.Time) error {
	agentID = strings.TrimSpace(agentID)
	sessionID = strings.TrimSpace(sessionID)
	if agentID == "" {
		return fmt.Errorf("audit: release budget alerts: agent_id is required")
	}
	if releasedAt.IsZero() {
		releasedAt = time.Now().UTC()
	}
	query := `UPDATE budget_control_alerts
	             SET status = 'released', updated_at = ?, released_at = ?
	           WHERE agent_id = ? AND status = 'open'`
	args := []any{
		releasedAt.UTC().Format(time.RFC3339Nano),
		releasedAt.UTC().Format(time.RFC3339Nano),
		agentID,
	}
	if sessionID != "" {
		query += ` AND session_id = ?`
		args = append(args, sessionID)
	}
	if _, err := s.execDB(context.Background(), "audit", query, args...); err != nil {
		return fmt.Errorf("audit: release budget alerts: %w", err)
	}
	return nil
}

func (s *Store) ListBudgetAlerts(limit int) ([]BudgetAlertRow, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.queryReadDB(context.Background(), "budget_alert_list",
		`SELECT alert_key, policy_id, agent_id, agent_name, session_id, window, metric, action, status, reason,
		        observed_value, budget_value, first_triggered_at, updated_at, released_at
		   FROM budget_control_alerts
		  ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, updated_at DESC
		  LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("audit: list budget alerts: %w", err)
	}
	defer rows.Close()
	var out []BudgetAlertRow
	for rows.Next() {
		var (
			row                                   BudgetAlertRow
			agentName, sessionID                  sql.NullString
			firstTriggeredAt, updatedAt, released sql.NullString
		)
		if err := rows.Scan(
			&row.AlertKey,
			&row.PolicyID,
			&row.AgentID,
			&agentName,
			&sessionID,
			&row.Window,
			&row.Metric,
			&row.Action,
			&row.Status,
			&row.Reason,
			&row.ObservedValue,
			&row.BudgetValue,
			&firstTriggeredAt,
			&updatedAt,
			&released,
		); err != nil {
			return nil, fmt.Errorf("audit: scan budget alert: %w", err)
		}
		row.AgentName = agentName.String
		row.SessionID = sessionID.String
		if firstTriggeredAt.Valid {
			parsed, err := parseStoredAuditTime(firstTriggeredAt.String)
			if err != nil {
				return nil, fmt.Errorf("audit: parse budget alert first_triggered_at: %w", err)
			}
			row.FirstTriggeredAt = parsed
		}
		if updatedAt.Valid {
			parsed, err := parseStoredAuditTime(updatedAt.String)
			if err != nil {
				return nil, fmt.Errorf("audit: parse budget alert updated_at: %w", err)
			}
			row.UpdatedAt = parsed
		}
		if released.Valid {
			parsed, err := parseStoredAuditTime(released.String)
			if err != nil {
				return nil, fmt.Errorf("audit: parse budget alert released_at: %w", err)
			}
			row.ReleasedAt = &parsed
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *Store) ListOpenBudgetAlerts(agentID, sessionID string) ([]BudgetAlertRow, error) {
	agentID = strings.TrimSpace(agentID)
	sessionID = strings.TrimSpace(sessionID)
	if agentID == "" {
		return nil, nil
	}
	query := `SELECT alert_key, policy_id, agent_id, agent_name, session_id, window, metric, action, status, reason,
	                 observed_value, budget_value, first_triggered_at, updated_at, released_at
	            FROM budget_control_alerts
	           WHERE agent_id = ? AND status = 'open'`
	args := []any{agentID}
	if sessionID != "" {
		query += ` AND (session_id = '' OR session_id IS NULL OR session_id = ?)`
		args = append(args, sessionID)
	} else {
		// A sessionless observation (or policy apply) can reconcile daily
		// alerts, but it must not resolve a still-breached session merely
		// because that session was outside the current evaluation scope.
		query += ` AND (session_id = '' OR session_id IS NULL)`
	}
	query += ` ORDER BY updated_at DESC`
	rows, err := s.queryReadDB(context.Background(), "budget_alert_open_list", query, args...)
	if err != nil {
		return nil, fmt.Errorf("audit: list open budget alerts: %w", err)
	}
	defer rows.Close()
	var out []BudgetAlertRow
	for rows.Next() {
		var (
			row                                  BudgetAlertRow
			agentName, session, firstAt, updated sql.NullString
			released                             sql.NullString
		)
		if err := rows.Scan(
			&row.AlertKey,
			&row.PolicyID,
			&row.AgentID,
			&agentName,
			&session,
			&row.Window,
			&row.Metric,
			&row.Action,
			&row.Status,
			&row.Reason,
			&row.ObservedValue,
			&row.BudgetValue,
			&firstAt,
			&updated,
			&released,
		); err != nil {
			return nil, fmt.Errorf("audit: scan open budget alert: %w", err)
		}
		row.AgentName = agentName.String
		row.SessionID = session.String
		if firstAt.Valid {
			parsed, err := parseStoredAuditTime(firstAt.String)
			if err != nil {
				return nil, fmt.Errorf("audit: parse open budget alert first_triggered_at: %w", err)
			}
			row.FirstTriggeredAt = parsed
		}
		if updated.Valid {
			parsed, err := parseStoredAuditTime(updated.String)
			if err != nil {
				return nil, fmt.Errorf("audit: parse open budget alert updated_at: %w", err)
			}
			row.UpdatedAt = parsed
		}
		if released.Valid {
			parsed, err := parseStoredAuditTime(released.String)
			if err != nil {
				return nil, fmt.Errorf("audit: parse open budget alert released_at: %w", err)
			}
			row.ReleasedAt = &parsed
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func nullInt64(v int64) sql.NullInt64 {
	if v == 0 {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: v, Valid: true}
}

func nullFloat64(v float64) sql.NullFloat64 {
	if v == 0 {
		return sql.NullFloat64{}
	}
	return sql.NullFloat64{Float64: v, Valid: true}
}

func maxBudgetInt64(a, b int64) int64 {
	if a >= b {
		return a
	}
	return b
}
