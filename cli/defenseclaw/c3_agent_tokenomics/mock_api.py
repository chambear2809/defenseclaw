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
import copy
import json
import os
import re
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from .cli import build_payload_from_files
from .fixtures import default_o11y_rows, package_data_json, read_json
from .galileo_config import galileo_config_from_env
from .gateway_client import GatewayAPIError, GatewayClient, gateway_client_config_from_env
from .policy_studio import (
    POLICY_STUDIO_APPLY_PATH_RE,
    POLICY_STUDIO_DRAFT_PATH,
    PolicyStudioAPIError,
    PolicyStudioService,
)
from .transform import build_summary, gateway_observations_to_metric_rows

TRUTHY = {"1", "true", "yes", "y", "on"}
MAX_GATEWAY_LIST_LIMIT = 5000
MAX_CONTROL_BODY_BYTES = 64 * 1024
RUNTIME_CONTROL_TARGET_TYPES = {"command", "tool"}
NETWORK_ACTIONS = {"quarantine", "restore"}
FLEET_OVERVIEW_PATH = "/v1/c3/agent-tokenomics/fleet/overview"
FLEET_ANALYTICS_PATH = "/v1/c3/agent-tokenomics/fleet/analytics"
FLEET_INFRASTRUCTURE_PATH = "/v1/c3/agent-tokenomics/fleet/infrastructure"
FLEET_DEMO_RESET_PATH = "/v1/c3/agent-tokenomics/fleet/demo/reset"
SECURITY_POLICY_PATH = "/v1/c3/agent-tokenomics/security/policy"
DESKSIDE_ACTION_PREFIX = "/v1/c3/agent-tokenomics/fleet/desksides/"
DESKSIDE_ACTION_SUFFIX = "/network-action"
DESKSIDE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
INFRASTRUCTURE_WINDOWS = {"-1h": 1, "-6h": 6, "-24h": 24}
INFRASTRUCTURE_RESOLUTIONS = {"1h": 1, "6h": 6}


class PayloadTooLargeError(ValueError):
    pass


class FleetStateConflictError(ValueError):
    pass


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _new_fleet_demo_state() -> dict[str, Any]:
    try:
        state = package_data_json("mfe_prebuilt", "fixtures", "amd-deskside-fleet.json")
    except FileNotFoundError:
        # Source checkouts can have a stale wheel-staging _data directory.
        # The maintained bundle (also copied explicitly into the demo image)
        # remains authoritative until the next package-data refresh.
        source_fixture = (
            Path(__file__).resolve().parents[3]
            / "bundles"
            / "c3_agent_tokenomics"
            / "mfe_prebuilt"
            / "fixtures"
            / "amd-deskside-fleet.json"
        )
        state = json.loads(source_fixture.read_text(encoding="utf-8"))
    if not isinstance(state, dict):
        raise ValueError("AMD Deskside fleet fixture must be an object")
    policy = state.setdefault("security_policy", {})
    if not isinstance(policy, dict):
        raise ValueError("AMD Deskside security policy fixture must be an object")
    policy.setdefault("policy_id", "amd-deskside-critical-quarantine")
    policy.setdefault("version", 1)
    policy["simulated"] = True
    policy.setdefault("integration_state", "demo-ready")
    demo = state.setdefault("demo", {})
    if isinstance(demo, dict):
        demo["inventory_is_fixture"] = True
        demo["network_actions_are_simulated"] = True
    fleet = state.setdefault("fleet", {})
    if isinstance(fleet, dict):
        fleet.setdefault("network_action_count", 0)
    if not isinstance(state.get("devices"), list):
        state["devices"] = []
    if not isinstance(state.get("enforcement_events"), list):
        state["enforcement_events"] = []
    return state


