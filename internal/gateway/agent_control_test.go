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
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/defenseclaw/defenseclaw/internal/config"
)

func TestAgentControlEvaluateDeny(t *testing.T) {
	t.Setenv("AGENT_CONTROL_API_KEY", "test-key")

	var got agentControlEvaluationRequest
	var gotEvents agentControlEventsRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != "test-key" {
			t.Fatalf("X-API-Key = %q, want test-key", r.Header.Get("X-API-Key"))
		}
		switch r.URL.Path {
		case agentControlEvaluationPath:
			if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"is_safe": false,
				"confidence": 0.98,
				"reason": "matched deny control",
				"matches": [{
					"control_execution_id": "exec-2",
					"control_id": 2,
					"control_name": "deny-dangerous-shell-pre-tool",
					"action": "deny",
					"result": {"matched": true, "confidence": 0.99, "message": "dangerous command"}
				}],
				"errors": [],
				"non_matches": []
			}`))
		case agentControlEventsPath:
			if err := json.NewDecoder(r.Body).Decode(&gotEvents); err != nil {
				t.Fatalf("decode events: %v", err)
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"received":1,"processed":1,"dropped":0}`))
		default:
			t.Fatalf("path = %q, want %q or %q", r.URL.Path, agentControlEvaluationPath, agentControlEventsPath)
		}
	}))
	defer server.Close()

	client := newAgentControlClient(config.AgentControlConfig{
		Enabled:   true,
		URL:       server.URL,
		TimeoutMS: 1000,
		AgentName: "defenseclaw-openclaw",
		FailMode:  "open",
	}, "openclaw")
	if client == nil {
		t.Fatal("client is nil")
	}

	decision := client.evaluate(t.Context(), "pre", agentControlStep{
		Type:  "tool",
		Name:  "shell",
		Input: map[string]interface{}{"command": "kubectl delete pod x"},
	})
	if decision == nil {
		t.Fatal("decision is nil")
	}
	if !decision.Matched || decision.Action != "deny" || decision.ControlID != 2 {
		t.Fatalf("decision = %+v, want matched deny control 2", decision)
	}
	if got.AgentName != "defenseclaw-openclaw" || got.Stage != "pre" || got.Step.Type != "tool" || got.Step.Name != "shell" {
		t.Fatalf("request = %+v", got)
	}
	if len(gotEvents.Events) != 1 {
		t.Fatalf("events = %+v, want one control execution event", gotEvents)
	}
	ev := gotEvents.Events[0]
	if ev.ControlExecutionID != "exec-2" || ev.AgentName != "defenseclaw-openclaw" || ev.ControlID != 2 || ev.Action != "deny" || !ev.Matched {
		t.Fatalf("event = %+v, want matched deny control event", ev)
	}
	if ev.CheckStage != "pre" || ev.AppliesTo != "tool_call" || ev.TraceID == "" || ev.SpanID == "" {
		t.Fatalf("event correlation/scope = %+v", ev)
	}
}

func TestAgentControlFailClosedDenies(t *testing.T) {
	client := newAgentControlClient(config.AgentControlConfig{
		Enabled:   true,
		URL:       "http://127.0.0.1:1",
		TimeoutMS: 1,
		AgentName: "defenseclaw-openclaw",
		FailMode:  "closed",
	}, "openclaw")

	decision := client.errorDecision("pre", agentControlStep{Type: "tool", Name: "shell", Input: "x"}, 0, http.ErrServerClosed)
	if decision.Action != "deny" || !decision.Matched || decision.IsSafe {
		t.Fatalf("decision = %+v, want fail-closed deny", decision)
	}
}

