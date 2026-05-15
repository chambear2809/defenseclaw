# Copyright 2026 Cisco Systems, Inc. and its affiliates
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import copy
import json
import os
import sys
import types
import unittest
from unittest.mock import patch

import requests
from click.testing import CliRunner

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from defenseclaw.commands.cmd_demo import demo
from defenseclaw.enterprise_ops_demo import (
    TEASTORE_INTERNAL_URL,
    build_autonomy_slo_report,
    build_teastore_o11y_mcp_evidence,
    build_thousandeyes_http_test_payload,
    derive_autonomy_slo_evidence,
    default_workflow,
    evaluate_autonomy_slo,
    evaluate_live_verdict,
    execute_thousandeyes_create,
    inspect_steps,
    log_live_galileo_session,
    resolve_thousandeyes_agent,
    run_live_inspect,
    run_splunk_o11y_detector_poll,
    run_thousandeyes_live_checks,
    validate_workflow,
)


class FakeResponse:
    def __init__(self, status_code, payload, headers=None):
        self.status_code = status_code
        self._payload = payload
        self.ok = 200 <= status_code < 300
        self.text = json.dumps(payload)
        self.headers = headers or {}

    def json(self):
        return self._payload

    def raise_for_status(self):
        if not self.ok:
            raise requests.HTTPError(f"HTTP {self.status_code}", response=self)


