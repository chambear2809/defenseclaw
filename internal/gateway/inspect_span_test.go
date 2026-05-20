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
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/defenseclaw/defenseclaw/internal/telemetry"
)

func TestInspectToolSpanCarriesDemoHeadersAndVerdictWithoutRawArgs(t *testing.T) {
	exp := tracetest.NewInMemoryExporter()
	reader := sdkmetric.NewManualReader()
	provider, err := telemetry.NewProviderForTraceTest(reader, exp)
	if err != nil {
		t.Fatalf("NewProviderForTraceTest: %v", err)
	}

	api := testAPIServerWithConfig(t, "observe")
	api.SetOTelProvider(provider)
	ctx, parent := provider.StartGuardrailStageSpan(context.Background(), "http", "request", "")
	body := `{"tool":"shell","args":{"command":"kubectl delete pods --all -n defenseclaw","token":"secret-token"}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/inspect/tool", bytes.NewBufferString(body)).WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(enterpriseOpsWorkflowHeader, "enterprise-k8s-thousandeyes")
	req.Header.Set(enterpriseOpsStepHeader, "agent-dangerous-k8s-delete")
	req.Header.Set(enterpriseOpsPhaseHeader, "contain")
	req.Header.Set(enterpriseOpsActionClassHeader, "destructive")
	w := httptest.NewRecorder()

	api.handleInspectTool(w, req)
	provider.EndGuardrailStageSpan(parent, "allow", "NONE", "", 1)

	if w.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 body=%s", w.Code, w.Body.String())
	}
	var verdict ToolInspectVerdict
	if err := json.NewDecoder(w.Body).Decode(&verdict); err != nil {
		t.Fatalf("decode verdict: %v", err)
	}
	if verdict.RawAction != "block" || !verdict.WouldBlock {
		t.Fatalf("verdict raw=%q would_block=%v want block/true", verdict.RawAction, verdict.WouldBlock)
	}

	var inspectSpan tracetest.SpanStub
	found := false
	for _, span := range exp.GetSpans() {
		if span.Name == "inspect/shell" {
			inspectSpan = span
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("inspect/shell span not found; spans=%d", len(exp.GetSpans()))
	}
	if got, want := inspectSpan.SpanContext.TraceID(), parent.SpanContext().TraceID(); got != want {
		t.Fatalf("inspect trace_id=%s want parent trace_id=%s", got, want)
	}
	for key, want := range map[string]string{
		"defenseclaw.demo.workflow_id":             "enterprise-k8s-thousandeyes",
		"defenseclaw.demo.step_id":                 "agent-dangerous-k8s-delete",
		"defenseclaw.demo.phase":                   "contain",
		"defenseclaw.demo.action_class":            "destructive",
		"defenseclaw.inspect.verdict.raw_action":   "block",
		"defenseclaw.inspect.verdict.final_action": "allow",
		"defenseclaw.inspect.verdict.severity":     verdict.Severity,
	} {
		got, ok := attrByKey(inspectSpan.Attributes, key)
		if !ok {
			t.Fatalf("missing span attribute %s", key)
		}
		if got.AsString() != want {
			t.Fatalf("%s=%q want %q", key, got.AsString(), want)
		}
	}
	gotWouldBlock, ok := attrByKey(inspectSpan.Attributes, "defenseclaw.inspect.verdict.would_block")
	if !ok || !gotWouldBlock.AsBool() {
		t.Fatalf("defenseclaw.inspect.verdict.would_block=%v ok=%v want true", gotWouldBlock.AsBool(), ok)
	}
	allAttrs := ""
	for _, attr := range inspectSpan.Attributes {
		allAttrs += attr.Value.Emit()
	}
	for _, forbidden := range []string{"kubectl delete", "secret-token", "defenseclaw"} {
		if strings.Contains(allAttrs, forbidden) {
			t.Fatalf("inspect span leaked raw request data %q in attrs: %s", forbidden, allAttrs)
		}
	}
}

func TestInspectSpanAttributesIncludeAgentControlName(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/inspect/tool", nil)
	req.Header.Set(enterpriseOpsWorkflowHeader, "enterprise-k8s-thousandeyes")
	verdict := &ToolInspectVerdict{
		Action:     "allow",
		RawAction:  "block",
		Severity:   "HIGH",
		WouldBlock: true,
		AgentControl: &agentControlDecision{
			ControlName: "deny-dangerous-shell-pre-tool",
			Action:      "deny",
		},
	}
	attrs := inspectSpanAttributes(req, verdict)
	attrs = append(attrs, agentControlSpanAttributes(verdict.AgentControl)...)

	got, ok := attrByKey(attrs, "agent_control.control_name")
	if !ok || got.AsString() != "deny-dangerous-shell-pre-tool" {
		t.Fatalf("agent_control.control_name=%q ok=%v", got.AsString(), ok)
	}
}