func TestMergeAgentControlIntoToolVerdict(t *testing.T) {
	verdict := &ToolInspectVerdict{Action: "allow", Severity: "NONE", Findings: []string{}}
	decision := &agentControlDecision{
		Enabled:     true,
		Matched:     true,
		IsSafe:      false,
		Action:      "deny",
		ControlID:   2,
		ControlName: "deny-dangerous-shell-pre-tool",
		Confidence:  0.99,
		Reason:      "dangerous command",
	}

	mergeAgentControlIntoToolVerdict(verdict, decision)

	if verdict.Action != "block" || verdict.Severity != "HIGH" {
		t.Fatalf("verdict = %+v, want block/HIGH", verdict)
	}
	if verdict.AgentControl == nil || verdict.AgentControl.ControlID != 2 {
		t.Fatalf("agent control decision missing from verdict: %+v", verdict)
	}
}

func TestInspectTool_LazilyRebuildsAgentControlClient(t *testing.T) {
	t.Setenv("AGENT_CONTROL_API_KEY", "test-key")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case agentControlEvaluationPath:
			if r.Header.Get("X-API-Key") != "test-key" {
				t.Fatalf("X-API-Key = %q, want test-key", r.Header.Get("X-API-Key"))
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"is_safe": false,
				"confidence": 1.0,
				"matches": [{
					"control_execution_id": "exec-4",
					"control_id": 4,
					"control_name": "require-approval-thousandeyes-test-change",
					"action": "steer",
					"result": {"matched": true, "confidence": 1.0, "message": "approval required"},
					"steering_context": {"message": "Pause for operator approval."}
				}],
				"errors": [],
				"non_matches": []
			}`))
		case agentControlEventsPath:
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"received":1,"processed":1,"dropped":0}`))
		default:
			t.Fatalf("path = %q, want %q or %q", r.URL.Path, agentControlEvaluationPath, agentControlEventsPath)
		}
	}))
	defer server.Close()

	store, logger := testStoreAndLogger(t)
	cfg := &config.Config{}
	cfg.Guardrail.Mode = "action"
	cfg.AgentControl = config.AgentControlConfig{
		Enabled:   true,
		URL:       server.URL,
		APIKeyEnv: "AGENT_CONTROL_API_KEY",
		TimeoutMS: 1000,
		AgentName: "defenseclaw-openclaw",
		FailMode:  "open",
	}
	api := NewAPIServer("127.0.0.1:0", NewSidecarHealth(), nil, store, logger, cfg)
	api.agentControl = nil
	if client := api.agentControlClient(); client == nil {
		t.Fatalf("agentControlClient() = nil with cfg=%+v", api.scannerCfg.AgentControl)
	}
	api.agentControl = nil

	_, verdict := postInspect(t, api, `{"tool":"mcp__thousandeyes-mcp__create_synthetic_test","args":{"mcp_server":"thousandeyes-mcp","mcp_tool":"create_synthetic_test","arguments":{"testName":"defenseclaw-demo-teastore-k8s"}}}`)
	if verdict.RawAction != "alert" || verdict.Action != "alert" {
		t.Fatalf("verdict = %+v, want action=alert raw_action=alert", verdict)
	}
	if verdict.AgentControl == nil {
		t.Fatalf("agent control decision missing from verdict: %+v", verdict)
	}
	if verdict.AgentControl.ControlName != "require-approval-thousandeyes-test-change" {
		t.Fatalf("control = %+v, want require-approval-thousandeyes-test-change", verdict.AgentControl)
	}
	if api.agentControl == nil {
		t.Fatal("agentControl client was not rebuilt")
	}
}

func TestAgentControlClient_ConcurrentLazyRebuild(t *testing.T) {
	t.Setenv("AGENT_CONTROL_API_KEY", "test-key")
	cfg := &config.Config{
		AgentControl: config.AgentControlConfig{
			Enabled:   true,
			URL:       "http://agent-control.test",
			APIKeyEnv: "AGENT_CONTROL_API_KEY",
			TimeoutMS: 1000,
		},
	}
	api := &APIServer{scannerCfg: cfg}

	const callers = 64
	clients := make(chan *agentControlClient, callers)
	var wg sync.WaitGroup
	for range callers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			clients <- api.agentControlClient()
		}()
	}
	wg.Wait()
	close(clients)

	var first *agentControlClient
	for client := range clients {
		if client == nil {
			t.Fatal("agentControlClient returned nil")
		}
		if first == nil {
			first = client
			continue
		}
		if client != first {
			t.Fatal("concurrent lazy rebuild returned multiple clients")
		}
	}
}

