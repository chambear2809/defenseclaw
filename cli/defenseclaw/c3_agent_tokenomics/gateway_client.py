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

import json
import os
from dataclasses import dataclass
from typing import Any
from urllib import error, parse, request

DEFAULT_DEFENSECLAW_GATEWAY_BASE_URL = "http://defenseclaw.defenseclaw.svc.cluster.local:18970"
MAX_GATEWAY_RESPONSE_BYTES = 8 * 1024 * 1024


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


@dataclass(frozen=True)
class GatewayClientConfig:
    base_url: str | None = DEFAULT_DEFENSECLAW_GATEWAY_BASE_URL
    token: str | None = None
    client_header: str = "c3-tokenomics-bff"

    @property
    def enabled(self) -> bool:
        return bool(self.base_url and self.token)

    def public_status(self) -> dict[str, Any]:
        return {
            "base_url": self.base_url,
            "token_configured": bool(self.token),
            "enabled": self.enabled,
        }


class GatewayAPIError(RuntimeError):
    def __init__(self, status: int, detail: Any, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.detail = detail


def gateway_client_config_from_env(
    *,
    base_url: str | None = None,
    token: str | None = None,
) -> GatewayClientConfig:
    return GatewayClientConfig(
        base_url=_clean(base_url or os.environ.get("DEFENSECLAW_GATEWAY_BASE_URL"))
        or DEFAULT_DEFENSECLAW_GATEWAY_BASE_URL,
        token=_clean(token or os.environ.get("DEFENSECLAW_GATEWAY_TOKEN")),
    )


class GatewayClient:
    def __init__(self, config: GatewayClientConfig | None = None, *, timeout: float = 5.0) -> None:
        self.config = config or gateway_client_config_from_env()
        self.timeout = timeout

    def public_status(self) -> dict[str, Any]:
        return self.config.public_status()

    def list_effective_policies(self, *, agent_id: str | None = None) -> Any:
        query = {"agent_id": agent_id} if agent_id else None
        return self._request_json("GET", "/api/v1/budget-control/policies/effective", query=query)

    def list_alerts(self, *, limit: int = 50) -> Any:
        return self._request_json("GET", "/api/v1/budget-control/alerts", query={"limit": str(limit)})

    def list_usage_observations(self, *, window: str = "-24h", limit: int = 5000) -> Any:
        return self._request_json(
            "GET",
            "/api/v1/budget-control/usage/observations",
            query={"window": window, "limit": str(limit)},
        )

    def apply_control(self, payload: dict[str, Any]) -> Any:
        return self._request_json("POST", "/api/v1/budget-control/controls/apply", body=payload)

    def release_control(self, payload: dict[str, Any]) -> Any:
        return self._request_json("POST", "/api/v1/budget-control/controls/release", body=payload)

    def list_allowed_controls(self) -> Any:
        return self._request_json("GET", "/enforce/allowed")

    def allow_runtime_control(self, payload: dict[str, Any]) -> Any:
        return self._request_json("POST", "/enforce/allow", body=payload)

    def remove_runtime_control(self, payload: dict[str, Any]) -> Any:
        return self._request_json("DELETE", "/enforce/allow", body=payload)

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, str] | None = None,
        body: dict[str, Any] | None = None,
    ) -> Any:
        if not self.config.enabled or not self.config.base_url or not self.config.token:
            raise GatewayAPIError(
                503,
                {"error": "defenseclaw gateway is not configured"},
                "DefenseClaw gateway is not configured for tokenomics control.",
            )

        base = self.config.base_url.rstrip("/")
        url = base + path
        if query:
            url = f"{url}?{parse.urlencode(query)}"

        headers = {"Authorization": f"Bearer {self.config.token}"}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            headers["X-DefenseClaw-Client"] = self.config.client_header
            data = json.dumps(body, separators=(",", ":")).encode("utf-8")

        req = request.Request(url, method=method, headers=headers, data=data)
        try:
            with request.urlopen(req, timeout=self.timeout) as response:
                raw_bytes = response.read(MAX_GATEWAY_RESPONSE_BYTES + 1)
                if len(raw_bytes) > MAX_GATEWAY_RESPONSE_BYTES:
                    raise GatewayAPIError(
                        502,
                        {"error": "defenseclaw gateway response too large"},
                        f"{method} {url} exceeded the response size limit",
                    )
                try:
                    raw = raw_bytes.decode("utf-8")
                    return json.loads(raw) if raw else {}
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise GatewayAPIError(
                        502,
                        {"error": "invalid defenseclaw gateway response", "expected": "JSON"},
                        f"{method} {url} returned malformed JSON",
                    ) from exc
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            parsed = _parse_json_or_text(detail)
            raise GatewayAPIError(exc.code, parsed, f"{method} {url} failed with HTTP {exc.code}") from exc
        except GatewayAPIError:
            raise
        except (error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            reason = getattr(exc, "reason", None) or str(exc)
            raise GatewayAPIError(
                503,
                {"error": "defenseclaw gateway unreachable", "detail": str(reason)},
                f"{method} {url} failed: {reason}",
            ) from exc


def _parse_json_or_text(raw: str) -> Any:
    text = raw.strip()
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"error": text}