class EnterpriseOpsDemoTests(unittest.TestCase):
    def test_default_workflow_validates(self):
        result = validate_workflow(default_workflow())
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["errors"], [])

    def test_mutations_require_approval_or_deny(self):
        workflow = default_workflow()
        for step in workflow["steps"]:
            if step["id"] == "agent-safe-k8s-remediation":
                step["expected_decision"] = {"decision": "allow", "reason": "bad fixture"}
                break

        result = validate_workflow(workflow)
        self.assertFalse(result["ok"])
        self.assertTrue(any("mutation must require approval" in err for err in result["errors"]))

    def test_inspect_steps_are_inspect_only(self):
        steps = inspect_steps(default_workflow())
        self.assertGreaterEqual(len(steps), 4)
        for step in steps:
            self.assertIn("tool", step["inspect_request"])
            self.assertNotIn("execute", step["inspect_request"])

    def test_live_verdict_allows_expected_block_in_observe_mode(self):
        step = next(item for item in default_workflow()["steps"] if item["id"] == "agent-dangerous-k8s-delete")
        verdict = {
            "action": "allow",
            "raw_action": "block",
            "severity": "CRITICAL",
            "mode": "observe",
            "would_block": True,
        }

        result = evaluate_live_verdict(step, verdict)
        self.assertTrue(result["ok"], result)

    def test_live_verdict_flags_missing_would_block_in_observe_mode(self):
        step = next(item for item in default_workflow()["steps"] if item["id"] == "agent-dangerous-k8s-delete")
        verdict = {
            "action": "allow",
            "raw_action": "block",
            "severity": "CRITICAL",
            "mode": "observe",
            "would_block": False,
        }

        result = evaluate_live_verdict(step, verdict)
        self.assertFalse(result["ok"])
        self.assertTrue(any("would_block=false" in err for err in result["errors"]))

    def test_run_live_inspect_sends_per_step_demo_headers(self):
        calls = []

        def fake_post(url, headers, json, timeout):
            calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
            step_id = headers["X-DefenseClaw-Step-ID"]
            if step_id == "agent-dangerous-k8s-delete":
                payload = {
                    "action": "allow",
                    "raw_action": "block",
                    "severity": "HIGH",
                    "mode": "observe",
                    "would_block": True,
                }
            elif step_id in {"agent-create-thousandeyes-test", "agent-safe-k8s-remediation"}:
                payload = {"action": "allow", "raw_action": "alert", "severity": "MEDIUM", "mode": "observe"}
            else:
                payload = {"action": "allow", "raw_action": "allow", "severity": "NONE", "mode": "observe"}
            return FakeResponse(200, payload)

        with patch("defenseclaw.enterprise_ops_demo.requests.post", side_effect=fake_post):
            results = run_live_inspect(
                default_workflow(),
                api_base="http://defenseclaw.test",
                token="gateway-token",
                timeout=4,
            )

        self.assertTrue(all(item["ok"] for item in results), results)
        self.assertGreaterEqual(len(calls), 4)
        first = calls[0]
        self.assertEqual(first["url"], "http://defenseclaw.test/api/v1/inspect/tool")
        self.assertEqual(first["headers"]["Authorization"], "Bearer gateway-token")
        self.assertEqual(first["headers"]["X-DefenseClaw-Workflow-ID"], "enterprise-k8s-thousandeyes")
        self.assertEqual(first["headers"]["X-DefenseClaw-Step-ID"], "agent-read-k8s-health")
        self.assertEqual(first["headers"]["X-DefenseClaw-Phase"], "investigate")
        self.assertEqual(first["headers"]["X-DefenseClaw-Action-Class"], "read-only")

    def test_demo_command_json(self):
        runner = CliRunner()
        result = runner.invoke(demo, ["enterprise-ops", "--format", "json"], catch_exceptions=False)
        self.assertEqual(result.exit_code, 0, result.output)
        payload = json.loads(result.output)
        self.assertEqual(payload["workflow"]["id"], "enterprise-k8s-thousandeyes")
        self.assertTrue(payload["validation"]["ok"], payload["validation"])
        self.assertEqual(payload["thousandeyes_live"], {})

    def test_demo_command_markdown_mentions_story_surfaces(self):
        runner = CliRunner()
        result = runner.invoke(demo, ["enterprise-ops"], catch_exceptions=False)
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Governed AI Change Controller", result.output)
        self.assertIn("thousandeyes", result.output.lower())
        self.assertIn("splunk_o11y", result.output)
        self.assertIn("teastore", result.output.lower())

    def test_demo_command_control_room_links_saved_playground(self):
        runner = CliRunner()
        result = runner.invoke(demo, ["enterprise-ops", "--format", "control-room"], catch_exceptions=False)
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Control Room", result.output)
        self.assertIn("Saved Playground", result.output)
        self.assertIn("e969b856-9d5d-48a4-90af-b33e20fe6fab", result.output)
        self.assertIn("Autonomy SLO", result.output)

    def test_default_workflow_returns_copy(self):
        workflow = default_workflow()
        mutated = copy.deepcopy(workflow)
        mutated["steps"][0]["id"] = "changed"
        self.assertNotEqual(mutated["steps"][0]["id"], default_workflow()["steps"][0]["id"])

    def test_thousandeyes_live_checks_are_read_only_and_redacted(self):
        calls = []
        payloads = {
            "/account-groups": {"accountGroups": [{}, {}], "_links": {}},
            "/agents": {"agents": [{}, {}, {}], "_links": {}},
            "/tests/http-server": {"tests": [{}], "_links": {}},
        }

        def fake_get(url, headers, timeout):
            calls.append({"url": url, "headers": headers, "timeout": timeout})
            for path, payload in payloads.items():
                if url.endswith(path):
                    return FakeResponse(200, payload)
            return FakeResponse(404, {"title": "not found"})

        with patch("defenseclaw.enterprise_ops_demo.requests.get", side_effect=fake_get):
            result = run_thousandeyes_live_checks(
                token="secret-token",
                api_base="https://te.example/v7/",
                timeout=3,
            )

        self.assertTrue(result["ok"], result)
        self.assertEqual([call["url"] for call in calls], [
            "https://te.example/v7/account-groups",
            "https://te.example/v7/agents",
            "https://te.example/v7/tests/http-server",
        ])
        self.assertTrue(all(call["headers"]["Authorization"] == "Bearer secret-token" for call in calls))
        self.assertTrue(all(call["timeout"] == 3 for call in calls))
        self.assertEqual(result["checks"][0]["counts"]["accountGroups"], 2)
        self.assertEqual(result["checks"][1]["counts"]["agents"], 3)
        self.assertNotIn("secret-token", json.dumps(result))

    def test_thousandeyes_live_checks_missing_token(self):
        with patch("defenseclaw.enterprise_ops_demo.requests.get") as mock_get:
            result = run_thousandeyes_live_checks(token=None)

        self.assertFalse(result["ok"])
        self.assertEqual(result["checks"], [])
        self.assertIn("token is not set", result["errors"][0])
        mock_get.assert_not_called()

    def test_o11y_mcp_evidence_marks_slow_or_error_probe_degraded(self):
        with patch(
            "defenseclaw.enterprise_ops_demo.requests.get",
            return_value=FakeResponse(503, {"status": "down"}),
        ):
            result = build_teastore_o11y_mcp_evidence(
                ticket_id="INC-1",
                service_name="teastore-webui",
                target_url=TEASTORE_INTERNAL_URL,
                probe_url="http://example.test/teastore",
            )

        self.assertTrue(result["ok"], result)
        self.assertEqual(result["mcp_server"], "splunk-o11y")
        self.assertEqual(result["findings"][0]["status"], "degraded")
        self.assertEqual(result["findings"][0]["http_status"], 503)
        self.assertEqual(result["findings"][1]["status"], "needs_external_verification")

    def test_splunk_o11y_detector_poll_filters_teastore_detectors_and_redacts_token(self):
        calls = []

        def fake_get(url, headers, params, timeout):
            calls.append({"url": url, "headers": headers, "params": params, "timeout": timeout})
            return FakeResponse(
                200,
                {
                    "results": [
                        {
                            "id": "detector-1",
                            "name": "TeaStore WebUI latency",
                            "tags": ["teastore", "service:teastore-webui"],
                            "activeAlertCountBySeverity": {"Critical": 1, "Major": 0},
                        },
                        {
                            "id": "detector-2",
                            "name": "Inventory API latency",
                            "tags": ["inventory"],
                            "activeAlertCountBySeverity": {"Critical": 3},
                        },
                    ]
                },
            )

        with patch("defenseclaw.enterprise_ops_demo.requests.get", side_effect=fake_get):
            result = run_splunk_o11y_detector_poll(
                token="secret-token",
                realm="us1",
                service_name="teastore-webui",
                detector_tags=("teastore",),
                query="teastore",
                timeout=3,
            )

        self.assertTrue(result["ok"], result)
        self.assertEqual(result["endpoint"], "https://api.us1.observability.splunkcloud.com/v2/detector")
        self.assertEqual(result["matched"], 1)
        self.assertEqual(result["active_alerts"], 1)
        self.assertEqual(result["highest_severity"], "Critical")
        self.assertEqual(calls[0]["headers"]["X-SF-TOKEN"], "secret-token")
        self.assertEqual(calls[0]["params"], {"limit": 100})
        self.assertNotIn("secret-token", json.dumps(result))

    def test_splunk_o11y_detector_poll_missing_token(self):
        with patch("defenseclaw.enterprise_ops_demo.requests.get") as mock_get:
            result = run_splunk_o11y_detector_poll(token=None, realm="us1")

        self.assertFalse(result["ok"])
        self.assertIn("token is not set", result["errors"][0])
        mock_get.assert_not_called()

    def test_thousandeyes_test_payload_uses_agent_and_teastore_url(self):
        payload = build_thousandeyes_http_test_payload(
            test_name="defenseclaw-demo-teastore-k8s",
            target_url=TEASTORE_INTERNAL_URL,
            agent_id="1666117",
        )

        self.assertEqual(payload["testName"], "defenseclaw-demo-teastore-k8s")
        self.assertEqual(payload["url"], TEASTORE_INTERNAL_URL)
        self.assertEqual(payload["agents"], [{"agentId": "1666117"}])
        self.assertTrue(payload["networkMeasurements"])

    def test_resolve_thousandeyes_agent_prefers_online_prefix_match(self):
        def fake_get(url, headers, timeout):
            self.assertTrue(url.endswith("/agents"))
            return FakeResponse(
                200,
                {
                    "agents": [
                        {
                            "agentId": "1",
                            "agentName": "te-agent-aleccham-old",
                            "agentType": "enterprise",
                            "agentState": "offline",
                            "hostname": "te-agent-aleccham",
                            "enabled": True,
                        },
                        {
                            "agentId": "2",
                            "agentName": "te-agent-aleccham-live",
                            "agentType": "enterprise",
                            "agentState": "online",
                            "hostname": "te-agent-aleccham",
                            "enabled": True,
                        },
                    ]
                },
            )

        with patch("defenseclaw.enterprise_ops_demo.requests.get", side_effect=fake_get):
            result = resolve_thousandeyes_agent(token="secret-token", api_base="https://te.example/v7")

        self.assertTrue(result["ok"], result)
        self.assertEqual(result["agent"]["agentId"], "2")
        self.assertNotIn("secret-token", json.dumps(result))

    def test_execute_thousandeyes_create_requires_approval(self):
        with patch("defenseclaw.enterprise_ops_demo.requests.post") as mock_post:
            result = execute_thousandeyes_create(
                token="secret-token",
                approved=False,
                inspect_api_base="http://defenseclaw.test",
                inspect_token="gateway-token",
            )

        self.assertFalse(result["ok"])
        self.assertFalse(result["executed"])
        self.assertIn("approval", result["errors"][0])
        mock_post.assert_not_called()

    def test_execute_thousandeyes_create_inspects_then_posts_when_approved(self):
        get_payloads = [
            FakeResponse(
                200,
                {
                    "agents": [
                        {
                            "agentId": "1666117",
                            "agentName": "te-agent-aleccham-live",
                            "agentType": "enterprise",
                            "agentState": "online",
                            "hostname": "te-agent-aleccham",
                            "enabled": True,
                        }
                    ]
                },
            ),
            FakeResponse(200, {"tests": []}),
        ]
        post_payloads = [
            FakeResponse(
                200,
                {
                    "action": "allow",
                    "raw_action": "alert",
                    "severity": "MEDIUM",
                    "mode": "observe",
                    "would_block": False,
                    "agent_control": {"matched": True, "control_name": "require-approval-thousandeyes-test-change"},
                },
            ),
            FakeResponse(
                201,
                {
                    "testId": "9001",
                    "testName": "defenseclaw-demo-teastore-k8s",
                    "url": TEASTORE_INTERNAL_URL,
                    "enabled": True,
                    "interval": 60,
                },
            ),
        ]

        with patch("defenseclaw.enterprise_ops_demo.requests.get", side_effect=get_payloads) as mock_get, patch(
            "defenseclaw.enterprise_ops_demo.requests.post",
            side_effect=post_payloads,
        ) as mock_post:
            result = execute_thousandeyes_create(
                token="secret-token",
                approved=True,
                inspect_api_base="http://defenseclaw.test",
                inspect_token="gateway-token",
                api_base="https://te.example/v7",
            )

        self.assertTrue(result["ok"], result)
        self.assertTrue(result["executed"])
        self.assertEqual(result["test"]["testId"], "9001")
        self.assertEqual(mock_get.call_count, 2)
        self.assertEqual(mock_post.call_count, 2)
        self.assertEqual(mock_post.call_args_list[1].kwargs["json"]["agents"], [{"agentId": "1666117"}])
        self.assertNotIn("secret-token", json.dumps(result))

    def test_execute_thousandeyes_create_reuses_matching_url_and_agent(self):
        get_payloads = [
            FakeResponse(
                200,
                {
                    "agents": [
                        {
                            "agentId": "1666117",
                            "agentName": "te-agent-aleccham-live",
                            "agentType": "enterprise",
                            "agentState": "online",
                            "hostname": "te-agent-aleccham",
                            "enabled": True,
                        }
                    ]
                },
            ),
            FakeResponse(
                200,
                {
                    "tests": [
                        {
                            "testId": "8597876",
                            "testName": "defenseclaw-demo-teastore-k8s",
                            "url": TEASTORE_INTERNAL_URL,
                            "enabled": True,
                            "interval": 60,
                            "agents": [{"agentId": "1666117"}],
                        }
                    ]
                },
            ),
        ]
        post_payloads = [
            FakeResponse(
                200,
                {
                    "action": "allow",
                    "raw_action": "alert",
                    "severity": "MEDIUM",
                    "mode": "observe",
                    "would_block": False,
                    "agent_control": {"matched": True, "control_name": "require-approval-thousandeyes-test-change"},
                },
            ),
        ]

        with patch("defenseclaw.enterprise_ops_demo.requests.get", side_effect=get_payloads) as mock_get, patch(
            "defenseclaw.enterprise_ops_demo.requests.post",
            side_effect=post_payloads,
        ) as mock_post:
            result = execute_thousandeyes_create(
                token="secret-token",
                approved=True,
                inspect_api_base="http://defenseclaw.test",
                inspect_token="gateway-token",
                api_base="https://te.example/v7",
            )

        self.assertTrue(result["ok"], result)
        self.assertFalse(result["executed"])
        self.assertTrue(result["reused_existing"])
        self.assertEqual(result["test"]["testId"], "8597876")
        self.assertEqual(result["test"]["agents"], [{"agentId": "1666117"}])
        self.assertEqual(mock_get.call_count, 2)
        self.assertEqual(mock_post.call_count, 1)

    def test_execute_thousandeyes_create_does_not_reuse_name_only_mismatch(self):
        get_payloads = [
            FakeResponse(
                200,
                {
                    "agents": [
                        {
                            "agentId": "1666117",
                            "agentName": "te-agent-aleccham-live",
                            "agentType": "enterprise",
                            "agentState": "online",
                            "hostname": "te-agent-aleccham",
                            "enabled": True,
                        }
                    ]
                },
            ),
            FakeResponse(
                200,
                {
                    "tests": [
                        {
                            "testId": "bad-match",
                            "testName": "defenseclaw-demo-teastore-k8s",
                            "url": "http://wrong.example/",
                            "enabled": True,
                            "interval": 60,
                            "agents": [{"agentId": "1666117"}],
                        }
                    ]
                },
            ),
        ]
        post_payloads = [
            FakeResponse(
                200,
                {
                    "action": "allow",
                    "raw_action": "alert",
                    "severity": "MEDIUM",
                    "mode": "observe",
                    "would_block": False,
                    "agent_control": {"matched": True, "control_name": "require-approval-thousandeyes-test-change"},
                },
            ),
            FakeResponse(
                201,
                {
                    "testId": "9002",
                    "testName": "defenseclaw-demo-teastore-k8s",
                    "url": TEASTORE_INTERNAL_URL,
                    "enabled": True,
                    "interval": 60,
                },
            ),
        ]

        with patch("defenseclaw.enterprise_ops_demo.requests.get", side_effect=get_payloads) as mock_get, patch(
            "defenseclaw.enterprise_ops_demo.requests.post",
            side_effect=post_payloads,
        ) as mock_post:
            result = execute_thousandeyes_create(
                token="secret-token",
                approved=True,
                inspect_api_base="http://defenseclaw.test",
                inspect_token="gateway-token",
                api_base="https://te.example/v7",
            )

        self.assertTrue(result["ok"], result)
        self.assertTrue(result["executed"])
        self.assertFalse(result["reused_existing"])
        self.assertEqual(result["test"]["testId"], "9002")
        self.assertEqual(mock_get.call_count, 2)
        self.assertEqual(mock_post.call_count, 2)

    def test_demo_command_json_with_live_thousandeyes(self):
        live_result = {
            "ok": True,
            "mode": "read-only",
            "api_base": "https://te.example/v7",
            "checks": [
                {
                    "name": "agents",
                    "method": "GET",
                    "path": "/agents",
                    "ok": True,
                    "status_code": 200,
                    "keys": ["agents"],
                    "counts": {"agents": 3},
                }
            ],
            "errors": [],
        }

        with patch("defenseclaw.commands.cmd_demo.run_thousandeyes_live_checks", return_value=live_result) as mock_live:
            runner = CliRunner()
            result = runner.invoke(
                demo,
                [
                    "enterprise-ops",
                    "--format",
                    "json",
                    "--live-thousandeyes",
                    "--thousandeyes-api-base",
                    "https://te.example/v7",
                ],
                env={"THOUSANDEYES_TOKEN": "secret-token"},
                catch_exceptions=False,
            )

        self.assertEqual(result.exit_code, 0, result.output)
        payload = json.loads(result.output)
        self.assertEqual(payload["thousandeyes_live"], live_result)
        mock_live.assert_called_once_with(token="secret-token", api_base="https://te.example/v7", timeout=10.0)
        self.assertNotIn("secret-token", result.output)

    def test_demo_command_json_with_live_o11y_detectors(self):
        detector_result = {
            "ok": True,
            "mode": "read-only",
            "realm": "us1",
            "endpoint": "https://api.us1.observability.splunkcloud.com/v2/detector",
            "query": "teastore",
            "service": "teastore-webui",
            "detector_tags": ["teastore"],
            "attempt": 1,
            "total": 1,
            "matched": 1,
            "active_alerts": 1,
            "highest_severity": "Critical",
            "detectors": [{"id": "detector-1", "name": "TeaStore WebUI latency", "active_alerts": 1}],
            "snapshots": [],
            "errors": [],
        }

        with patch(
            "defenseclaw.commands.cmd_demo.run_splunk_o11y_detector_poll",
            return_value=detector_result,
        ) as mock_poll:
            runner = CliRunner()
            result = runner.invoke(
                demo,
                [
                    "enterprise-ops",
                    "--format",
                    "json",
                    "--live-o11y-detectors",
                    "--o11y-detector-tag",
                    "service:teastore-webui",
                ],
                env={"SPLUNK_O11Y_TOKEN": "secret-token"},
                catch_exceptions=False,
            )

        self.assertEqual(result.exit_code, 0, result.output)
        payload = json.loads(result.output)
        self.assertEqual(payload["o11y_detectors"], detector_result)
        mock_poll.assert_called_once_with(
            token="secret-token",
            realm="us1",
            service_name="teastore-webui",
            detector_tags=("service:teastore-webui",),
            query="teastore",
            timeout=10.0,
            attempts=1,
            interval_seconds=5.0,
            limit=100,
        )
        self.assertNotIn("secret-token", result.output)

    def test_live_galileo_session_logs_expected_tool_spans(self):
        class FakeLogger:
            instances = []

            def __init__(self, **kwargs):
                self.kwargs = kwargs
                self.tool_spans = []
                self.concluded = False
                self.flushed = False
                FakeLogger.instances.append(self)

            def start_session(self, **kwargs):
                self.session_kwargs = kwargs
                return "session-123"

            def start_trace(self, **kwargs):
                self.trace_kwargs = kwargs
                return "trace-123"

            def add_tool_span(self, **kwargs):
                self.tool_spans.append(kwargs)

            def conclude(self, **kwargs):
                self.conclude_kwargs = kwargs
                self.concluded = True

            def flush(self):
                self.flushed = True

        report = {
            "workflow": default_workflow(),
            "o11y_mcp": {"ok": True, "ticket": {"id": "INC-TEASTORE-001"}},
            "live_inspect": [{"step_id": "agent-read-k8s-health", "ok": True}],
            "thousandeyes_create": {"ok": True, "test": {"testId": "8597876"}},
        }
        fake_module = types.SimpleNamespace(GalileoLogger=FakeLogger)

        with patch.dict(sys.modules, {"galileo": fake_module}):
            result = log_live_galileo_session(
                report,
                ticket_id="INC-TEASTORE-001",
                project="clus-demo",
                log_stream="clus-demo",
            )

        self.assertTrue(result["ok"], result)
        self.assertEqual(result["session_id"], "session-123")
        self.assertEqual(
            result["tool_spans"],
            [
                "O11y detect",
                "K8s read",
                "ThousandEyes inventory",
                "DefenseClaw inspect",
                "TE create/reuse",
                "Remediation proposal",
                "Unsafe action block",
                "Splunk audit closure",
                "Autonomy SLO",
            ],
        )
        logger = FakeLogger.instances[0]
        self.assertEqual(logger.kwargs, {"project": "clus-demo", "log_stream": "clus-demo"})
        self.assertEqual([span["name"] for span in logger.tool_spans], result["tool_spans"])
        self.assertTrue(logger.concluded)
        self.assertTrue(logger.flushed)

    def test_demo_command_json_with_live_galileo_session(self):
        session_result = {
            "ok": True,
            "session_name": "INC-TEASTORE-001 TeaStore incident",
            "session_id": "session-123",
            "tool_spans": [
                "O11y detect",
                "K8s read",
                "ThousandEyes inventory",
                "DefenseClaw inspect",
                "TE create/reuse",
                "Remediation proposal",
                "Unsafe action block",
                "Splunk audit closure",
                "Autonomy SLO",
            ],
            "errors": [],
        }

        with patch(
            "defenseclaw.commands.cmd_demo.log_live_galileo_session",
            return_value=session_result,
        ) as mock_session:
            runner = CliRunner()
            result = runner.invoke(
                demo,
                ["enterprise-ops", "--format", "json", "--live-galileo-session"],
                env={"GALILEO_PROJECT": "clus-demo", "GALILEO_LOG_STREAM": "clus-demo"},
                catch_exceptions=False,
            )

        self.assertEqual(result.exit_code, 0, result.output)
        payload = json.loads(result.output)
        self.assertEqual(payload["galileo_session"], session_result)
        self.assertEqual(mock_session.call_args.kwargs["ticket_id"], "INC-TEASTORE-001")
        self.assertEqual(mock_session.call_args.kwargs["project"], "clus-demo")
        self.assertEqual(mock_session.call_args.kwargs["log_stream"], "clus-demo")

    def test_demo_command_can_allow_galileo_unavailable(self):
        session_result = {
            "ok": False,
            "allowed_unavailable": True,
            "session_name": "INC-TEASTORE-001 TeaStore incident",
            "errors": ["provider quota exhausted"],
        }

        with patch(
            "defenseclaw.commands.cmd_demo.log_live_galileo_session",
            return_value=session_result,
        ) as mock_session:
            runner = CliRunner()
            result = runner.invoke(
                demo,
                [
                    "enterprise-ops",
                    "--format",
                    "json",
                    "--live-galileo-session",
                    "--allow-galileo-unavailable",
                ],
                catch_exceptions=False,
            )

        self.assertEqual(result.exit_code, 0, result.output)
        payload = json.loads(result.output)
        self.assertEqual(payload["galileo_session"], session_result)
        self.assertTrue(mock_session.call_args.kwargs["allow_unavailable"])

    def test_autonomy_slo_waits_for_shadow_evidence(self):
        scorecard = evaluate_autonomy_slo({})

        self.assertFalse(scorecard["ok"])
        self.assertEqual(scorecard["recommendation"], "collect_shadow_evidence")
        self.assertIn("agent_flow_pass_rate", scorecard["missing"])

    def test_derived_autonomy_evidence_does_not_invent_pass_rates(self):
        derived = derive_autonomy_slo_evidence(
            live_results=[
                {"step_id": "agent-read-k8s-health", "ok": True, "raw_action": "allow"},
                {"step_id": "agent-dangerous-k8s-delete", "ok": True, "raw_action": "block", "would_block": True},
            ],
            o11y_mcp_results={"ok": True},
            thousandeyes_create_results={"ok": True, "reused_existing": True},
        )
        report = build_autonomy_slo_report(
            default_workflow(),
            evidence=derived["metrics"],
            derived_evidence=derived,
        )

        self.assertEqual(derived["proven"]["defenseclaw_inspect_steps_ok"], 2)
        self.assertIsNone(derived["metrics"]["galileo"]["agent_flow_pass_rate"])
        self.assertEqual(report["scorecard"]["recommendation"], "collect_shadow_evidence")
        self.assertEqual(report["derived_evidence"]["proven"]["unsafe_action_blocks_observed"], 1)
        self.assertEqual(report["example_passing_evidence"]["galileo"]["unsafe_auto_approval_count"], 0)

    def test_autonomy_slo_graduates_narrow_actions_when_objectives_pass(self):
        evidence = {
            "galileo": {
                "agent_flow_pass_rate": 0.98,
                "action_completion_pass_rate": 0.97,
                "tool_error_rate": 0.0,
                "unsafe_auto_approval_count": 0,
            },
            "splunk_o11y": {
                "post_change_success_rate": 0.995,
                "post_change_regression_count": 0,
            },
            "splunk_enterprise": {"evidence_completeness_rate": 1.0},
        }

        report = build_autonomy_slo_report(
            default_workflow(),
            evidence=evidence,
            thousandeyes_create_results={"reused_existing": True},
        )

        self.assertTrue(report["scorecard"]["ok"], report["scorecard"])
        self.assertEqual(report["scorecard"]["recommendation"], "graduate_narrow_auto_approval")
        te_decision = next(
            item for item in report["shadow_decisions"] if item["step_id"] == "agent-create-thousandeyes-test"
        )
        self.assertEqual(te_decision["shadow_decision"], "candidate_auto_approve")
        self.assertEqual(te_decision["graduation_stage"], "narrow-auto-approval")

    def test_demo_command_json_with_autonomy_slo(self):
        runner = CliRunner()
        with runner.isolated_filesystem():
            evidence = {
                "galileo": {
                    "agent_flow_pass_rate": 0.98,
                    "action_completion_pass_rate": 0.97,
                    "tool_error_rate": 0,
                    "unsafe_auto_approval_count": 0,
                },
                "splunk_o11y": {
                    "post_change_success_rate": 0.995,
                    "post_change_regression_count": 0,
                },
                "splunk_enterprise": {"evidence_completeness_rate": 1.0},
            }
            with open("evidence.json", "w", encoding="utf-8") as handle:
                json.dump(evidence, handle)
            result = runner.invoke(
                demo,
                ["enterprise-ops", "--format", "json", "--autonomy-slo", "--autonomy-evidence", "evidence.json"],
                catch_exceptions=False,
            )

        self.assertEqual(result.exit_code, 0, result.output)
        payload = json.loads(result.output)
        self.assertEqual(payload["autonomy_slo"]["policy"]["id"], "teastore-autonomy-slo")
        self.assertEqual(payload["autonomy_slo"]["scorecard"]["recommendation"], "graduate_narrow_auto_approval")


if __name__ == "__main__":
    unittest.main()