func TestInspectTool_SlowAIDStillReturnsAgentControlVerdict(t *testing.T) {
	t.Setenv("AGENT_CONTROL_API_KEY", "test-key")

	aidServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(inspectScanTimeout + 200*time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"is_safe": true,
			"action": "Allow",
			"rules": [],
			"processed_rules": []
		}`))
	}))
	defer aidServer.Close()

	agentControlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case agentControlEvaluationPath:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"is_safe": false,
				"confidence": 1.0,
				"matches": [{
					"control_execution_id": "exec-4",
					"control_id": 4,
					"control_name": "require-approval-thousandeyes-test-change",
					"action": "steer",
					"result": {"matched": true, "confidence": 1.0, "message": "approval required"},
					"steering_context": {"message": "Pause for operator approval."}
				}],
				"errors": [],
				"non_matches": []
			}`))
		case agentControlEventsPath:
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"received":1,"processed":1,"dropped":0}`))
		default:
			t.Fatalf("path = %q, want %q or %q", r.URL.Path, agentControlEvaluationPath, agentControlEventsPath)
		}
	}))
	defer agentControlServer.Close()

	store, logger := testStoreAndLogger(t)
	cfg := &config.Config{}
	cfg.Guardrail.Mode = "action"
	cfg.AgentControl = config.AgentControlConfig{
		Enabled:   true,
		URL:       agentControlServer.URL,
		APIKeyEnv: "AGENT_CONTROL_API_KEY",
		TimeoutMS: 1000,
		AgentName: "defenseclaw-openclaw",
		FailMode:  "open",
	}
	api := NewAPIServer("127.0.0.1:0", NewSidecarHealth(), nil, store, logger, cfg)
	api.ciscoInspector = &CiscoInspectClient{
		apiKey:   "aid-key",
		endpoint: aidServer.URL,
		client:   aidServer.Client(),
		timeout:  5 * time.Second,
	}

	rec, verdict := postInspect(t, api, `{"tool":"mcp__thousandeyes-mcp__create_synthetic_test","args":{"mcp_server":"thousandeyes-mcp","mcp_tool":"create_synthetic_test","arguments":{"testName":"defenseclaw-demo-teastore-k8s"}}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if verdict.RawAction != "alert" || verdict.Action != "alert" {
		t.Fatalf("verdict = %+v, want action=alert raw_action=alert", verdict)
	}
	if verdict.AgentControl == nil || verdict.AgentControl.ControlName != "require-approval-thousandeyes-test-change" {
		t.Fatalf("agent control = %+v, want require-approval-thousandeyes-test-change", verdict.AgentControl)
	}
}

func TestInspectTool_BoundsSlowAIDOnBenignShell(t *testing.T) {
	called := make(chan struct{}, 1)
	aidServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called <- struct{}{}
		time.Sleep(inspectToolTimeout + 500*time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"is_safe": true,
			"action": "Allow",
			"rules": [],
			"processed_rules": []
		}`))
	}))
	defer aidServer.Close()

	api := testAPIServerWithConfig(t, "observe")
	api.ciscoInspector = &CiscoInspectClient{
		apiKey:   "aid-key",
		endpoint: aidServer.URL,
		client:   aidServer.Client(),
		timeout:  5 * time.Second,
	}

	rec, verdict := postInspect(t, api, `{"tool":"shell","args":{"command":"kubectl -n teastore get pods"}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if verdict.RawAction != "allow" || verdict.Action != "allow" {
		t.Fatalf("verdict = %+v, want action=allow raw_action=allow", verdict)
	}
	select {
	case <-called:
	default:
		t.Fatal("generic OpenClaw inspect path skipped Cisco AI Defense")
	}
}