def _load_fleet_analytics() -> dict[str, Any]:
    try:
        payload = package_data_json("mfe_prebuilt", "fixtures", "tokenomics-fleet-analytics.json")
    except FileNotFoundError:
        source_fixture = (
            Path(__file__).resolve().parents[3]
            / "bundles"
            / "c3_agent_tokenomics"
            / "mfe_prebuilt"
            / "fixtures"
            / "tokenomics-fleet-analytics.json"
        )
        payload = json.loads(source_fixture.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("fleet analytics fixture must be an object")
    for name in ("debug", "scope", "disclosure", "dimensions", "adoption", "cost"):
        if not isinstance(payload.get(name), dict):
            raise ValueError(f"fleet analytics {name} must be an object")
    required_lists = {
        "dimensions": ("providers", "models", "teams", "users", "agents"),
        "adoption": ("provider_totals", "daily_active_users", "team_provider_matrix"),
        "cost": ("daily_provider_cost", "detail_rows"),
    }
    for section, names in required_lists.items():
        for name in names:
            rows = payload[section].get(name)
            if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                raise ValueError(f"fleet analytics {section}.{name} must be an array of objects")
    for section in ("adoption", "cost"):
        if not isinstance(payload[section].get("summary"), dict):
            raise ValueError(f"fleet analytics {section}.summary must be an object")
    projection = payload["cost"].get("organization_projection")
    if not isinstance(projection, dict):
        raise ValueError("fleet analytics cost.organization_projection must be an object")
    for name in (
        "basis_window_days",
        "annualization_weeks",
        "modeled_non_halo_developers",
        "modeled_non_halo_cloud_tokens",
        "modeled_non_halo_estimated_cost_usd",
    ):
        if not isinstance(projection.get(name), (int, float)) or isinstance(projection.get(name), bool):
            raise ValueError(f"fleet analytics cost.organization_projection.{name} must be numeric")
    # These markers are an API invariant: modeled fleet analytics must
    # never be mistaken for the separately reported live gateway ledger.
    payload["source"] = "amd_deskside_demo_scenario"
    payload["debug"]["fixture_backed"] = True
    payload["disclosure"]["status"] = "illustrative"
    payload["adoption"]["status"] = "illustrative"
    payload["cost"]["status"] = "illustrative"
    return payload


def _load_fleet_infrastructure() -> dict[str, Any]:
    try:
        payload = package_data_json("mfe_prebuilt", "fixtures", "splunk-o11y-infrastructure.json")
    except FileNotFoundError:
        source_fixture = (
            Path(__file__).resolve().parents[3]
            / "bundles"
            / "c3_agent_tokenomics"
            / "mfe_prebuilt"
            / "fixtures"
            / "splunk-o11y-infrastructure.json"
        )
        payload = json.loads(source_fixture.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Splunk O11y infrastructure fixture must be an object")
    for name in ("debug", "disclosure", "scope", "fleet_summary", "series"):
        if not isinstance(payload.get(name), dict):
            raise ValueError(f"Splunk O11y infrastructure {name} must be an object")
    if not isinstance(payload.get("devices"), list):
        raise ValueError("Splunk O11y infrastructure devices must be an array")
    for metric in (
        "cpu_utilization",
        "memory_utilization",
        "gpu_utilization",
        "network_receive",
        "network_transmit",
        "power",
    ):
        if not isinstance(payload["series"].get(metric), list):
            raise ValueError(f"Splunk O11y infrastructure series.{metric} must be an array")
    payload["source"] = "splunk_o11y_synthetic_demo"
    payload["debug"]["fixture_backed"] = True
    payload["debug"]["synthetic"] = True
    payload["disclosure"]["status"] = "synthetic"
    return payload


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


def _one_query_value(query: dict[str, list[str]], name: str, default: str = "") -> str:
    values = query.get(name, [])
    if len(values) > 1:
        raise ValueError(f"{name} must be provided at most once")
    return values[0].strip() if values else default


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
    fleet_state: dict[str, Any] | None = None
    fleet_analytics_payload: dict[str, Any] | None = None
    fleet_infrastructure_payload: dict[str, Any] | None = None
    policy_studio_service: PolicyStudioService | None = None
    fleet_state_lock = threading.RLock()
    fleet_restore_state: dict[str, dict[str, Any]] = {}

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

    def _gateway_allowed_controls(self) -> list[dict[str, Any]]:
        if self.gateway_client is None:
            return []
        rows = _gateway_object_list(self.gateway_client.list_allowed_controls(), "allowed runtime controls")
        return [row for row in rows if row.get("target_type") in RUNTIME_CONTROL_TARGET_TYPES]

    @staticmethod
    def _runtime_control_payload(payload: dict[str, Any]) -> dict[str, str]:
        supported_fields = {"target_type", "target_name", "reason"}
        unsupported_fields = sorted(str(key) for key in payload if key not in supported_fields)
        if unsupported_fields:
            raise ValueError(f"unsupported agent-control field: {unsupported_fields[0]}")
        target_type = str(payload.get("target_type") or "").strip().lower()
        target_name = str(payload.get("target_name") or "").strip()
        reason = str(payload.get("reason") or "").strip() or "Approved through C3 Tokenomics Agent Controls"
        if target_type not in RUNTIME_CONTROL_TARGET_TYPES:
            raise ValueError("target_type must be command or tool")
        if not target_name:
            raise ValueError("target_name is required")
        if any(character in target_name for character in ("\r", "\n", "\x00")):
            raise ValueError("target_name must be one line and cannot contain NUL")
        if len(target_name) > 512:
            raise ValueError("target_name must be 512 characters or fewer")
        if len(reason) > 512:
            raise ValueError("reason must be 512 characters or fewer")
        return {"target_type": target_type, "target_name": target_name, "reason": reason}

    @staticmethod
    def _single_line_text(
        payload: dict[str, Any],
        name: str,
        *,
        default: str = "",
        maximum: int = 512,
    ) -> str:
        value = payload.get(name)
        if value is None:
            return default
        if not isinstance(value, str):
            raise ValueError(f"{name} must be a string")
        value = value.strip()
        if any(character in value for character in ("\r", "\n", "\x00")):
            raise ValueError(f"{name} must be one line and cannot contain NUL")
        if len(value) > maximum:
            raise ValueError(f"{name} must be {maximum} characters or fewer")
        return value or default

    @staticmethod
    def _deskside_id_from_action_path(path: str) -> str | None:
        if not path.startswith(DESKSIDE_ACTION_PREFIX) or not path.endswith(DESKSIDE_ACTION_SUFFIX):
            return None
        encoded = path[len(DESKSIDE_ACTION_PREFIX) : -len(DESKSIDE_ACTION_SUFFIX)]
        try:
            device_id = unquote(encoded)
        except (UnicodeDecodeError, ValueError) as exc:
            raise ValueError("invalid device_id encoding") from exc
        if not DESKSIDE_ID_RE.fullmatch(device_id):
            raise ValueError("device_id must be 1-128 letters, numbers, dots, underscores, or hyphens")
        return device_id

    def _fleet_overview(self) -> dict[str, Any]:
        with self.fleet_state_lock:
            if self.fleet_state is None:
                self.__class__.fleet_state = _new_fleet_demo_state()
            return copy.deepcopy(self.fleet_state)

    def _fleet_analytics_response(self) -> dict[str, Any]:
        if self.fleet_analytics_payload is None:
            self.__class__.fleet_analytics_payload = _load_fleet_analytics()
        return copy.deepcopy(self.fleet_analytics_payload)

    @staticmethod
    def _selected_infrastructure_summary(device: dict[str, Any]) -> dict[str, Any]:
        metrics = device["metrics"]

        def selected(name: str, method: str) -> dict[str, Any]:
            metric = copy.deepcopy(metrics[name])
            metric["method"] = method
            metric["coverage"] = (
                "selected device is stale" if device["stale"] else "1 of 1 selected device"
            )
            return metric

        return {
            "avg_cpu_utilization": selected("cpu_utilization", "selected device current value"),
            "avg_memory_utilization": selected("memory_utilization", "selected device current value"),
            "avg_gpu_utilization": selected("gpu_utilization", "selected device current value"),
            "avg_network_link_utilization": selected(
                "network_link_utilization", "selected device current value"
            ),
            "total_network_receive": selected("network_receive", "selected device current value"),
            "total_network_transmit": selected("network_transmit", "selected device current value"),
            "current_power": selected("power", "selected device current value"),
            "energy_24h": selected("energy_24h", "selected device historical total"),
            "energy_7d": selected("energy_7d", "selected device historical total"),
            "reporting_devices": 0 if device["stale"] else 1,
            "stale_devices": 1 if device["stale"] else 0,
        }

    def _fleet_infrastructure_response(self, query: dict[str, list[str]]) -> dict[str, Any]:
        window = _one_query_value(query, "window", "-24h")
        resolution = _one_query_value(query, "resolution", "1h")
        device_id = _one_query_value(query, "device_id")
        if window not in INFRASTRUCTURE_WINDOWS:
            raise ValueError("window must be one of -1h, -6h, or -24h")
        if resolution not in INFRASTRUCTURE_RESOLUTIONS:
            raise ValueError("resolution must be 1h or 6h")
        if device_id and not DESKSIDE_ID_RE.fullmatch(device_id):
            raise ValueError("device_id must be 1-128 letters, numbers, dots, underscores, or hyphens")

        if self.fleet_infrastructure_payload is None:
            self.__class__.fleet_infrastructure_payload = _load_fleet_infrastructure()
        payload = copy.deepcopy(self.fleet_infrastructure_payload)
        selected_device = next(
            (device for device in payload["devices"] if device.get("device_id") == device_id),
            None,
        )
        if device_id and selected_device is None:
            raise KeyError(device_id)

        payload["scope"]["window"] = window
        payload["scope"]["resolution"] = resolution
        payload["scope"]["device_id"] = device_id or None
        payload["debug"]["requested_filters"] = {
            "window": window,
            "resolution": resolution,
            "device_id": device_id or None,
        }

        if selected_device is not None:
            payload["devices"] = [selected_device]
            payload["fleet_summary"] = self._selected_infrastructure_summary(selected_device)
            current_by_series = {
                "cpu_utilization": "cpu_utilization",
                "memory_utilization": "memory_utilization",
                "gpu_utilization": "gpu_utilization",
                "network_receive": "network_receive",
                "network_transmit": "network_transmit",
                "power": "power",
            }
            for series_name, metric_name in current_by_series.items():
                points = payload["series"][series_name]
                current_fleet_value = float(points[-1]["value"]) if points else 0
                current_device_value = selected_device["metrics"][metric_name]["value"]
                for point in points:
                    point["value"] = (
                        None
                        if current_device_value is None or current_fleet_value == 0
                        else round(float(point["value"]) * float(current_device_value) / current_fleet_value, 2)
                    )

        generated_at = datetime.fromisoformat(str(payload["generated_at"]).replace("Z", "+00:00"))
        cutoff = generated_at - timedelta(hours=INFRASTRUCTURE_WINDOWS[window])
        resolution_hours = INFRASTRUCTURE_RESOLUTIONS[resolution]
        for series_name, points in payload["series"].items():
            within_window = [
                point
                for point in points
                if datetime.fromisoformat(str(point["timestamp"]).replace("Z", "+00:00")) >= cutoff
            ]
            payload["series"][series_name] = list(reversed(list(reversed(within_window))[::resolution_hours]))
        return payload

    def _reset_fleet_demo(self, payload: dict[str, Any]) -> dict[str, Any]:
        unsupported_fields = sorted(str(key) for key in payload if key != "reason")
        if unsupported_fields:
            raise ValueError(f"unsupported fleet-demo-reset field: {unsupported_fields[0]}")
        reason = self._single_line_text(
            payload,
            "reason",
            default="Reset AMD Deskside demo state through Cloud Control",
        )
        with self.fleet_state_lock:
            self.__class__.fleet_state = _new_fleet_demo_state()
            self.fleet_restore_state.clear()
            response = copy.deepcopy(self.fleet_state)
        response["reset"] = {
            "completed": True,
            "reason": reason,
            "simulated": True,
        }
        return response

    def _update_security_policy(self, payload: dict[str, Any]) -> dict[str, Any]:
        supported_fields = {"enabled", "expected_version", "version", "reason", "updated_by"}
        unsupported_fields = sorted(str(key) for key in payload if key not in supported_fields)
        if unsupported_fields:
            raise ValueError(f"unsupported security-policy field: {unsupported_fields[0]}")
        enabled = payload.get("enabled")
        if not isinstance(enabled, bool):
            raise ValueError("enabled must be a boolean")
        expected_version = payload.get("expected_version", payload.get("version"))
        if expected_version is not None and (
            isinstance(expected_version, bool) or not isinstance(expected_version, int) or expected_version < 1
        ):
            raise ValueError("expected_version must be a positive integer")
        reason = self._single_line_text(
            payload,
            "reason",
            default="Updated through Cloud Control AMD Deskside security policy",
        )
        updated_by = self._single_line_text(
            payload,
            "updated_by",
            default="cloud-control-demo",
            maximum=128,
        )

        with self.fleet_state_lock:
            if self.fleet_state is None:
                self.__class__.fleet_state = _new_fleet_demo_state()
            policy = self.fleet_state.setdefault("security_policy", {})
            current_version = int(policy.get("version") or 1)
            if expected_version is not None and expected_version != current_version:
                raise FleetStateConflictError(
                    f"security policy version conflict: expected {expected_version}, current {current_version}"
                )
            changed = bool(policy.get("auto_quarantine")) != enabled
            if changed:
                policy["auto_quarantine"] = enabled
                policy["mode"] = "enforce" if enabled else "monitor"
                policy["version"] = current_version + 1
                policy["updated_at"] = _utc_now()
                policy["updated_by"] = updated_by
                policy["change_reason"] = reason
            policy["simulated"] = True
            policy["integration_state"] = "demo-ready"
            response = copy.deepcopy(policy)
            response["changed"] = changed
            response["existing_quarantines_released"] = False
            return response

    def _update_fleet_counts(self) -> None:
        if self.fleet_state is None:
            return
        devices = self.fleet_state.get("devices") or []
        fleet = self.fleet_state.setdefault("fleet", {})
        fleet["quarantined_devices"] = sum(
            1 for device in devices if isinstance(device, dict) and bool(device.get("quarantined"))
        )

    def _network_action_events(
        self,
        *,
        device: dict[str, Any],
        action: str,
        reason: str,
        requested_by: str,
    ) -> list[dict[str, Any]]:
        if self.fleet_state is None:
            return []
        occurred_at = _utc_now()
        events = self.fleet_state.setdefault("enforcement_events", [])
        device_id = str(device.get("device_id") or "unknown")
        switch = str(device.get("switch_name") or "Cisco C9350 access switch")
        switch_port = str(device.get("switch_port") or "managed port")
        policy = self.fleet_state.get("security_policy") or {}
        quarantine_policy = str(policy.get("policy_name") or "AMD-DESKSIDE-QUARANTINE")
        if action == "quarantine":
            stages = [
                (
                    "cloud-control",
                    "Network quarantine requested",
                    f"{requested_by} requested simulated quarantine: {reason}",
                ),
                ("ise", "ISE ANC policy assigned", f"{quarantine_policy} assigned to {device_id}"),
                ("coa", "RADIUS CoA accepted", f"{switch} reauthorized {switch_port}"),
                ("enforce", "C9350 restricted access", "Endpoint can reach only remediation services"),
            ]
        else:
            stages = [
                (
                    "cloud-control",
                    "Network restore requested",
                    f"{requested_by} requested simulated restore: {reason}",
                ),
                ("ise", "ISE standard policy assigned", f"Standard access policy assigned to {device_id}"),
                ("coa", "RADIUS CoA accepted", f"{switch} reauthorized {switch_port}"),
                ("enforce", "C9350 restored access", "Endpoint returned to its previous network access"),
            ]
        created: list[dict[str, Any]] = []
        for stage, title, detail in stages:
            event = {
                "event_id": f"evt-demo-{action}-{device_id.lower()}-{len(events) + 1:04d}",
                "device_id": device_id,
                "stage": stage,
                "status": "complete",
                "title": title,
                "detail": detail,
                "action": action,
                "occurred_at": occurred_at,
                "simulated": True,
            }
            events.append(event)
            created.append(copy.deepcopy(event))
        return created

    def _apply_network_action(self, device_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        supported_fields = {"action", "reason", "requested_by"}
        unsupported_fields = sorted(str(key) for key in payload if key not in supported_fields)
        if unsupported_fields:
            raise ValueError(f"unsupported network-action field: {unsupported_fields[0]}")
        action = payload.get("action")
        if not isinstance(action, str) or action.strip().lower() not in NETWORK_ACTIONS:
            raise ValueError("action must be quarantine or restore")
        action = action.strip().lower()
        reason = self._single_line_text(
            payload,
            "reason",
            default=f"Simulated {action} through Cloud Control",
        )
        requested_by = self._single_line_text(
            payload,
            "requested_by",
            default="cloud-control-demo",
            maximum=128,
        )

        with self.fleet_state_lock:
            if self.fleet_state is None:
                self.__class__.fleet_state = _new_fleet_demo_state()
            devices = self.fleet_state.get("devices") or []
            device = next(
                (
                    row
                    for row in devices
                    if isinstance(row, dict) and str(row.get("device_id") or "") == device_id
                ),
                None,
            )
            if device is None:
                raise KeyError(device_id)
            is_quarantined = bool(device.get("quarantined"))
            changed = (action == "quarantine" and not is_quarantined) or (
                action == "restore" and is_quarantined
            )
            created_events: list[dict[str, Any]] = []
            if changed and action == "quarantine":
                self.fleet_restore_state[device_id] = {
                    key: copy.deepcopy(device.get(key))
                    for key in ("status", "risk", "model_route", "ise_policy", "network_access")
                }
                device["quarantined"] = True
                device["status"] = "quarantined"
                device["risk"] = "quarantined"
                device["model_route"] = "Blocked"
                policy = self.fleet_state.get("security_policy") or {}
                device["ise_policy"] = str(policy.get("policy_name") or "AMD-DESKSIDE-QUARANTINE")
                device["network_access"] = "Remediation only"
                created_events = self._network_action_events(
                    device=device,
                    action=action,
                    reason=reason,
                    requested_by=requested_by,
                )
            elif changed:
                baseline = self.fleet_restore_state.pop(device_id, None) or {}
                device["quarantined"] = False
                device["status"] = baseline.get("status") or "online"
                device["risk"] = baseline.get("risk") or "review"
                device["model_route"] = baseline.get("model_route") or "AMD local"
                device["ise_policy"] = baseline.get("ise_policy") or "AMD-DESKSIDE-STANDARD"
                device["network_access"] = baseline.get("network_access") or "Full access"
                created_events = self._network_action_events(
                    device=device,
                    action=action,
                    reason=reason,
                    requested_by=requested_by,
                )
            self._update_fleet_counts()
            fleet = self.fleet_state.setdefault("fleet", {})
            if changed:
                fleet["network_action_count"] = int(fleet.get("network_action_count") or 0) + 1
                fleet["last_network_action_at"] = _utc_now()
                self.fleet_state["generated_at"] = fleet["last_network_action_at"]
            return {
                "action": action,
                "changed": changed,
                "device": copy.deepcopy(device),
                "events": created_events,
                "fleet": copy.deepcopy(fleet),
                "network_actions_are_simulated": True,
                "timeline_count": len(self.fleet_state.get("enforcement_events") or []),
            }

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
                        "action": (
                            "Use the Tokenomics Control Plane to deny, steer, or release the affected agent policy."
                        ),
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
                        "policy_studio": (
                            self.policy_studio_service.public_status()
                            if self.policy_studio_service
                            else {"enabled": False}
                        ),
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
        if path == FLEET_OVERVIEW_PATH:
            self._send_json(200, self._fleet_overview())
            return
        if path == FLEET_ANALYTICS_PATH:
            self._send_json(200, self._fleet_analytics_response())
            return
        if path == FLEET_INFRASTRUCTURE_PATH:
            try:
                infrastructure_query = parse_qs(parsed.query, keep_blank_values=True)
                self._send_json(200, self._fleet_infrastructure_response(infrastructure_query))
            except KeyError as exc:
                self._send_json(404, {"error": "infrastructure device not found", "device_id": str(exc.args[0])})
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
            return
        if path == "/v1/c3/agent-tokenomics/policies/effective":
            try:
                rows = (
                    self.gateway_client.list_effective_policies(agent_id=_first(query, "agent_id"))
                    if self.gateway_client
                    else []
                )
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
        if path == "/v1/c3/agent-tokenomics/agent-controls/allowed":
            try:
                self._send_json(200, self._gateway_allowed_controls())
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
        policy_studio_apply_match = POLICY_STUDIO_APPLY_PATH_RE.fullmatch(path)
        try:
            deskside_id = self._deskside_id_from_action_path(path)
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
            return
        gateway_paths = {
            "/v1/c3/agent-tokenomics/controls/apply",
            "/v1/c3/agent-tokenomics/controls/release",
            "/v1/c3/agent-tokenomics/agent-controls/allow",
            "/v1/c3/agent-tokenomics/agent-controls/remove",
        }
        if (
            path not in gateway_paths
            and path not in {SECURITY_POLICY_PATH, FLEET_DEMO_RESET_PATH}
            and path != POLICY_STUDIO_DRAFT_PATH
            and policy_studio_apply_match is None
            and deskside_id is None
        ):
            self._send_json(404, {"error": "not found"})
            return
        try:
            payload = self._read_json_body()
        except PayloadTooLargeError as exc:
            self._send_json(413, {"error": str(exc)})
            return
        except json.JSONDecodeError:
            self._send_json(400, {"error": "invalid JSON body"})
            return

        if path == POLICY_STUDIO_DRAFT_PATH or policy_studio_apply_match is not None:
            if self.policy_studio_service is None:
                self._send_json(503, {"error": "Policy Studio is not configured"})
                return
            try:
                if path == POLICY_STUDIO_DRAFT_PATH:
                    self._send_json(201, self.policy_studio_service.create_draft(payload))
                else:
                    self._send_json(
                        200,
                        self.policy_studio_service.stage_draft(policy_studio_apply_match.group(1), payload),
                    )
            except PolicyStudioAPIError as exc:
                self._send_json(exc.status, {"error": str(exc)})
            return

        if path == FLEET_DEMO_RESET_PATH:
            try:
                self._send_json(200, self._reset_fleet_demo(payload))
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
            return
        if path == SECURITY_POLICY_PATH:
            try:
                self._send_json(200, self._update_security_policy(payload))
            except FleetStateConflictError as exc:
                self._send_json(409, {"error": str(exc)})
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
            return
        if deskside_id is not None:
            try:
                self._send_json(200, self._apply_network_action(deskside_id, payload))
            except KeyError:
                self._send_json(404, {"error": "deskside not found", "device_id": deskside_id})
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
            return

        if self.gateway_client is None:
            self._send_json(503, {"error": "defenseclaw gateway is not configured"})
            return
        try:
            if path.endswith("/agent-controls/allow"):
                response = self.gateway_client.allow_runtime_control(self._runtime_control_payload(payload))
            elif path.endswith("/agent-controls/remove"):
                response = self.gateway_client.remove_runtime_control(self._runtime_control_payload(payload))
            elif path.endswith("/apply"):
                response = self.gateway_client.apply_control(payload)
            else:
                response = self.gateway_client.release_control(payload)
            self._send_json(200, response)
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
        except GatewayAPIError as exc:
            self._send_json(exc.status, exc.detail)


def configure_handler(
    o11y_fixture_path: str | None = None,
    galileo_fixture_path: str | None = None,
    summary_fixture_path: str | None = None,
    realm: str | None = None,
    allow_fixture_fallback: bool | None = None,
) -> type[C3TokenomicsHandler]:
    # Each ThreadingHTTPServer receives a dedicated handler subclass. Besides
    # avoiding cross-test configuration leakage, this gives every demo server
    # a fresh in-memory fleet/security state without changing the immutable
    # fixture on disk.
    handler = type("ConfiguredC3TokenomicsHandler", (C3TokenomicsHandler,), {})
    handler.o11y_fixture_path = o11y_fixture_path or os.environ.get("TOKENOMICS_DEMO_FIXTURE_PATH")
    handler.galileo_fixture_path = galileo_fixture_path or os.environ.get(
        "GALILEO_RUNTIME_CONTROLS_FIXTURE_PATH"
    )
    handler.summary_fixture_path = summary_fixture_path or os.environ.get("TOKENOMICS_SUMMARY_FIXTURE_PATH")
    handler.realm = realm or os.environ.get("O11Y_REALM")
    handler.gateway_client = GatewayClient(gateway_client_config_from_env())
    if allow_fixture_fallback is None:
        allow_fixture_fallback = os.environ.get("TOKENOMICS_DEMO_ALLOW_FIXTURE_FALLBACK", "true").lower() in TRUTHY
    handler.allow_fixture_fallback = allow_fixture_fallback
    handler.fleet_state = _new_fleet_demo_state()
    handler.fleet_analytics_payload = _load_fleet_analytics()
    handler.fleet_infrastructure_payload = _load_fleet_infrastructure()
    handler.policy_studio_service = PolicyStudioService()
    handler.fleet_state_lock = threading.RLock()
    handler.fleet_restore_state = {}
    return handler


def make_server(host: str, port: int, **kwargs: Any) -> ThreadingHTTPServer:
    handler = configure_handler(**kwargs)
    return ThreadingHTTPServer((host, port), handler)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve the fixture-backed Deskside AI Resilience API.")
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
