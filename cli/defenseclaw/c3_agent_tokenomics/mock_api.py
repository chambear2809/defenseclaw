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

import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from .cli import build_payload_from_files
from .fixtures import default_o11y_rows, package_data_json, read_json
from .galileo_config import galileo_config_from_env
from .gateway_client import GatewayAPIError, GatewayClient, gateway_client_config_from_env
from .transform import build_summary, gateway_observations_to_metric_rows

TRUTHY = {"1", "true", "yes", "y", "on"}
MAX_GATEWAY_LIST_LIMIT = 5000
MAX_CONTROL_BODY_BYTES = 64 * 1024


class PayloadTooLargeError(ValueError):
    pass


def _bool_query(query: dict[str, list[str]], name: str, default: bool = False) -> bool:
    values = query.get(name)
    if not values:
        return default
    return str(values[-1]).strip().lower() in TRUTHY


def _first(query: dict[str, list[str]], name: str, default: str | None = None) -> str | None:
    values = query.get(name)
    if not values:
        return default
    return values[-1]


def _gateway_object_list(value: Any, resource: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise GatewayAPIError(
            502,
            {
                "error": "invalid defenseclaw gateway response",
                "resource": resource,
                "expected": "array of objects",
            },
            f"DefenseClaw gateway returned an invalid {resource} payload.",
        )
    return value


def _bounded_int_query(
    query: dict[str, list[str]],
    name: str,
    default: int,
    *,
    minimum: int = 1,
    maximum: int = MAX_GATEWAY_LIST_LIMIT,
) -> int:
    raw = _first(query, name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer between {minimum} and {maximum}") from exc
    if value < minimum or value > maximum:
        raise ValueError(f"{name} must be an integer between {minimum} and {maximum}")
    return value


class C3TokenomicsHandler(BaseHTTPRequestHandler):
    """Tiny stdlib HTTP server for Cisco Cloud Control frontend wiring and Kubernetes demos."""

    o11y_fixture_path: str | None = None
    galileo_fixture_path: str | None = None
    summary_fixture_path: str | None = None
    realm: str | None = None
    allow_fixture_fallback: bool = True
    gateway_client: GatewayClient | None = None

    def _send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS, POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
        except ValueError as exc:
            raise json.JSONDecodeError("invalid Content-Length", "", 0) from exc
        if length < 0:
            raise json.JSONDecodeError("invalid Content-Length", "", 0)
        if length > MAX_CONTROL_BODY_BYTES:
            raise PayloadTooLargeError(f"request body exceeds {MAX_CONTROL_BODY_BYTES} bytes")
        raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}

    def _gateway_status(self) -> dict[str, Any]:
        if self.gateway_client is None:
            return {"enabled": False, "token_configured": False, "base_url": None}
        return self.gateway_client.public_status()

    def _load_summary_fixture(self) -> dict[str, Any]:
        if self.summary_fixture_path:
            return json.loads(Path(self.summary_fixture_path).read_text(encoding="utf-8"))
        return package_data_json("mfe_prebuilt", "fixtures", "tokenomics-summary-runtime-governance.json")

    def _load_o11y_rows(self) -> list[dict[str, Any]]:
        rows = read_json(self.o11y_fixture_path, ("samples", "o11y_token_metric_rows.json"))
        return rows if isinstance(rows, list) else default_o11y_rows()

    def _gateway_policies(self) -> list[dict[str, Any]]:
        if self.gateway_client is None:
            return []
        return _gateway_object_list(self.gateway_client.list_effective_policies(), "effective policies")

    def _gateway_alerts(self, *, limit: int = 100) -> list[dict[str, Any]]:
        if self.gateway_client is None:
            return []
        return _gateway_object_list(self.gateway_client.list_alerts(limit=limit), "budget alerts")

    def _gateway_alert_evidence(self, alerts: list[dict[str, Any]]) -> list[dict[str, Any]]:
        evidence: list[dict[str, Any]] = []
        for alert in alerts:
            if alert.get("status") != "open":
                continue
            agent_name = str(alert.get("agent_name") or alert.get("agent_id") or "unknown")
            decision = str(alert.get("action") or "steer")
            severity = "CRITICAL" if decision == "deny" else "HIGH"
            session_id = str(alert.get("session_id") or "")
            evidence.append(
                {
                    "agent_name": agent_name,
                    "decision": decision,
                    "severity": severity,
                    "reason": str(alert.get("reason") or "Budget threshold exceeded."),
                    "target": f"{alert.get('window', 'session')}:{alert.get('metric', 'tokens')}",
                    "action": "budget_threshold_exceeded",
                    "control_id": str(alert.get("alert_key") or ""),
                    "policy_id": str(alert.get("policy_id") or ""),
                    "evidence_ref": f"budget-alert:{alert.get('alert_key') or ''}",
                    "trace_id": "",
                    "session_id": session_id,
                    "deep_link": "",
                    "join_key": "session_id" if session_id else "agent_name",
                }
            )
        return evidence

    def _gateway_runtime_cards(
        self,
        policies: list[dict[str, Any]],
        alerts: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        open_alerts = [row for row in alerts if row.get("status") == "open"]
        deny_alerts = [row for row in open_alerts if row.get("action") == "deny"]
        steer_policies = [row for row in policies if row.get("action") == "steer"]
        protected_agents = {str(row.get("agent_id") or "") for row in policies if row.get("agent_id")}
        return [
            {
                "title": "Open Budget Alerts",
                "value": len(open_alerts),
                "subtitle": "Live over-budget agents or sessions detected by DefenseClaw",
            },
            {
                "title": "Hard Stops Armed",
                "value": len(deny_alerts),
                "subtitle": "Alerts that will actively deny further tool execution",
            },
            {
                "title": "Steering Policies",
                "value": len(steer_policies),
                "subtitle": "Policies set to warn or steer instead of hard stopping",
            },
            {
                "title": "Protected Agents",
                "value": len(protected_agents),
                "subtitle": "Agents with an effective local budget control policy",
            },
        ]

    def _merge_gateway_agents(
        self,
        payload: dict[str, Any],
        policies: list[dict[str, Any]],
        alerts: list[dict[str, Any]],
    ) -> None:
        top_agents = payload.setdefault("top_agents", [])
        existing = {
            str(row.get("agent_name") or ""): row
            for row in top_agents
            if isinstance(row, dict) and row.get("agent_name")
        }
        open_alerts = [row for row in alerts if row.get("status") == "open"]
        alert_lookup = {
            str(row.get("agent_id") or row.get("agent_name") or ""): row
            for row in open_alerts
            if row.get("agent_id") or row.get("agent_name")
        }

        for policy in policies:
            agent_id = str(policy.get("agent_id") or "").strip()
            agent_name = str(policy.get("agent_name") or agent_id or "unknown")
            target = existing.get(agent_name)
            budget_meta = {
                "action": policy.get("action"),
                "session_token_budget": policy.get("session_token_budget"),
                "daily_token_budget": policy.get("daily_token_budget"),
                "session_cost_budget_usd": policy.get("session_cost_budget_usd"),
                "daily_cost_budget_usd": policy.get("daily_cost_budget_usd"),
                "has_open_alert": bool(agent_id and agent_id in alert_lookup),
            }
            if target is None:
                target = {
                    "agent_name": agent_name,
                    "service_name": "defenseclaw",
                    "connector": "defenseclaw",
                    "tokens": 0,
                    "requests": 0,
                    "sessions": 1 if agent_id in alert_lookup and alert_lookup[agent_id].get("session_id") else 0,
                    "trace_ids": [],
                    "runtime_only": True,
                }
                top_agents.append(target)
                existing[agent_name] = target
            target["budget_control"] = budget_meta

    def _gateway_live_summary(
        self,
        *,
        tenant_id: str,
        workspace_id: str,
        window: str,
    ) -> dict[str, Any] | None:
        live = self._gateway_live_rows(window=window)
        if not live:
            return None
        observations, rows = live
        payload = build_summary(rows, tenant_id=tenant_id, workspace_id=workspace_id, realm=self.realm)
        payload["source"] = "defenseclaw_gateway_ledger"
        payload["debug"] = {
            "live_summary_rows": len(rows),
            "live_usage_observations": len(observations),
            "live_summary_source": "defenseclaw_gateway_ledger",
        }
        return payload

    def _gateway_live_rows(self, *, window: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]] | None:
        if self.gateway_client is None:
            return None
        observations = _gateway_object_list(
            self.gateway_client.list_usage_observations(window=window, limit=5000),
            "usage observations",
        )
        rows = gateway_observations_to_metric_rows(observations)
        return observations, rows

    def _usage_rows_payload(self, query: dict[str, list[str]]) -> dict[str, Any]:
        tenant_id = _first(query, "tenant_id", "c3-demo-tenant")
        workspace_id = _first(query, "workspace_id", "wayne-demo")
        window = _first(query, "window", "-24h") or "-24h"
        payload = {
            "generated_at": self._load_summary_fixture().get("generated_at"),
            "source": "fixture_rows",
            "tenant_id": tenant_id,
            "workspace_id": workspace_id,
            "rows": self._load_o11y_rows(),
            "debug": {
                "fixture_backed": True,
                "gateway": self._gateway_status(),
                "requested_filters": {
                    "window": window,
                },
            },
        }

        gateway_status = payload["debug"]["gateway"]
        try:
            live = self._gateway_live_rows(window=window)
            gateway_status["reachable"] = True
            if live:
                observations, rows = live
                payload["generated_at"] = build_summary(rows, tenant_id=tenant_id, workspace_id=workspace_id).get(
                    "generated_at"
                )
                payload["source"] = "defenseclaw_gateway_ledger"
                payload["rows"] = rows
                payload["debug"]["fixture_backed"] = False
                payload["debug"]["live_usage_observations"] = len(observations)
                payload["debug"]["live_summary_rows"] = len(rows)
        except GatewayAPIError as exc:
            gateway_status["reachable"] = False
            gateway_status["error"] = exc.detail
            if not self.allow_fixture_fallback:
                raise
        return payload

    def _summary_payload(self, query: dict[str, list[str]]) -> dict[str, Any]:
        include_galileo = _bool_query(query, "include_galileo", default=True)
        tenant_id = _first(query, "tenant_id", "c3-demo-tenant")
        workspace_id = _first(query, "workspace_id", "wayne-demo")
        window = _first(query, "window", "-24h") or "-24h"

        payload = self._load_summary_fixture()
        payload["schema_version"] = "c3.agent_tokenomics.v1"
        payload["tenant_id"] = tenant_id
        payload["workspace_id"] = workspace_id
        payload["debug"] = {
            **(payload.get("debug") or {}),
            "internal_only": True,
            "fixture_backed": True,
            "galileo": galileo_config_from_env().public_status(),
            "gateway": self._gateway_status(),
            "requested_filters": {
                "agent": _first(query, "agent", "*"),
                "environment": _first(query, "environment", "production"),
                "service": _first(query, "service", "defenseclaw"),
                "window": window,
            },
        }

        if include_galileo:
            legacy = build_payload_from_files(
                o11y_input=self.o11y_fixture_path,
                galileo_input=self.galileo_fixture_path,
                tenant_id=tenant_id,
                workspace_id=workspace_id,
                include_galileo=True,
                realm=self.realm,
            )
            if legacy.get("galileo"):
                payload["galileo"] = legacy["galileo"]

        gateway_status = payload["debug"]["gateway"]
        try:
            live_summary = self._gateway_live_summary(tenant_id=tenant_id, workspace_id=workspace_id, window=window)
            policies = self._gateway_policies()
            alerts = self._gateway_alerts(limit=100)
            gateway_status["reachable"] = True
            if live_summary:
                payload["generated_at"] = live_summary.get("generated_at")
                payload["source"] = live_summary.get("source", payload.get("source"))
                payload["summary"] = live_summary.get("summary", payload.get("summary"))
                payload["top_agents"] = live_summary.get("top_agents", payload.get("top_agents"))
                payload["top_models"] = live_summary.get("top_models", payload.get("top_models"))
                payload["token_mix"] = live_summary.get("token_mix", payload.get("token_mix"))
                payload["tokenomics_detail"] = live_summary.get("tokenomics_detail", payload.get("tokenomics_detail"))
                payload["recommendations"] = live_summary.get("recommendations", payload.get("recommendations", []))
                payload["deep_links"] = live_summary.get("deep_links", payload.get("deep_links", {}))
                payload["debug"]["fixture_backed"] = False
                payload["debug"].update(live_summary.get("debug") or {})
            payload["runtime_governance_cards"] = self._gateway_runtime_cards(policies, alerts)
            payload["runtime_governance_evidence"] = self._gateway_alert_evidence(alerts)
            payload["runtime_governance_policies"] = policies
            self._merge_gateway_agents(payload, policies, alerts)
            if payload["runtime_governance_evidence"]:
                payload.setdefault("recommendations", []).insert(
                    0,
                    {
                        "title": "Live budget breach requires operator action",
                        "why": "DefenseClaw detected an over-budget agent or session in the current cluster.",
                        "action": "Use the Tokenomics Control Plane to deny, steer, or release the affected agent policy.",
                    },
                )
            payload["executive_banner"] = (
                "C3 Tokenomics shows live DefenseClaw budget alerts and applies local runtime policy now; "
                "the same control plane can be driven by Galileo SaaS later."
            )
        except GatewayAPIError as exc:
            gateway_status["reachable"] = False
            gateway_status["error"] = exc.detail
            if not self.allow_fixture_fallback:
                raise

        return payload

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send_json(200, {"status": "ok"})

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        if path == "/healthz":
            self._send_json(
                200,
                {
                    "status": "ok",
                    "integrations": {
                        "galileo": galileo_config_from_env().public_status(),
                        "gateway": self._gateway_status(),
                    },
                },
            )
            return
        if path == "/readyz":
            gateway_status = self._gateway_status()
            if self.gateway_client is None or not gateway_status.get("enabled"):
                if self.allow_fixture_fallback:
                    self._send_json(200, {"status": "ready", "mode": "fixture", "gateway": gateway_status})
                else:
                    self._send_json(503, {"status": "not_ready", "error": "defenseclaw gateway is not configured"})
                return
            try:
                policies = _gateway_object_list(
                    self.gateway_client.list_effective_policies(),
                    "effective policies",
                )
                self._send_json(
                    200,
                    {
                        "status": "ready",
                        "mode": "live",
                        "gateway": {**gateway_status, "reachable": True},
                        "effective_policy_count": len(policies),
                    },
                )
            except GatewayAPIError as exc:
                if self.allow_fixture_fallback:
                    self._send_json(
                        200,
                        {
                            "status": "ready",
                            "mode": "fixture",
                            "gateway": {**gateway_status, "reachable": False, "error": exc.detail},
                        },
                    )
                else:
                    self._send_json(503, {"status": "not_ready", "error": exc.detail})
            return
        if path == "/v1/c3/agent-tokenomics/policies/effective":
            try:
                rows = self.gateway_client.list_effective_policies(agent_id=_first(query, "agent_id")) if self.gateway_client else []
                self._send_json(200, _gateway_object_list(rows, "effective policies"))
            except GatewayAPIError as exc:
                self._send_json(exc.status, exc.detail)
            return
        if path == "/v1/c3/agent-tokenomics/alerts":
            try:
                limit = _bounded_int_query(query, "limit", 50)
                rows = self.gateway_client.list_alerts(limit=limit) if self.gateway_client else []
                self._send_json(200, _gateway_object_list(rows, "budget alerts"))
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
            except GatewayAPIError as exc:
                self._send_json(exc.status, exc.detail)
            return
        if path == "/v1/c3/agent-tokenomics/usage/rows":
            try:
                self._send_json(200, self._usage_rows_payload(query))
            except GatewayAPIError as exc:
                self._send_json(exc.status, exc.detail)
            return
        if path != "/v1/c3/agent-tokenomics/summary":
            self._send_json(404, {"error": "not found"})
            return

        try:
            payload = self._summary_payload(query)
            self._send_json(200, payload)
        except GatewayAPIError as exc:
            self._send_json(exc.status, exc.detail)
        except Exception as exc:  # pragma: no cover - defensive for stage demos
            if not self.allow_fixture_fallback:
                self._send_json(503, {"error": "tokenomics summary unavailable", "detail": str(exc)})
                return
            self._send_json(500, {"error": "tokenomics summary failed", "detail": str(exc)})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        if path not in {
            "/v1/c3/agent-tokenomics/controls/apply",
            "/v1/c3/agent-tokenomics/controls/release",
        }:
            self._send_json(404, {"error": "not found"})
            return
        if self.gateway_client is None:
            self._send_json(503, {"error": "defenseclaw gateway is not configured"})
            return
        try:
            payload = self._read_json_body()
        except PayloadTooLargeError as exc:
            self._send_json(413, {"error": str(exc)})
            return
        except json.JSONDecodeError:
            self._send_json(400, {"error": "invalid JSON body"})
            return
        try:
            if path.endswith("/apply"):
                response = self.gateway_client.apply_control(payload)
            else:
                response = self.gateway_client.release_control(payload)
            self._send_json(200, response)
        except GatewayAPIError as exc:
            self._send_json(exc.status, exc.detail)


def configure_handler(
    o11y_fixture_path: str | None = None,
    galileo_fixture_path: str | None = None,
    summary_fixture_path: str | None = None,
    realm: str | None = None,
    allow_fixture_fallback: bool | None = None,
) -> type[C3TokenomicsHandler]:
    C3TokenomicsHandler.o11y_fixture_path = o11y_fixture_path or os.environ.get("TOKENOMICS_DEMO_FIXTURE_PATH")
    C3TokenomicsHandler.galileo_fixture_path = galileo_fixture_path or os.environ.get(
        "GALILEO_RUNTIME_CONTROLS_FIXTURE_PATH"
    )
    C3TokenomicsHandler.summary_fixture_path = summary_fixture_path or os.environ.get("TOKENOMICS_SUMMARY_FIXTURE_PATH")
    C3TokenomicsHandler.realm = realm or os.environ.get("O11Y_REALM")
    C3TokenomicsHandler.gateway_client = GatewayClient(gateway_client_config_from_env())
    if allow_fixture_fallback is None:
        allow_fixture_fallback = os.environ.get("TOKENOMICS_DEMO_ALLOW_FIXTURE_FALLBACK", "true").lower() in TRUTHY
    C3TokenomicsHandler.allow_fixture_fallback = allow_fixture_fallback
    return C3TokenomicsHandler


def make_server(host: str, port: int, **kwargs: Any) -> ThreadingHTTPServer:
    handler = configure_handler(**kwargs)
    return ThreadingHTTPServer((host, port), handler)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve the fixture-backed Cisco Cloud Control Agent Tokenomics API.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--input", default=None, help="O11y token metric rows JSON fixture")
    parser.add_argument("--galileo-input", default=None, help="Galileo runtime controls JSON fixture")
    parser.add_argument("--realm", default=None)
    args = parser.parse_args()

    server = make_server(
        args.host,
        args.port,
        o11y_fixture_path=args.input,
        galileo_fixture_path=args.galileo_input,
        realm=args.realm,
    )
    print(f"serving http://{args.host}:{args.port}")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
