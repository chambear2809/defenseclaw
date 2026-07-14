import http.client
import http.server
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml
from click.testing import CliRunner
from defenseclaw.c3_agent_tokenomics.cli import build_payload_from_files
from defenseclaw.c3_agent_tokenomics.controls import control_event_from_action, evaluate_runtime_action
from defenseclaw.c3_agent_tokenomics.fixtures import default_galileo_payload, default_o11y_rows
from defenseclaw.c3_agent_tokenomics.galileo import merge_galileo_enrichment, summarize_galileo
from defenseclaw.c3_agent_tokenomics.galileo_config import galileo_config_from_env, resolve_galileo_project
from defenseclaw.c3_agent_tokenomics.gateway_client import GatewayAPIError, GatewayClient, GatewayClientConfig
from defenseclaw.c3_agent_tokenomics.mock_api import C3TokenomicsHandler, make_server
from defenseclaw.c3_agent_tokenomics.transform import (
    build_summary,
    gateway_observations_to_metric_rows,
    infer_provider_from_model,
    metric_point_from_row,
    normalize_token_type,
)
from defenseclaw.commands.cmd_c3_tokenomics import c3_tokenomics


class C3AgentTokenomicsTests(unittest.TestCase):
    def setUp(self):
        self.rows = default_o11y_rows()
        self.galileo = default_galileo_payload()

    def test_token_type_aliases(self):
        self.assertEqual(normalize_token_type("cacheRead"), "cached")
        self.assertEqual(normalize_token_type("prompt"), "input")
        self.assertEqual(normalize_token_type("completion"), "output")

    def test_metric_point_accepts_o11y_dimension_names(self):
        point = metric_point_from_row(self.rows[0])
        self.assertEqual(point.agent_name, "incident-triage-agent")
        self.assertEqual(point.model, "gpt-4o-mini")
        self.assertEqual(point.provider, "openai")
        self.assertEqual(point.token_type, "input")
        self.assertEqual(point.tokens, 14320)

    def test_provider_is_inferred_from_model_name(self):
        self.assertEqual(infer_provider_from_model("gpt-5.5-high"), "openai")
        self.assertEqual(infer_provider_from_model("claude-sonnet-4-5"), "anthropic")
        self.assertEqual(infer_provider_from_model("gemini-2.5-pro"), "google")

    def test_missing_optional_dimensions_normalize_to_unknown(self):
        point = metric_point_from_row({"tokens": 7, "gen_ai.token.type": "prompt"})
        self.assertEqual(point.agent_name, "unknown")
        self.assertEqual(point.service_name, "unknown")
        self.assertEqual(point.provider, "unknown")
        self.assertEqual(point.tokens, 7)

    def test_o11y_summary_totals(self):
        payload = build_summary(self.rows, tenant_id="c3-demo-tenant", workspace_id="wayne-demo")
        s = payload["summary"]
        self.assertEqual(s["total_tokens"], 45150)
        self.assertEqual(s["input_tokens"], 29650)
        self.assertEqual(s["output_tokens"], 9350)
        self.assertEqual(s["cached_tokens"], 820)
        self.assertEqual(s["reasoning_tokens"], 3210)
        self.assertEqual(s["tool_tokens"], 2120)
        self.assertEqual(s["active_agents"], 3)
        self.assertEqual(s["session_count"], 5)
        self.assertEqual(payload["top_agents"][0]["agent_name"], "incident-triage-agent")
        self.assertEqual(payload["top_agents"][0]["tokens"], 23860)
        self.assertEqual(payload["top_agents"][0]["requests"], 12)
        self.assertIn("trace-a", payload["top_agents"][0]["trace_ids"])
        self.assertIn("trace-e", payload["top_agents"][0]["trace_ids"])
        self.assertEqual(s["cost"]["total"], 0)

    def test_gateway_observations_build_live_summary(self):
        rows = gateway_observations_to_metric_rows(
            [
                {
                    "id": "obs-1",
                    "timestamp": "2026-07-06T18:00:00Z",
                    "source": "hook",
                    "connector": "langgraph,mcp",
                    "agent_id": "incident-triage-agent",
                    "agent_name": "incident-triage-agent",
                    "session_id": "sess-1",
                    "model": "gpt-4o-mini",
                    "prompt_tokens": 2000,
                    "completion_tokens": 500,
                    "total_tokens": 2500,
                    "cost_usd": 0.25,
                },
                {
                    "id": "obs-2",
                    "timestamp": "2026-07-06T18:05:00Z",
                    "source": "hook",
                    "connector": "autogen",
                    "agent_id": "travel-planner-agent",
                    "agent_name": "travel-planner-agent",
                    "session_id": "sess-2",
                    "model": "claude-sonnet-4-5",
                    "prompt_tokens": 900,
                    "completion_tokens": 300,
                    "total_tokens": 1200,
                    "cost_usd": 0.12,
                },
            ]
        )
        payload = build_summary(rows, tenant_id="c3-demo-tenant", workspace_id="wayne-demo")
        summary = payload["summary"]
        self.assertEqual(summary["total_tokens"], 3700)
        self.assertEqual(summary["input_tokens"], 2900)
        self.assertEqual(summary["output_tokens"], 800)
        self.assertEqual(summary["request_count"], 2)
        self.assertEqual(summary["active_agents"], 2)
        self.assertEqual(summary["cost"]["total"], 0.37)
        self.assertEqual(payload["top_agents"][0]["primary_model"], "gpt-4o-mini")
        self.assertEqual(payload["top_agents"][0]["estimated_spend"], 0.25)
        self.assertEqual(payload["top_models"][0]["provider"], "openai")
        self.assertEqual(payload["tokenomics_detail"]["estimated_spend"], 0.37)

    def test_gateway_observations_preserve_residual_tokens_and_cost(self):
        rows = gateway_observations_to_metric_rows(
            [
                {
                    "id": "obs-mixed",
                    "source": "otlp",
                    "agent_id": "main",
                    "model": "gpt-5.5-high",
                    "prompt_tokens": 60,
                    "completion_tokens": 20,
                    "total_tokens": 100,
                    "cost_usd": 1.0,
                }
            ]
        )
        payload = build_summary(rows)
        self.assertEqual(payload["summary"]["total_tokens"], 100)
        self.assertEqual(payload["summary"]["cost"]["total"], 1.0)
        self.assertEqual({row["token_type"] for row in rows}, {"input", "output", "other"})
        self.assertEqual(sum(row["tokens"] for row in rows), 100)
        self.assertAlmostEqual(sum(row["cost_usd"] for row in rows), 1.0)

    def test_gateway_client_converts_socket_timeout_to_service_unavailable(self):
        client = GatewayClient(
            GatewayClientConfig(base_url="http://gateway.internal", token="test-token"),
            timeout=0.01,
        )
        with patch(
            "defenseclaw.c3_agent_tokenomics.gateway_client.request.urlopen",
            side_effect=TimeoutError("timed out"),
        ):
            with self.assertRaises(GatewayAPIError) as caught:
                client.list_usage_observations()
        self.assertEqual(caught.exception.status, 503)
        self.assertEqual(caught.exception.detail["error"], "defenseclaw gateway unreachable")
        self.assertIn("timed out", caught.exception.detail["detail"])

    def test_gateway_client_converts_malformed_json_to_bad_gateway(self):
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _limit):
                return b"{not-json"

        client = GatewayClient(GatewayClientConfig(base_url="http://gateway.internal", token="test-token"))
        with patch("defenseclaw.c3_agent_tokenomics.gateway_client.request.urlopen", return_value=FakeResponse()):
            with self.assertRaises(GatewayAPIError) as caught:
                client.list_effective_policies()
        self.assertEqual(caught.exception.status, 502)
        self.assertEqual(caught.exception.detail["error"], "invalid defenseclaw gateway response")

    def test_gateway_client_rejects_oversized_response(self):
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, limit):
                return b"x" * limit

        client = GatewayClient(GatewayClientConfig(base_url="http://gateway.internal", token="test-token"))
        with patch("defenseclaw.c3_agent_tokenomics.gateway_client.request.urlopen", return_value=FakeResponse()):
            with self.assertRaises(GatewayAPIError) as caught:
                client.list_effective_policies()
        self.assertEqual(caught.exception.status, 502)
        self.assertEqual(caught.exception.detail["error"], "defenseclaw gateway response too large")

    def test_gateway_client_runtime_control_routes_use_expected_methods(self):
        calls = []

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _limit):
                return b'{"status":"ok"}'

        def fake_urlopen(req, **_kwargs):
            calls.append(req)
            return FakeResponse()

        client = GatewayClient(GatewayClientConfig(base_url="http://gateway.internal", token="test-token"))
        payload = {"target_type": "command", "target_name": "git status", "reason": "read-only"}
        with patch("defenseclaw.c3_agent_tokenomics.gateway_client.request.urlopen", side_effect=fake_urlopen):
            client.list_allowed_controls()
            client.allow_runtime_control(payload)
            client.remove_runtime_control(payload)

        self.assertEqual([req.get_method() for req in calls], ["GET", "POST", "DELETE"])
        self.assertEqual(
            [req.full_url for req in calls],
            [
                "http://gateway.internal/enforce/allowed",
                "http://gateway.internal/enforce/allow",
                "http://gateway.internal/enforce/allow",
            ],
        )
        self.assertIsNone(calls[0].data)
        self.assertEqual(json.loads(calls[1].data), payload)
        self.assertEqual(json.loads(calls[2].data), payload)

    def test_agent_controls_openapi_contract_pins_public_routes(self):
        contract_path = (
            Path(__file__).resolve().parents[2]
            / "bundles"
            / "c3_agent_tokenomics"
            / "openapi"
            / "agent_tokenomics_with_runtime_governance.yaml"
        )
        contract = yaml.safe_load(contract_path.read_text(encoding="utf-8"))
        paths = contract["paths"]
        self.assertIn("get", paths["/v1/c3/agent-tokenomics/agent-controls/allowed"])
        self.assertIn("post", paths["/v1/c3/agent-tokenomics/agent-controls/allow"])
        self.assertIn("post", paths["/v1/c3/agent-tokenomics/agent-controls/remove"])

        schema = contract["components"]["schemas"]["RuntimeControlInput"]
        self.assertEqual(schema["required"], ["target_type", "target_name"])
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(schema["properties"]["target_type"]["enum"], ["command", "tool"])
        self.assertEqual(schema["properties"]["target_name"]["maxLength"], 512)
        self.assertEqual(schema["properties"]["target_name"]["pattern"], r"^[^\r\n\u0000]+$")
        self.assertEqual(schema["properties"]["reason"]["maxLength"], 512)

    def test_infrastructure_openapi_contract_pins_splunk_o11y_metrics(self):
        contract_path = (
            Path(__file__).resolve().parents[2]
            / "bundles"
            / "c3_agent_tokenomics"
            / "openapi"
            / "agent_tokenomics_with_runtime_governance.yaml"
        )
        contract_text = contract_path.read_text(encoding="utf-8")
        contract = yaml.safe_load(contract_text)
        operation = contract["paths"]["/v1/c3/agent-tokenomics/fleet/infrastructure"]["get"]
        parameters = {parameter["name"]: parameter for parameter in operation["parameters"]}
        self.assertEqual(parameters["window"]["schema"]["enum"], ["-1h", "-6h", "-24h"])
        self.assertEqual(parameters["resolution"]["schema"]["enum"], ["1h", "6h"])
        self.assertEqual(parameters["device_id"]["schema"]["maxLength"], 128)
        response_ref = operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
        self.assertEqual(response_ref, "#/components/schemas/FleetInfrastructureResponse")
        schemas = contract["components"]["schemas"]
        metrics = schemas["FleetInfrastructureDeviceMetrics"]
        self.assertIn("network_link_speed", metrics["required"])
        self.assertEqual(
            schemas["InfrastructureMetric"]["properties"]["quality"]["enum"],
            ["observed", "derived", "synthetic", "unavailable"],
        )
        self.assertNotRegex(contract_text, r"(?i)(?:co2|carbon)")

    def test_network_topology_openapi_contract_pins_c9550_core_and_c9350_access(self):
        contract_path = (
            Path(__file__).resolve().parents[2]
            / "bundles"
            / "c3_agent_tokenomics"
            / "openapi"
            / "agent_tokenomics_with_runtime_governance.yaml"
        )
        contract = yaml.safe_load(contract_path.read_text(encoding="utf-8"))
        schemas = contract["components"]["schemas"]
        self.assertIn("network_topology", schemas["FleetOverviewResponse"]["required"])
        self.assertEqual(
            schemas["NetworkTopologyCore"]["properties"]["official_model"]["enum"],
            ["Cisco C9550 Series Smart Switches"],
        )
        self.assertEqual(
            schemas["NetworkTopologyAccess"]["properties"]["official_model"]["enum"],
            ["Cisco C9350 Series Smart Switches"],
        )
        self.assertEqual(
            schemas["NetworkTopologyCoreCapabilities"]["properties"]["switching_capacity"]
            ["properties"]["basis"]["enum"],
            ["series-maximum"],
        )
        self.assertEqual(
            schemas["FleetIntegration"]["properties"]["status"]["enum"],
            [
                "connected",
                "demo-ready",
                "degraded",
                "unavailable",
                "offline",
                "disconnected",
                "failed",
                "error",
            ],
        )

    def test_galileo_summary_counts_controls(self):
        o11y = build_summary(self.rows)
        g = summarize_galileo(self.galileo, o11y)
        self.assertEqual(g["project"], "clus-demo")
        self.assertEqual(g["project_id"], "0ba7b20d-8262-44c4-b230-547a0cd74b2b")
        self.assertEqual(g["log_stream"], "clus-demo")
        self.assertEqual(g["log_stream_id"], "82b893bd-fa1f-411e-81e8-e12ca66692ad")
        self.assertEqual(g["runtime_control_events"], 4)
        self.assertEqual(g["denies"], 1)
        self.assertEqual(g["warns"], 1)
        self.assertEqual(g["steers"], 1)
        self.assertEqual(g["human_reviews"], 1)
        self.assertEqual(g["failed_evals"], 2)
        self.assertEqual(g["evidence"][0]["join_key"], "trace_id")

    def test_merge_adds_runtime_cards_and_agent_blocks(self):
        o11y = build_summary(self.rows)
        merged = merge_galileo_enrichment(o11y, self.galileo)
        self.assertEqual(merged["schema_version"], "c3.agent_tokenomics.v0.2")
        self.assertEqual(merged["source"], "splunk_o11y_signalflow+galileo")
        self.assertEqual(merged["galileo"]["runtime_control_events"], 4)
        self.assertEqual(len(merged["runtime_governance_cards"]), 4)
        incident = next(a for a in merged["top_agents"] if a["agent_name"] == "incident-triage-agent")
        self.assertEqual(incident["galileo"]["denies"], 1)
        evidence = merged["runtime_governance_evidence"]
        self.assertEqual({row["decision"] for row in evidence}, {"deny", "human_review", "steer", "warn"})

    def test_local_control_simulator_is_deterministic(self):
        outcome = evaluate_runtime_action("delete prod deployment", target="terminal")
        self.assertEqual(outcome.decision, "deny")
        a = control_event_from_action("2026-05-09T16:00:00Z", "read file", target="filesystem")
        b = control_event_from_action("2026-05-09T16:00:00Z", "read file", target="filesystem")
        self.assertEqual(a["control_id"], b["control_id"])
        self.assertEqual(a["decision"], "allow")

    def test_cli_builder_and_click_command_write_valid_json(self):
        payload = build_payload_from_files(include_galileo=True)
        self.assertEqual(payload["galileo"]["denies"], 1)
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "summary.json"
            result = CliRunner().invoke(c3_tokenomics, ["generate", "--include-galileo", "--output", str(out)])
            self.assertEqual(result.exit_code, 0, result.output)
            data = json.loads(out.read_text())
            self.assertEqual(data["galileo"]["human_reviews"], 1)

    def test_galileo_env_overrides_fixture_metadata_without_leaking_key(self):
        env = {
            "GALILEO_API_KEY": "test-key-not-real",
            "GALILEO_PROJECT": "clus-demo-live",
            "GALILEO_LOG_STREAM": "agent-watch-live",
        }
        with patch.dict(os.environ, env):
            payload = build_payload_from_files(include_galileo=True)
        self.assertEqual(payload["galileo"]["project"], "clus-demo-live")
        self.assertIsNone(payload["galileo"]["project_id"])
        self.assertEqual(payload["galileo"]["log_stream"], "agent-watch-live")
        self.assertIsNone(payload["galileo"]["log_stream_id"])
        self.assertNotIn(env["GALILEO_API_KEY"], json.dumps(payload))

    def test_galileo_env_can_pin_created_project_id(self):
        env = {
            "GALILEO_PROJECT": "clus-demo",
            "GALILEO_PROJECT_ID": "0ba7b20d-8262-44c4-b230-547a0cd74b2b",
            "GALILEO_LOG_STREAM": "clus-demo",
            "GALILEO_LOG_STREAM_ID": "82b893bd-fa1f-411e-81e8-e12ca66692ad",
        }
        with patch.dict(os.environ, env):
            payload = build_payload_from_files(include_galileo=True)
        self.assertEqual(payload["galileo"]["project"], "clus-demo")
        self.assertEqual(payload["galileo"]["project_id"], env["GALILEO_PROJECT_ID"])
        self.assertEqual(payload["galileo"]["log_stream"], "clus-demo")
        self.assertEqual(payload["galileo"]["log_stream_id"], env["GALILEO_LOG_STREAM_ID"])

    def test_galileo_check_command_redacts_api_key(self):
        env = {"GALILEO_API_KEY": "test-key-not-real", "GALILEO_PROJECT": "clus-demo"}
        with patch.dict(os.environ, env):
            result = CliRunner().invoke(c3_tokenomics, ["galileo-check"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn('"api_key_configured": true', result.output)
        self.assertNotIn(env["GALILEO_API_KEY"], result.output)

    def test_mock_api_health_and_enriched_summary(self):
        server = make_server("127.0.0.1", 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            conn.request("GET", "/healthz")
            health = conn.getresponse()
            self.assertEqual(health.status, 200)
            health_data = json.loads(health.read())
            self.assertEqual(health_data["status"], "ok")
            self.assertIn("galileo", health_data["integrations"])

            conn.request("GET", "/v1/c3/agent-tokenomics/summary?include_galileo=true")
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            data = json.loads(response.read())
            self.assertEqual(data["galileo"]["runtime_control_events"], 4)
            self.assertTrue(data["debug"]["internal_only"])
            self.assertIn("api_key_configured", data["debug"]["galileo"])
        finally:
            server.shutdown()
            server.server_close()

    def test_mock_api_fixture_readiness_emits_one_reusable_response(self):
        server = make_server("127.0.0.1", 0, allow_fixture_fallback=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        original_client = server.RequestHandlerClass.gateway_client
        server.RequestHandlerClass.gateway_client = None
        thread.start()
        try:
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            conn.request("GET", "/readyz")
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            data = json.loads(response.read())
            self.assertEqual(data["status"], "ready")
            self.assertEqual(data["mode"], "fixture")

            conn.request("GET", "/healthz")
            health = conn.getresponse()
            self.assertEqual(health.status, 200)
            self.assertEqual(json.loads(health.read())["status"], "ok")
            conn.close()
        finally:
            server.RequestHandlerClass.gateway_client = original_client
            server.shutdown()
            server.server_close()

    def test_mock_api_live_readiness_fails_when_gateway_is_unreachable(self):
        class UnreachableGatewayClient:
            def public_status(self):
                return {
                    "base_url": "http://gateway.internal",
                    "enabled": True,
                    "token_configured": True,
                }

            def list_effective_policies(self, *, agent_id=None):
                raise GatewayAPIError(503, {"error": "gateway unavailable"}, "gateway unavailable")

        server = make_server("127.0.0.1", 0, allow_fixture_fallback=False)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        original_client = server.RequestHandlerClass.gateway_client
        server.RequestHandlerClass.gateway_client = UnreachableGatewayClient()
        thread.start()
        try:
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            conn.request("GET", "/readyz")
            response = conn.getresponse()
            self.assertEqual(response.status, 503)
            data = json.loads(response.read())
            self.assertEqual(data["status"], "not_ready")
            self.assertEqual(data["error"]["error"], "gateway unavailable")
        finally:
            server.RequestHandlerClass.gateway_client = original_client
            server.shutdown()
            server.server_close()

    def test_mock_api_live_readiness_validates_gateway_policy_api(self):
        class ReadyGatewayClient:
            def public_status(self):
                return {
                    "base_url": "http://gateway.internal",
                    "enabled": True,
                    "token_configured": True,
                }

            def list_effective_policies(self, *, agent_id=None):
                return []

        server = make_server("127.0.0.1", 0, allow_fixture_fallback=False)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        original_client = server.RequestHandlerClass.gateway_client
        server.RequestHandlerClass.gateway_client = ReadyGatewayClient()
        thread.start()
        try:
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            conn.request("GET", "/readyz")
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            data = json.loads(response.read())
            self.assertEqual(data["status"], "ready")
            self.assertEqual(data["mode"], "live")
            self.assertTrue(data["gateway"]["reachable"])
        finally:
            server.RequestHandlerClass.gateway_client = original_client
            server.shutdown()
            server.server_close()

    def test_mock_api_prefers_live_gateway_usage_summary(self):
        class FakeGatewayClient:
            def public_status(self):
                return {
                    "base_url": "http://gateway.internal",
                    "enabled": True,
                    "token_configured": True,
                }

            def list_usage_observations(self, *, window="-24h", limit=5000):
                self.window = window
                self.limit = limit
                return [
                    {
                        "id": "obs-live-1",
                        "timestamp": "2026-07-06T18:00:00Z",
                        "source": "hook",
                        "connector": "langgraph,mcp",
                        "agent_id": "incident-triage-agent",
                        "agent_name": "incident-triage-agent",
                        "session_id": "sess-live-1",
                        "model": "gpt-4o-mini",
                        "prompt_tokens": 4000,
                        "completion_tokens": 1000,
                        "total_tokens": 5000,
                        "cost_usd": 0.5,
                    }
                ]

            def list_effective_policies(self, *, agent_id=None):
                return []

            def list_alerts(self, *, limit=50):
                return []

        server = make_server("127.0.0.1", 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        original_client = server.RequestHandlerClass.gateway_client
        server.RequestHandlerClass.gateway_client = FakeGatewayClient()
        thread.start()
        try:
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            conn.request("GET", "/v1/c3/agent-tokenomics/summary?include_galileo=true&window=-24h")
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            data = json.loads(response.read())
            self.assertFalse(data["debug"]["fixture_backed"])
            self.assertEqual(data["summary"]["total_tokens"], 5000)
            self.assertEqual(data["summary"]["cost"]["total"], 0.5)
            self.assertEqual(data["top_agents"][0]["agent_name"], "incident-triage-agent")
            self.assertEqual(data["source"], "defenseclaw_gateway_ledger")
        finally:
            server.RequestHandlerClass.gateway_client = original_client
            server.shutdown()
            server.server_close()

    def test_mock_api_exposes_live_usage_rows(self):
        class FakeGatewayClient:
            def public_status(self):
                return {
                    "base_url": "http://gateway.internal",
                    "enabled": True,
                    "token_configured": True,
                }

            def list_usage_observations(self, *, window="-24h", limit=5000):
                self.window = window
                self.limit = limit
                return [
                    {
                        "id": "obs-live-1",
                        "timestamp": "2026-07-06T18:00:00Z",
                        "source": "hook",
                        "connector": "langgraph,mcp",
                        "agent_id": "incident-triage-agent",
                        "agent_name": "incident-triage-agent",
                        "session_id": "sess-live-1",
                        "model": "gpt-4o-mini",
                        "prompt_tokens": 4000,
                        "completion_tokens": 1000,
                        "total_tokens": 5000,
                        "cost_usd": 0.5,
                    }
                ]

        server = make_server("127.0.0.1", 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        original_client = server.RequestHandlerClass.gateway_client
        server.RequestHandlerClass.gateway_client = FakeGatewayClient()
        thread.start()
        try:
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            conn.request("GET", "/v1/c3/agent-tokenomics/usage/rows?window=-24h")
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            data = json.loads(response.read())
            self.assertFalse(data["debug"]["fixture_backed"])
            self.assertEqual(len(data["rows"]), 2)
            self.assertEqual(data["rows"][0]["provider"], "openai")
            self.assertEqual(data["source"], "defenseclaw_gateway_ledger")
        finally:
            server.RequestHandlerClass.gateway_client = original_client
            server.shutdown()
            server.server_close()

    def test_mock_api_treats_empty_gateway_ledger_as_live_zero_usage(self):
        class FakeGatewayClient:
            def public_status(self):
                return {
                    "base_url": "http://gateway.internal",
                    "enabled": True,
                    "token_configured": True,
                }

            def list_usage_observations(self, *, window="-24h", limit=5000):
                return []

            def list_effective_policies(self, *, agent_id=None):
                return []

            def list_alerts(self, *, limit=50):
                return []

        server = make_server("127.0.0.1", 0, allow_fixture_fallback=False)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        original_client = server.RequestHandlerClass.gateway_client
        server.RequestHandlerClass.gateway_client = FakeGatewayClient()
        thread.start()
        try:
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            conn.request("GET", "/v1/c3/agent-tokenomics/summary?window=-24h")
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            summary = json.loads(response.read())
            self.assertFalse(summary["debug"]["fixture_backed"])
            self.assertEqual(summary["source"], "defenseclaw_gateway_ledger")
            self.assertEqual(summary["summary"]["total_tokens"], 0)
            self.assertEqual(summary["top_agents"], [])

            conn.request("GET", "/v1/c3/agent-tokenomics/usage/rows?window=-24h")
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            rows = json.loads(response.read())
            self.assertFalse(rows["debug"]["fixture_backed"])
            self.assertEqual(rows["source"], "defenseclaw_gateway_ledger")
            self.assertEqual(rows["rows"], [])
        finally:
            server.RequestHandlerClass.gateway_client = original_client
            server.shutdown()
            server.server_close()

    def test_mock_api_rejects_malformed_gateway_usage_with_json_error(self):
        class FakeGatewayClient:
            def public_status(self):
                return {
                    "base_url": "http://gateway.internal",
                    "enabled": True,
                    "token_configured": True,
                }

            def list_usage_observations(self, *, window="-24h", limit=5000):
                return {"rows": []}

        server = make_server("127.0.0.1", 0, allow_fixture_fallback=False)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        original_client = server.RequestHandlerClass.gateway_client
        server.RequestHandlerClass.gateway_client = FakeGatewayClient()
        thread.start()
        try:
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            conn.request("GET", "/v1/c3/agent-tokenomics/usage/rows?window=-24h")
            response = conn.getresponse()
            self.assertEqual(response.status, 502)
            data = json.loads(response.read())
            self.assertEqual(data["error"], "invalid defenseclaw gateway response")
            self.assertEqual(data["resource"], "usage observations")
        finally:
            server.RequestHandlerClass.gateway_client = original_client
            server.shutdown()
            server.server_close()

    def test_mock_api_summary_preserves_gateway_validation_status(self):
        class FakeGatewayClient:
            def public_status(self):
                return {
                    "base_url": "http://gateway.internal",
                    "enabled": True,
                    "token_configured": True,
                }

            def list_usage_observations(self, *, window="-24h", limit=5000):
                raise GatewayAPIError(400, {"error": "invalid window"}, "invalid window")

        server = make_server("127.0.0.1", 0, allow_fixture_fallback=False)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        original_client = server.RequestHandlerClass.gateway_client
        server.RequestHandlerClass.gateway_client = FakeGatewayClient()
        thread.start()
        try:
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            conn.request("GET", "/v1/c3/agent-tokenomics/summary?window=-30m")
            response = conn.getresponse()
            self.assertEqual(response.status, 400)
            self.assertEqual(json.loads(response.read())["error"], "invalid window")
        finally:
            server.RequestHandlerClass.gateway_client = original_client
            server.shutdown()
            server.server_close()

    def test_mock_api_rejects_invalid_alert_limit_with_json_error(self):
        server = make_server("127.0.0.1", 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            conn.request("GET", "/v1/c3/agent-tokenomics/alerts?limit=10junk")
            response = conn.getresponse()
            self.assertEqual(response.status, 400)
            data = json.loads(response.read())
            self.assertIn("limit must be an integer", data["error"])
        finally:
            server.shutdown()
            server.server_close()

    def test_mock_api_rejects_oversized_control_body(self):
        server = make_server("127.0.0.1", 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        original_client = server.RequestHandlerClass.gateway_client
        server.RequestHandlerClass.gateway_client = object()
        thread.start()
        try:
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            body = json.dumps({"agent_id": "a" * (64 * 1024)})
            conn.request(
                "POST",
                "/v1/c3/agent-tokenomics/controls/apply",
                body=body,
                headers={"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            self.assertEqual(response.status, 413)
            data = json.loads(response.read())
            self.assertIn("request body exceeds", data["error"])
        finally:
            server.RequestHandlerClass.gateway_client = original_client
            server.shutdown()
            server.server_close()

    def test_mock_api_proxies_and_filters_agent_controls(self):
        class FakeGatewayClient:
            def __init__(self):
                self.allowed_payloads = []
                self.removed_payloads = []

            def list_allowed_controls(self):
                return [
                    {
                        "id": "command-1",
                        "target_type": "command",
                        "target_name": "git status",
                        "reason": "read-only",
                        "updated_at": "2026-07-08T12:00:00Z",
                    },
                    {
                        "id": "tool-1",
                        "target_type": "tool",
                        "target_name": "read_file",
                        "reason": "trusted read",
                        "updated_at": "2026-07-08T12:00:00Z",
                    },
                    {
                        "id": "skill-1",
                        "target_type": "skill",
                        "target_name": "unrelated-skill",
                        "reason": "not part of Agent Controls",
                        "updated_at": "2026-07-08T12:00:00Z",
                    },
                ]

            def allow_runtime_control(self, payload):
                self.allowed_payloads.append(payload)
                return {"status": "allowed"}

            def remove_runtime_control(self, payload):
                self.removed_payloads.append(payload)
                return {"status": "removed"}

        fake_client = FakeGatewayClient()
        server = make_server("127.0.0.1", 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        original_client = server.RequestHandlerClass.gateway_client
        server.RequestHandlerClass.gateway_client = fake_client
        thread.start()
        try:
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)

            conn.request("GET", "/v1/c3/agent-tokenomics/agent-controls/allowed")
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            allowed = json.loads(response.read())
            self.assertEqual(
                [(row["target_type"], row["target_name"]) for row in allowed],
                [("command", "git status"), ("tool", "read_file")],
            )

            conn.request(
                "POST",
                "/v1/c3/agent-tokenomics/agent-controls/allow",
                body=json.dumps({"target_type": " COMMAND ", "target_name": " git diff "}),
                headers={"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read()), {"status": "allowed"})
            self.assertEqual(
                fake_client.allowed_payloads,
                [
                    {
                        "target_type": "command",
                        "target_name": "git diff",
                        "reason": "Approved through C3 Tokenomics Agent Controls",
                    }
                ],
            )

            conn.request(
                "POST",
                "/v1/c3/agent-tokenomics/agent-controls/remove",
                body=json.dumps({"target_type": "tool", "target_name": " read_file ", "reason": "remove"}),
                headers={"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read()), {"status": "removed"})
            self.assertEqual(
                fake_client.removed_payloads,
                [{"target_type": "tool", "target_name": "read_file", "reason": "remove"}],
            )

            conn.request(
                "POST",
                "/v1/c3/agent-tokenomics/agent-controls/allow",
                body=json.dumps({"target_type": "skill", "target_name": "not-exposed"}),
                headers={"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            self.assertEqual(response.status, 400)
            self.assertEqual(json.loads(response.read())["error"], "target_type must be command or tool")
            self.assertEqual(len(fake_client.allowed_payloads), 1)
        finally:
            server.RequestHandlerClass.gateway_client = original_client
            server.shutdown()
            server.server_close()

    def test_runtime_control_payload_rejects_missing_or_oversized_names(self):
        with self.assertRaisesRegex(ValueError, "target_name is required"):
            C3TokenomicsHandler._runtime_control_payload({"target_type": "command"})
        with self.assertRaisesRegex(ValueError, "512 characters or fewer"):
            C3TokenomicsHandler._runtime_control_payload(
                {"target_type": "tool", "target_name": "x" * 513}
            )
        with self.assertRaisesRegex(ValueError, "unsupported agent-control field: scope"):
            C3TokenomicsHandler._runtime_control_payload(
                {"target_type": "tool", "target_name": "read_file", "scope": "all"}
            )

    def test_runtime_control_payload_rejects_multiline_and_nul_names(self):
        for target_name in ("git status\r--short", "git status\n--short", "git status\x00--short"):
            with self.subTest(target_name=repr(target_name)):
                with self.assertRaisesRegex(ValueError, "must be one line and cannot contain NUL"):
                    C3TokenomicsHandler._runtime_control_payload(
                        {"target_type": "command", "target_name": target_name}
                    )

    def test_mock_api_fleet_network_actions_are_idempotent_and_update_timeline(self):
        server = make_server("127.0.0.1", 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            overview_path = "/v1/c3/agent-tokenomics/fleet/overview"
            action_path = "/v1/c3/agent-tokenomics/fleet/desksides/DSK-AUS-017/network-action"

            conn.request("GET", overview_path)
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            initial = json.loads(response.read())
            self.assertTrue(initial["demo"]["network_actions_are_simulated"])
            self.assertEqual(initial["network_topology"]["core"]["display_name"], "Cisco C9550")
            self.assertEqual(initial["network_topology"]["core"]["deployment"], "Logical core pair")
            self.assertEqual(initial["network_topology"]["access"]["display_name"], "Cisco C9350")
            self.assertEqual(initial["network_topology"]["access"]["switch_count"], 5)
            self.assertTrue(all(row["switch_name"].startswith("C9350-") for row in initial["devices"]))
            self.assertFalse(any("CAT9K" in row["switch_name"] for row in initial["devices"]))
            initial_quarantined = initial["fleet"]["quarantined_devices"]
            initial_events = len(initial["enforcement_events"])

            conn.request(
                "POST",
                action_path,
                body=json.dumps({"action": "quarantine", "reason": "critical credential policy breach"}),
                headers={"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            quarantined = json.loads(response.read())
            self.assertTrue(quarantined["changed"])
            self.assertTrue(quarantined["network_actions_are_simulated"])
            self.assertTrue(quarantined["device"]["quarantined"])
            self.assertEqual(quarantined["fleet"]["quarantined_devices"], initial_quarantined + 1)
            self.assertEqual(len(quarantined["events"]), 4)
            self.assertEqual(quarantined["events"][-1]["title"], "C9350 restricted access")
            self.assertTrue(
                next(event for event in quarantined["events"] if event["stage"] == "coa")["detail"].startswith(
                    "C9350-AUS-02 "
                )
            )
            self.assertEqual(quarantined["timeline_count"], initial_events + 4)

            conn.request(
                "POST",
                action_path,
                body=json.dumps({"action": "quarantine"}),
                headers={"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            repeated = json.loads(response.read())
            self.assertFalse(repeated["changed"])
            self.assertEqual(repeated["events"], [])
            self.assertEqual(repeated["timeline_count"], initial_events + 4)

            conn.request(
                "POST",
                action_path,
                body=json.dumps({"action": "restore", "reason": "operator approved recovery"}),
                headers={"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            restored = json.loads(response.read())
            self.assertTrue(restored["changed"])
            self.assertFalse(restored["device"]["quarantined"])
            self.assertEqual(restored["fleet"]["quarantined_devices"], initial_quarantined)
            self.assertEqual(len(restored["events"]), 4)
            self.assertEqual(restored["events"][-1]["title"], "C9350 restored access")
            self.assertEqual(restored["timeline_count"], initial_events + 8)

            conn.request(
                "POST",
                action_path,
                body=json.dumps({"action": "restore"}),
                headers={"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            repeated_restore = json.loads(response.read())
            self.assertFalse(repeated_restore["changed"])
            self.assertEqual(repeated_restore["events"], [])
            self.assertEqual(repeated_restore["timeline_count"], initial_events + 8)
        finally:
            server.shutdown()
            server.server_close()

    def test_mock_api_fleet_analytics_returns_exact_modeled_fixture(self):
        fixture_path = (
            Path(__file__).resolve().parents[2]
            / "bundles"
            / "c3_agent_tokenomics"
            / "mfe_prebuilt"
            / "fixtures"
            / "tokenomics-fleet-analytics.json"
        )
        expected = json.loads(fixture_path.read_text(encoding="utf-8"))
        server = make_server("127.0.0.1", 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            conn.request("GET", "/v1/c3/agent-tokenomics/fleet/analytics")
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            analytics = json.loads(response.read())
            self.assertEqual(analytics, expected)
            self.assertEqual(analytics["source"], "amd_deskside_demo_scenario")
            self.assertTrue(analytics["debug"]["fixture_backed"])
            self.assertEqual(analytics["disclosure"]["status"], "illustrative")
            self.assertEqual(analytics["adoption"]["status"], "illustrative")
            self.assertEqual(analytics["cost"]["status"], "illustrative")
            detail_rows = analytics["cost"]["detail_rows"]
            self.assertEqual(sum(row["tasks"] for row in detail_rows), 1842)
            self.assertEqual(
                sum(row["total_tokens"] for row in detail_rows),
                analytics["cost"]["summary"]["total_tokens"],
            )
            self.assertAlmostEqual(
                sum(row["estimated_cost_usd"] for row in detail_rows),
                analytics["cost"]["summary"]["estimated_cloud_cost_usd"],
                places=2,
            )
            self.assertEqual(
                analytics["cost"]["summary"]["local_tokens"]
                + analytics["cost"]["summary"]["cloud_tokens"],
                analytics["cost"]["summary"]["total_tokens"],
            )
            self.assertAlmostEqual(
                sum(row["estimated_cost_usd"] for row in analytics["cost"]["daily_provider_cost"]),
                analytics["cost"]["summary"]["estimated_cloud_cost_usd"],
                places=2,
            )
            projection = analytics["cost"]["organization_projection"]
            self.assertEqual(projection["modeled_non_halo_cloud_tokens"], 1_200_000_000)
            self.assertEqual(projection["modeled_non_halo_estimated_cost_usd"], 209_000)
            self.assertEqual(projection["annualization_weeks"], 52)
            agent_ids = {row["agent_id"] for row in analytics["dimensions"]["agents"]}
            self.assertTrue({row["agent_id"] for row in detail_rows}.issubset(agent_ids))
            code_builder = [row for row in detail_rows if row["agent_id"] == "code-builder"]
            self.assertEqual(sum(row["tasks"] for row in code_builder), 230)
            self.assertEqual(sum(row["requests"] for row in code_builder), 337)
            self.assertEqual(sum(row["total_tokens"] for row in code_builder), 660_000)
            self.assertAlmostEqual(sum(row["estimated_cost_usd"] for row in code_builder), 109.80)

            conn.request(
                "POST",
                "/v1/c3/agent-tokenomics/fleet/analytics",
                body="{}",
                headers={"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            self.assertEqual(response.status, 404)
            response.read()
        finally:
            server.shutdown()
            server.server_close()

    def test_mock_api_fleet_infrastructure_returns_splunk_o11y_synthetic_contract(self):
        server = make_server("127.0.0.1", 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            path = "/v1/c3/agent-tokenomics/fleet/infrastructure"
            conn.request("GET", path)
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            infrastructure = json.loads(response.read())
            self.assertEqual(infrastructure["source"], "splunk_o11y_synthetic_demo")
            self.assertTrue(infrastructure["debug"]["fixture_backed"])
            self.assertTrue(infrastructure["debug"]["synthetic"])
            self.assertEqual(infrastructure["disclosure"]["status"], "synthetic")
            self.assertEqual(
                infrastructure["debug"]["requested_filters"],
                {"window": "-24h", "resolution": "1h", "device_id": None},
            )
            summary = infrastructure["fleet_summary"]
            self.assertEqual(summary["avg_cpu_utilization"]["value"], 39.75)
            self.assertEqual(summary["avg_memory_utilization"]["value"], 66.5)
            self.assertEqual(summary["avg_gpu_utilization"]["value"], 40.5)
            self.assertEqual(summary["total_network_receive"]["value"], 366.4)
            self.assertEqual(summary["current_power"]["value"], 375)
            self.assertEqual(summary["energy_7d"]["value"], 62.3)
            self.assertEqual(summary["reporting_devices"], 4)
            self.assertEqual(summary["stale_devices"], 1)
            self.assertEqual(len(infrastructure["devices"]), 5)
            self.assertEqual(len(infrastructure["series"]["cpu_utilization"]), 25)
            self.assertNotRegex(json.dumps(infrastructure), r"(?i)(?:co2|carbon)")
            nyc = next(row for row in infrastructure["devices"] if row["device_id"] == "DSK-NYC-014")
            self.assertEqual(nyc["context"]["tokens_7d"], 1280000)
            self.assertEqual(nyc["metrics"]["network_link_speed"]["value"], 1000)
            self.assertTrue(nyc["metrics"]["gpu_utilization"]["source"].startswith("splunk_o11y_"))
            rtp = next(row for row in infrastructure["devices"] if row["device_id"] == "DSK-RTP-006")
            self.assertTrue(rtp["stale"])
            self.assertIsNone(rtp["metrics"]["cpu_utilization"]["value"])
            self.assertEqual(rtp["metrics"]["cpu_utilization"]["quality"], "unavailable")
            self.assertEqual(rtp["metrics"]["energy_7d"]["coverage"], "partial")

            conn.request("GET", f"{path}?window=-6h&resolution=6h&device_id=DSK-NYC-014")
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            selected = json.loads(response.read())
            self.assertEqual([row["device_id"] for row in selected["devices"]], ["DSK-NYC-014"])
            self.assertEqual(selected["scope"]["device_id"], "DSK-NYC-014")
            self.assertEqual(selected["fleet_summary"]["avg_cpu_utilization"]["value"], 48)
            self.assertEqual(len(selected["series"]["cpu_utilization"]), 2)
            self.assertEqual(selected["series"]["cpu_utilization"][-1]["value"], 48)

            for query in (
                "window=-7d",
                "resolution=5m",
                "device_id=bad%2Fdevice",
                "window=-1h&window=-6h",
            ):
                with self.subTest(query=query):
                    conn.request("GET", f"{path}?{query}")
                    response = conn.getresponse()
                    self.assertEqual(response.status, 400)
                    self.assertIn("error", json.loads(response.read()))

            conn.request("GET", f"{path}?device_id=DSK-NOT-FOUND")
            response = conn.getresponse()
            self.assertEqual(response.status, 404)
            self.assertEqual(
                json.loads(response.read()),
                {"error": "infrastructure device not found", "device_id": "DSK-NOT-FOUND"},
            )
        finally:
            server.shutdown()
            server.server_close()

    def test_mock_api_security_policy_validates_version_and_never_releases_devices(self):
        server = make_server("127.0.0.1", 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            policy_path = "/v1/c3/agent-tokenomics/security/policy"
            action_path = "/v1/c3/agent-tokenomics/fleet/desksides/DSK-AUS-017/network-action"

            conn.request(
                "POST",
                policy_path,
                body=json.dumps({"enabled": "true"}),
                headers={"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            self.assertEqual(response.status, 400)
            self.assertEqual(json.loads(response.read())["error"], "enabled must be a boolean")

            conn.request(
                "POST",
                policy_path,
                body=json.dumps({"enabled": True, "expected_version": 1, "reason": "arm critical response"}),
                headers={"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            enabled = json.loads(response.read())
            self.assertTrue(enabled["auto_quarantine"])
            self.assertTrue(enabled["simulated"])
            self.assertTrue(enabled["changed"])
            self.assertEqual(enabled["version"], 2)

            conn.request(
                "POST",
                policy_path,
                body=json.dumps({"enabled": True, "expected_version": 2}),
                headers={"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            unchanged = json.loads(response.read())
            self.assertFalse(unchanged["changed"])
            self.assertEqual(unchanged["version"], 2)

            conn.request(
                "POST",
                policy_path,
                body=json.dumps({"enabled": False, "expected_version": 1}),
                headers={"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            self.assertEqual(response.status, 409)
            self.assertIn("version conflict", json.loads(response.read())["error"])

            conn.request(
                "POST",
                action_path,
                body=json.dumps({"action": "quarantine"}),
                headers={"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            response.read()

            conn.request(
                "POST",
                policy_path,
                body=json.dumps({"enabled": False, "expected_version": 2, "reason": "return to monitor mode"}),
                headers={"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            disabled = json.loads(response.read())
            self.assertFalse(disabled["auto_quarantine"])
            self.assertFalse(disabled["existing_quarantines_released"])
            self.assertEqual(disabled["version"], 3)

            conn.request("GET", "/v1/c3/agent-tokenomics/fleet/overview")
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            overview = json.loads(response.read())
            device = next(row for row in overview["devices"] if row["device_id"] == "DSK-AUS-017")
            self.assertTrue(device["quarantined"])
            self.assertEqual(overview["fleet"]["quarantined_devices"], 2)
        finally:
            server.shutdown()
            server.server_close()

    def test_mock_api_fleet_state_resets_for_each_server(self):
        def overview(server):
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            conn.request("GET", "/v1/c3/agent-tokenomics/fleet/overview")
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            return json.loads(response.read())

        first = make_server("127.0.0.1", 0)
        first_thread = threading.Thread(target=first.serve_forever, daemon=True)
        first_thread.start()
        try:
            host, port = first.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            conn.request(
                "POST",
                "/v1/c3/agent-tokenomics/security/policy",
                body=json.dumps({"enabled": True}),
                headers={"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            response.read()
            self.assertTrue(overview(first)["security_policy"]["auto_quarantine"])
        finally:
            first.shutdown()
            first.server_close()

        second = make_server("127.0.0.1", 0)
        second_thread = threading.Thread(target=second.serve_forever, daemon=True)
        second_thread.start()
        try:
            reset = overview(second)
            self.assertFalse(reset["security_policy"]["auto_quarantine"])
            self.assertEqual(reset["security_policy"]["version"], 1)
            self.assertEqual(reset["fleet"]["quarantined_devices"], 1)
        finally:
            second.shutdown()
            second.server_close()

    def test_mock_api_demo_reset_restores_exact_fleet_baseline(self):
        server = make_server("127.0.0.1", 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address
            conn = http.client.HTTPConnection(host, port, timeout=5)
            overview_path = "/v1/c3/agent-tokenomics/fleet/overview"
            policy_path = "/v1/c3/agent-tokenomics/security/policy"
            action_path = "/v1/c3/agent-tokenomics/fleet/desksides/DSK-AUS-017/network-action"
            reset_path = "/v1/c3/agent-tokenomics/fleet/demo/reset"

            def get_overview():
                conn.request("GET", overview_path)
                response = conn.getresponse()
                self.assertEqual(response.status, 200)
                return json.loads(response.read())

            def post_json(path, payload, expected=200):
                conn.request(
                    "POST",
                    path,
                    body=json.dumps(payload),
                    headers={"Content-Type": "application/json"},
                )
                response = conn.getresponse()
                self.assertEqual(response.status, expected)
                return json.loads(response.read())

            initial = get_overview()
            initial_aus = next(row for row in initial["devices"] if row["device_id"] == "DSK-AUS-017")

            post_json(policy_path, {"enabled": True, "expected_version": 1})
            post_json(action_path, {"action": "quarantine"})
            post_json(action_path, {"action": "restore"})
            post_json(action_path, {"action": "quarantine"})
            mutated = get_overview()
            self.assertNotEqual(mutated["security_policy"]["version"], initial["security_policy"]["version"])
            self.assertGreater(
                mutated["fleet"]["network_action_count"],
                initial["fleet"]["network_action_count"],
            )

            invalid = post_json(reset_path, {"reason": "bad\nreason"}, expected=400)
            self.assertIn("must be one line", invalid["error"])
            self.assertEqual(get_overview()["fleet"]["network_action_count"], 3)

            reset = post_json(reset_path, {"reason": "prepare the next presenter run"})
            self.assertEqual(
                reset["reset"],
                {
                    "completed": True,
                    "reason": "prepare the next presenter run",
                    "simulated": True,
                },
            )
            self.assertEqual(reset["security_policy"], initial["security_policy"])
            self.assertEqual(reset["fleet"]["quarantined_devices"], initial["fleet"]["quarantined_devices"])
            self.assertEqual(reset["fleet"]["network_action_count"], initial["fleet"]["network_action_count"])
            self.assertEqual(reset["enforcement_events"], initial["enforcement_events"])
            reset_aus = next(row for row in reset["devices"] if row["device_id"] == "DSK-AUS-017")
            self.assertEqual(reset_aus, initial_aus)

            after_reset = get_overview()
            self.assertNotIn("reset", after_reset)
            self.assertEqual(after_reset, initial)

            idempotent_restore = post_json(action_path, {"action": "restore"})
            self.assertFalse(idempotent_restore["changed"])
            self.assertEqual(idempotent_restore["events"], [])
            self.assertEqual(get_overview(), initial)
        finally:
            server.shutdown()
            server.server_close()

    def test_runtime_governance_ignores_released_and_resolved_alerts(self):
        handler = object.__new__(C3TokenomicsHandler)
        alerts = [
            {"alert_key": "open", "agent_id": "main", "status": "open", "action": "deny"},
            {"alert_key": "released", "agent_id": "main", "status": "released", "action": "deny"},
            {"alert_key": "resolved", "agent_id": "main", "status": "resolved", "action": "steer"},
        ]
        evidence = handler._gateway_alert_evidence(alerts)
        self.assertEqual([row["control_id"] for row in evidence], ["open"])
        cards = handler._gateway_runtime_cards([], alerts)
        self.assertEqual(cards[0]["value"], 1)
        self.assertEqual(cards[1]["value"], 1)

    def test_galileo_live_project_check_uses_api_key_header(self):
        seen: dict[str, object] = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                seen["path"] = self.path
                seen["api_key"] = self.headers.get("Galileo-API-Key")
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
                seen["body"] = body
                response = {
                    "projects": [
                        {
                            "id": "project-123",
                            "name": "clus-demo",
                            "num_logstreams": 1,
                            "log_streams": [{"id": "stream-123", "name": "agent-watch"}],
                        }
                    ],
                    "total_count": 1,
                }
                raw = json.dumps(response).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *_args):
                return

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            cfg = galileo_config_from_env(
                api_base=f"http://{server.server_address[0]}:{server.server_address[1]}",
                api_key="test-key-not-real",
                project="clus-demo",
                log_stream="agent-watch",
            )
            result = resolve_galileo_project(cfg)
        finally:
            server.shutdown()
            server.server_close()

        self.assertTrue(result["ok"])
        self.assertEqual(result["project"]["id"], "project-123")
        self.assertTrue(result["log_stream_matched"])
        self.assertEqual(seen["api_key"], "test-key-not-real")
        self.assertNotIn("test-key-not-real", json.dumps(result))

    def test_galileo_live_project_id_check_matches_log_stream(self):
        seen: dict[str, object] = {"paths": []}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                seen["paths"].append(self.path)
                seen["api_key"] = self.headers.get("Galileo-API-Key")
                if self.path.endswith("/log_streams"):
                    response = [{"id": "stream-123", "name": "agent-watch"}]
                else:
                    response = {
                        "id": "project-123",
                        "name": "clus-demo",
                        "num_logstreams": 1,
                    }
                raw = json.dumps(response).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *_args):
                return

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            cfg = galileo_config_from_env(
                api_base=f"http://{server.server_address[0]}:{server.server_address[1]}",
                api_key="test-key-not-real",
                project_id="project-123",
                log_stream_id="stream-123",
            )
            result = resolve_galileo_project(cfg)
        finally:
            server.shutdown()
            server.server_close()

        self.assertTrue(result["ok"])
        self.assertEqual(result["matched_by"], "project_id")
        self.assertTrue(result["log_stream_matched"])
        self.assertEqual(seen["paths"], ["/v2/projects/project-123", "/v2/projects/project-123/log_streams"])
        self.assertEqual(seen["api_key"], "test-key-not-real")

    def test_fixtures_do_not_embed_real_galileo_api_key(self):
        forbidden_fragment = "0v" + "Kj" + "vj" + "Kf" + "Gm"
        for text in [json.dumps(self.galileo), json.dumps(self.rows)]:
            self.assertNotIn(forbidden_fragment, text)


if __name__ == "__main__":
    unittest.main()
