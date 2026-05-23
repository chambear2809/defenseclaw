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
	"time"

	otellog "go.opentelemetry.io/otel/log"

	"github.com/defenseclaw/defenseclaw/internal/redaction"
)

const genAIInferenceDetailsEventName = "gen_ai.client.inference.operation.details"

// EmitGenAIInferenceDetailsLog emits the OTel event record consumed by
// Splunk's AI trace UI for chat invocation details. The span remains the trace
// root, while this correlated log record carries the redacted conversation
// envelope expected by the GenAI views.
func (p *Provider) EmitGenAIInferenceDetailsLog(
	ctx context.Context,
	providerName string,
	requestModel string,
	responseModel string,
	promptTokens int,
	completionTokens int,
	finishReasons []string,
	agentName string,
	agentID string,
	content LLMSpanContent,
) {
	if p == nil || !p.LogsEnabled() {
		return
	}

	now := time.Now()
	rec := otellog.Record{}
	rec.SetTimestamp(now)
	rec.SetObservedTimestamp(now)
	rec.SetSeverity(otellog.SeverityInfo)
	rec.SetSeverityText("INFO")
	rec.SetEventName(genAIInferenceDetailsEventName)
	rec.SetBody(otellog.MapValue(
		otellog.KeyValue{
			Key: "gen_ai.input.messages",
			Value: otellog.SliceValue(
				genAITextMessageLogValue("user", genAIMessageContentForLog(content.Input, "<redacted by DefenseClaw>"), ""),
			),
		},
		otellog.KeyValue{
			Key: "gen_ai.output.messages",
			Value: otellog.SliceValue(
				genAITextMessageLogValue("assistant", genAIMessageContentForLog(content.Output, "<redacted by DefenseClaw>"), firstString(finishReasons)),
			),
		},
		otellog.KeyValue{
			Key:   "gen_ai.system_instructions",
			Value: otellog.SliceValue(),
		},
	))

	attrs := []otellog.KeyValue{
		otellog.String("event.name", genAIInferenceDetailsEventName),
		otellog.String("gen_ai.framework", "defenseclaw"),
		otellog.String("gen_ai.system", providerName),
		otellog.String("gen_ai.provider.name", providerName),
		otellog.String("gen_ai.operation.name", "chat"),
		otellog.String("gen_ai.request.model", requestModel),
		otellog.String("gen_ai.response.model", responseModel),
		otellog.Int("gen_ai.usage.input_tokens", promptTokens),
		otellog.Int("gen_ai.usage.output_tokens", completionTokens),
		otellog.Int("gen_ai.usage.prompt_tokens", promptTokens),
		otellog.Int("gen_ai.usage.completion_tokens", completionTokens),
		otellog.Int("input_token_count", promptTokens),
		otellog.Int("output_token_count", completionTokens),
	}
	if content.TokenUsageEstimated {
		attrs = append(attrs, otellog.Bool("defenseclaw.usage.estimated", true))
	}
	if agentName != "" {
		attrs = append(attrs, otellog.String("gen_ai.agent.name", agentName))
	}
	if agentID != "" {
		attrs = append(attrs, otellog.String("gen_ai.agent.id", agentID))
	}
	rec.AddAttributes(attrs...)
	p.logger.Emit(ctx, rec)
}

func genAIMessageContentForLog(content, fallback string) string {
	if redaction.DisableAll() && content != "" {
		return content
	}
	return fallback
}

func genAITextMessageLogValue(role, content, finishReason string) otellog.Value {
	kvs := []otellog.KeyValue{
		otellog.String("role", role),
		{
			Key: "parts",
			Value: otellog.SliceValue(otellog.MapValue(
				otellog.String("type", "text"),
				otellog.String("content", content),
			)),
		},
	}
	if finishReason != "" {
		kvs = append(kvs, otellog.String("finish_reason", finishReason))
	}
	return otellog.MapValue(kvs...)
}

func firstString(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}
