#!/usr/bin/env python3
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
import base64
import json
import os
import subprocess
from pathlib import Path
from typing import Any

import requests

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = REPO_ROOT / "playgrounds" / "galileo" / "defenseclaw-runtime-governance.playground.json"
DEFAULT_INTEGRATION_NAME = "bridgeit-openclaw"
DEFAULT_MODEL_NAME = "gpt-4o-mini"
DEFAULT_MODEL_ALIAS = "BridgeIT GPT-4o Mini"
DEFAULT_ENDPOINT = "https://openclaw.rosa.fso-tme.eoha.p3.openshiftapps.com/v1"
DEFAULT_K8S_NAMESPACE = "defenseclaw"
DEFAULT_GALILEO_SECRET = "defenseclaw-secrets"
DEFAULT_GALILEO_SECRET_KEY = "GALILEO_DEMO_V2_API_KEY"
DEFAULT_BRIDGEIT_SECRET = "openclaw-secrets"
DEFAULT_BRIDGEIT_SECRET_KEY = "BRIDGEIT_PROXY_API_KEY"


def _patch_galileo_permission_enum() -> None:
    """Tolerate newer Galileo permission actions with older generated SDKs."""
    try:
        from galileo.resources.models.permission import AnnotationQueueAction
    except ImportError:
        return

    if getattr(AnnotationQueueAction, "_defenseclaw_unknown_patch", False):
        return

    def _missing_(cls, _value):
        return cls.UPDATE

    AnnotationQueueAction._missing_ = classmethod(_missing_)
    AnnotationQueueAction._defenseclaw_unknown_patch = True


