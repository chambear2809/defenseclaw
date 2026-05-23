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

package telemetry

import (
	"context"
	"testing"
	"time"

	otellog "go.opentelemetry.io/otel/log"
	sdklog "go.opentelemetry.io/otel/sdk/log"
)

func TestEndLLMSpan_EmitsCorrelatedGenAIInferenceDetailsLog(t *testing.T) {
	p, exp := newTracingProviderWithLogCapture(t)

	_, span := p.StartLLMSpan(context.Background(), "openai", "gpt-5-nano", "openai", 1024, 0.2)
	p.EndLLMSpan(
		context.Background(),
		span,
		"gpt-5-nano",
		12,
		34,
		[]string{"stop"},
		0,
		"none",
		"",
		"openai",
		time.Now(),
		"defenseclaw-openclaw",
		"openclaw",
		"defenseclaw-openclaw",
		"",
	)

	recs := exp.snapshot()
	if len(recs) != 1 {
		t.Fatalf("got %d log records, want 1", len(recs))
	}
	rec := recs[0]
	if rec.EventName() != genAIInferenceDetailsEventName {
		t.Fatalf("EventName() = %q, want %q", rec.EventName(), genAIInferenceDetailsEventName)
	}
	if !rec.TraceID().IsValid() {
		t.Fatal("GenAI details log is missing trace ID correlation")
	}
	if !rec.SpanID().IsValid() {
		t.Fatal("GenAI details log is missing span ID correlation")
	}

	for key, want := range map[string]string{
		"event.name":            genAIInferenceDetailsEventName,
		"gen_ai.framework":      "defenseclaw",
		"gen_ai.system":         "openai",
		"gen_ai.provider.name":  "openai",
		"gen_ai.operation.name": "chat",
		"gen_ai.request.model":  "gpt-5-nano",
		"gen_ai.response.model": "gpt-5-nano",
		"gen_ai.agent.name":     "defenseclaw-openclaw",
		"gen_ai.agent.id":       "defenseclaw-openclaw",
	} {
		if got := attrValue(rec, key); got != want {
			t.Fatalf("%s = %q, want %q", key, got, want)
		}
	}

	body := rec.Body()
	if body.Kind() != otellog.KindMap {
		t.Fatalf("body kind = %v, want map", body.Kind())
	}
	if messages := mapValue(body, "gen_ai.input.messages"); messages.Kind() != otellog.KindSlice || len(messages.AsSlice()) != 1 {
		t.Fatalf("input messages = %v, want one redacted message", messages)
	}
	if messages := mapValue(body, "gen_ai.output.messages"); messages.Kind() != otellog.KindSlice || len(messages.AsSlice()) != 1 {
		t.Fatalf("output messages = %v, want one redacted message", messages)
	}
	if instructions := mapValue(body, "gen_ai.system_instructions"); instructions.Kind() != otellog.KindSlice {
		t.Fatalf("system instructions = %v, want slice", instructions)
	}
}

func newTracingProviderWithLogCapture(t *testing.T) (*Provider, *capturedLogExporter) {
	t.Helper()
	p, _ := newTracingProvider(t)
	exp := &capturedLogExporter{}
	lp := sdklog.NewLoggerProvider(
		sdklog.WithProcessor(sdklog.NewSimpleProcessor(exp)),
	)
	p.loggerProvider = lp
	p.logger = lp.Logger("test")
	t.Cleanup(func() { _ = lp.Shutdown(context.Background()) })
	return p, exp
}

func mapValue(v otellog.Value, key string) otellog.Value {
	for _, kv := range v.AsMap() {
		if kv.Key == key {
			return kv.Value
		}
	}
	return otellog.Value{}
}