def load_manifest(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def read_k8s_secret(namespace: str, secret_name: str, key: str, timeout: float) -> str:
    jsonpath = "{.data." + key + "}"
    result = subprocess.run(
        ["kubectl", "-n", namespace, "get", "secret", secret_name, "-o", f"jsonpath={jsonpath}"],
        check=True,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    encoded = result.stdout.strip()
    if not encoded:
        raise RuntimeError(f"Kubernetes secret {namespace}/{secret_name}:{key} is empty")
    return base64.b64decode(encoded).decode("utf-8").strip()


def resolve_secret(
    *,
    env_name: str,
    use_k8s_secret: bool,
    namespace: str,
    secret_name: str,
    secret_key: str,
    timeout: float,
) -> tuple[str, str]:
    value = os.environ.get(env_name, "").strip()
    if value:
        return value, f"env:{env_name}"
    if use_k8s_secret:
        return (
            read_k8s_secret(namespace, secret_name, secret_key, timeout),
            f"k8s:{namespace}/{secret_name}:{secret_key}",
        )
    raise RuntimeError(f"{env_name} is required, or pass --use-k8s-secret")


def galileo_headers(api_key: str, api_url: str, console_url: str, project_id: str) -> dict[str, str]:
    os.environ["GALILEO_API_KEY"] = api_key
    os.environ["GALILEO_API_URL"] = api_url
    os.environ["GALILEO_CONSOLE_URL"] = console_url
    _patch_galileo_permission_enum()
    from galileo.config import GalileoPythonConfig
    from galileo.projects import get_project

    # The REST integration API expects the SDK-minted JWT, not only the API key.
    get_project(id=project_id)
    config = GalileoPythonConfig()
    if not config.jwt_token:
        raise RuntimeError("Galileo SDK did not mint a JWT token")
    jwt = config.jwt_token.get_secret_value()
    return {
        "Accept": "application/json",
        "Authorization": f"Bearer {jwt}",
        "Content-Type": "application/json",
        "Galileo-API-Key": api_key,
    }


def integration_payload(args: argparse.Namespace, bridgeit_proxy_key: str) -> dict[str, Any]:
    return {
        "endpoint": args.endpoint.rstrip("/"),
        "authentication_type": "api_key",
        "api_key_header": "Authorization",
        "api_key_value": f"Bearer {bridgeit_proxy_key}",
        "default_model": args.model_name,
        "model_properties": [
            {
                "name": args.model_name,
                "alias": args.model_alias,
                "supported_parameters": [
                    "max_tokens",
                    "temperature",
                    "top_p",
                    "stop_sequences",
                    "frequency_penalty",
                    "presence_penalty",
                ],
            }
        ],
    }


def sanitized_payload(payload: dict[str, Any]) -> dict[str, Any]:
    out = dict(payload)
    if out.get("api_key_value"):
        out["api_key_value"] = "<redacted>"
    return out


def validate_bridgeit_proxy(
    endpoint: str,
    bridgeit_proxy_key: str,
    model_name: str,
    timeout: float,
) -> dict[str, Any]:
    base = endpoint.rstrip("/")
    headers = {"Authorization": f"Bearer {bridgeit_proxy_key}"}
    health = requests.get(base.removesuffix("/v1") + "/healthz", timeout=timeout)
    models = requests.get(base + "/models", headers=headers, timeout=timeout)
    chat = requests.post(
        base + "/chat/completions",
        headers={**headers, "Content-Type": "application/json"},
        json={
            "model": model_name,
            "messages": [{"role": "user", "content": "Reply with ok only."}],
            "max_tokens": 5,
        },
        timeout=timeout,
    )
    chat_text = ""
    try:
        chat_text = chat.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, ValueError):
        chat_text = chat.text[:200]
    return {
        "health_status": health.status_code,
        "models_status": models.status_code,
        "chat_status": chat.status_code,
        "chat_text": chat_text,
        "model": model_name,
    }


def configure(args: argparse.Namespace) -> dict[str, Any]:
    manifest = load_manifest(args.manifest)
    project = manifest["project"]
    api_url = args.api_url or project.get("api_url") or os.environ.get("GALILEO_API_URL") or "https://api.galileo.ai"
    console_url = (
        args.console_url
        or project.get("console_url")
        or os.environ.get("GALILEO_CONSOLE_URL")
        or "https://app.galileo.ai"
    )
    project_id = args.project_id or project["id"]

    if args.dry_run or not args.execute:
        placeholder = integration_payload(args, "<redacted>")
        return {
            "dry_run": True,
            "integration_name": args.integration_name,
            "target": args.target,
            "project_id": project_id,
            "api_url": api_url,
            "console_url": console_url,
            "payload": sanitized_payload(placeholder),
        }

    galileo_key, galileo_source = resolve_secret(
        env_name="GALILEO_API_KEY",
        use_k8s_secret=args.use_k8s_secret,
        namespace=args.k8s_namespace,
        secret_name=args.galileo_secret_name,
        secret_key=args.galileo_secret_key,
        timeout=args.timeout,
    )
    bridgeit_key, bridgeit_source = resolve_secret(
        env_name="BRIDGEIT_PROXY_API_KEY",
        use_k8s_secret=args.use_k8s_secret,
        namespace=args.k8s_namespace,
        secret_name=args.bridgeit_secret_name,
        secret_key=args.bridgeit_secret_key,
        timeout=args.timeout,
    )
    payload = integration_payload(args, bridgeit_key)
    proxy_check = (
        None
        if args.skip_proxy_test
        else validate_bridgeit_proxy(args.endpoint, bridgeit_key, args.model_name, args.timeout)
    )
    headers = galileo_headers(galileo_key, api_url, console_url, project_id)
    target_paths: list[tuple[str, str]] = []
    if args.target in {"named", "both"}:
        target_paths.append((f"custom/{args.integration_name}", f"/v2/integrations/custom/{args.integration_name}"))
    if args.target in {"default", "both"}:
        # Select the default integration last when both are configured; prompt
        # experiments resolve the generic "custom" provider reliably.
        target_paths.append(("custom", "/v2/integrations/custom"))

    integrations: list[dict[str, Any]] = []
    selections: list[dict[str, Any]] = []
    for label, path in target_paths:
        response = requests.put(
            api_url.rstrip("/") + path,
            headers=headers,
            json=payload,
            timeout=args.timeout,
        )
        body = response.json() if response.text else {}
        if not response.ok:
            return {
                "ok": False,
                "status": "configure_failed",
                "target": label,
                "http_status": response.status_code,
                "detail": body,
                "payload": sanitized_payload(payload),
                "proxy_check": proxy_check,
                "galileo_key_source": galileo_source,
                "bridgeit_key_source": bridgeit_source,
            }
        integrations.append(
            {
                key: body.get(key)
                for key in ("id", "name", "provider", "created_at", "updated_at", "is_selected", "is_disabled")
            }
        )

        if args.select:
            integration_id = body.get("id")
            if not integration_id:
                raise RuntimeError("Galileo response did not include integration id")
            select_response = requests.put(
                api_url.rstrip("/") + f"/v2/integrations/{integration_id}/select",
                headers=headers,
                timeout=args.timeout,
            )
            select_body = select_response.json() if select_response.text else {}
            if not select_response.ok:
                return {
                    "ok": False,
                    "status": "select_failed",
                    "target": label,
                    "http_status": select_response.status_code,
                    "detail": select_body,
                    "payload": sanitized_payload(payload),
                    "proxy_check": proxy_check,
                    "galileo_key_source": galileo_source,
                    "bridgeit_key_source": bridgeit_source,
                }
            selections.append(
                {key: select_body.get(key) for key in ("id", "name", "provider", "is_selected", "is_disabled")}
            )

    return {
        "ok": True,
        "status": "configured",
        "integrations": integrations,
        "selections": selections,
        "payload": sanitized_payload(payload),
        "proxy_check": proxy_check,
        "galileo_key_source": galileo_source,
        "bridgeit_key_source": bridgeit_source,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Configure Galileo custom integration for the BridgeIT proxy.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Print the planned integration payload.")
    mode.add_argument("--execute", action="store_true", help="Create/update the Galileo integration.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--integration-name", default=DEFAULT_INTEGRATION_NAME)
    parser.add_argument(
        "--target",
        choices=["named", "default", "both"],
        default="both",
        help="Configure the named integration, default custom integration, or both.",
    )
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--model-name", default=DEFAULT_MODEL_NAME)
    parser.add_argument("--model-alias", default=DEFAULT_MODEL_ALIAS)
    parser.add_argument("--project-id", default=None)
    parser.add_argument("--api-url", default=None)
    parser.add_argument("--console-url", default=None)
    parser.add_argument("--select", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--skip-proxy-test", action="store_true")
    parser.add_argument("--use-k8s-secret", action="store_true")
    parser.add_argument("--k8s-namespace", default=DEFAULT_K8S_NAMESPACE)
    parser.add_argument("--galileo-secret-name", default=DEFAULT_GALILEO_SECRET)
    parser.add_argument("--galileo-secret-key", default=DEFAULT_GALILEO_SECRET_KEY)
    parser.add_argument("--bridgeit-secret-name", default=DEFAULT_BRIDGEIT_SECRET)
    parser.add_argument("--bridgeit-secret-key", default=DEFAULT_BRIDGEIT_SECRET_KEY)
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()
    print(json.dumps(configure(args), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
