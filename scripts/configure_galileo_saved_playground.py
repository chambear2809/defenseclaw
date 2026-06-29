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
import datetime as dt
import json
import os
import subprocess
from pathlib import Path
from typing import Any

import requests

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = REPO_ROOT / "playgrounds" / "galileo" / "defenseclaw-runtime-governance.playground.json"
ENTERPRISE_DATASET_NAME = "defenseclaw-enterprise-ops-thousandeyes"
SAVED_PLAYGROUND_ID = "e969b856-9d5d-48a4-90af-b33e20fe6fab"
SAVED_PLAYGROUND_PROMPT_ID = "42a0300b-ae09-4b13-9c11-91c89a4fb71b"
SAVED_PLAYGROUND_NAME = "defenseclaw-enterprise-ops-thousandeyes-playground"
DEFAULT_K8S_SECRET_NAMESPACE = "defenseclaw"
DEFAULT_K8S_SECRET_NAME = "defenseclaw-secrets"
DEFAULT_K8S_SECRET_KEY = "GALILEO_DEMO_V2_API_KEY"
OPTIONAL_SCORERS = ("correctness", "output_pii")


class ConfigureSkipped(RuntimeError):
    def __init__(self, reason: str, detail: str = "") -> None:
        super().__init__(reason)
        self.reason = reason
        self.detail = detail


class TokenUnavailable(RuntimeError):
    pass


def _utc_now() -> str:
    return dt.datetime.now(dt.UTC).isoformat()


def load_manifest(path: Path = DEFAULT_MANIFEST) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        manifest = json.load(handle)
    if not isinstance(manifest.get("project"), dict):
        raise ValueError(f"{path}: project must be an object")
    if not isinstance(manifest.get("prompt"), dict):
        raise ValueError(f"{path}: prompt must be an object")
    if not isinstance(manifest.get("datasets"), list):
        raise ValueError(f"{path}: datasets must be a list")
    return manifest


def enterprise_dataset(manifest: dict[str, Any]) -> dict[str, Any]:
    for dataset in manifest.get("datasets") or []:
        if isinstance(dataset, dict) and dataset.get("name") == ENTERPRISE_DATASET_NAME:
            return dataset
    raise ValueError(f"manifest does not contain {ENTERPRISE_DATASET_NAME!r}")


def _normalize_metric_name(name: Any) -> str:
    return str(name).strip().lower().replace("-", "_").replace(" ", "_")


def _ordered_unique(values: list[str] | tuple[str, ...]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        normalized = _normalize_metric_name(value)
        if normalized and normalized not in seen:
            seen.add(normalized)
            out.append(normalized)
    return out


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


def galileo_auth_token(api_key: str, api_url: str, console_url: str | None, project_id: str) -> str:
    os.environ["GALILEO_API_KEY"] = api_key
    os.environ["GALILEO_API_URL"] = api_url
    if console_url:
        os.environ["GALILEO_CONSOLE_URL"] = console_url
    _patch_galileo_permission_enum()
    from galileo.config import GalileoPythonConfig
    from galileo.projects import get_project

    # The Playground and scorer APIs expect the SDK-minted JWT as bearer auth.
    get_project(id=project_id)
    config = GalileoPythonConfig()
    if not config.jwt_token:
        raise RuntimeError("Galileo SDK did not mint a JWT token")
    return config.jwt_token.get_secret_value()


def scorer_plan(dataset_cfg: dict[str, Any]) -> dict[str, Any]:
    required = _ordered_unique([str(item) for item in dataset_cfg.get("default_metrics") or []])
    optional = [item for item in OPTIONAL_SCORERS if item not in set(required)]
    return {"required": required, "optional": optional}


def _repo_relative_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else REPO_ROOT / path


def prompt_template(prompt_cfg: dict[str, Any]) -> str:
    source = prompt_cfg.get("source")
    if not isinstance(source, str) or not source.strip():
        raise ValueError("manifest prompt.source must be set")
    path = _repo_relative_path(source)
    return path.read_text(encoding="utf-8")


def build_plan(
    manifest: dict[str, Any],
    *,
    playground_id: str = SAVED_PLAYGROUND_ID,
    playground_prompt_id: str = SAVED_PLAYGROUND_PROMPT_ID,
    dataset_version_index: int | None = None,
    resolved_scorers: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    dataset_cfg = enterprise_dataset(manifest)
    project = manifest["project"]
    prompt = manifest["prompt"]
    model = manifest.get("model") or {}
    settings = dict(model.get("settings") or {})
    settings["model_alias"] = model.get("default_alias") or settings.get("model_alias")
    score_plan = scorer_plan(dataset_cfg)
    return {
        "playground_id": playground_id,
        "playground_prompt_id": playground_prompt_id,
        "playground_name": SAVED_PLAYGROUND_NAME,
        "playground_description": manifest.get("description"),
        "project_id": project["id"],
        "api_url": project.get("api_url") or os.environ.get("GALILEO_API_URL") or "https://api.galileo.ai",
        "console_url": project.get("console_url"),
        "dataset": {
            "name": dataset_cfg["name"],
            "id": dataset_cfg["id"],
            "rows": dataset_cfg.get("rows"),
            "version_index": dataset_version_index,
        },
        "prompt": {
            "name": prompt["name"],
            "id": prompt["id"],
            "version": prompt.get("selected_version"),
            "version_id": prompt.get("selected_version_id"),
            "source": prompt.get("source"),
            "variables": list(prompt.get("variables") or []),
            "template": prompt_template(prompt),
        },
        "model_settings": settings,
        "scorers": {
            "required": score_plan["required"],
            "optional": score_plan["optional"],
            "resolved": resolved_scorers or [],
        },
    }


def _headers(api_key: str, auth_token: str | None = None) -> dict[str, str]:
    return {
        "Accept": "application/json",
        "Authorization": f"Bearer {auth_token or api_key}",
        "Content-Type": "application/json",
        "Galileo-API-Key": api_key,
        "User-Agent": "defenseclaw-saved-playground-configurator/1",
    }


def _safe_response_text(response: requests.Response) -> str:
    text = response.text or ""
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        for key in ("message", "detail", "error", "error_description", "title"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                text = value
                break
    return text[:500]


def _skip_reason_for_response(response: requests.Response) -> str | None:
    if response.status_code in {401, 403}:
        return "galileo_auth_unavailable"
    text = _safe_response_text(response).lower()
    quota_markers = ("quota", "insufficient_quota", "rate limit", "rate_limit", "provider", "billing")
    if response.status_code in {400, 402, 409, 429, 503} and any(marker in text for marker in quota_markers):
        return "provider_quota_unavailable"
    return None


def _request_json(
    session: requests.Session,
    method: str,
    api_base: str,
    path: str,
    *,
    api_key: str,
    auth_token: str | None = None,
    timeout: float,
    json_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    response = session.request(
        method,
        api_base.rstrip("/") + path,
        headers=_headers(api_key, auth_token),
        json=json_body,
        timeout=timeout,
    )
    if not response.ok:
        skip_reason = _skip_reason_for_response(response)
        if skip_reason:
            raise ConfigureSkipped(skip_reason, _safe_response_text(response))
        response.raise_for_status()
    if response.status_code == 204 or not response.text:
        return {}
    payload = response.json()
    return payload if isinstance(payload, dict) else {"value": payload}


def _request_json_any(
    session: requests.Session,
    method: str,
    api_base: str,
    paths: list[str] | tuple[str, ...],
    *,
    api_key: str,
    auth_token: str | None = None,
    timeout: float,
    json_body: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], str]:
    attempts: list[str] = []
    last_error: Exception | None = None
    for path in paths:
        try:
            return (
                _request_json(
                    session,
                    method,
                    api_base,
                    path,
                    api_key=api_key,
                    auth_token=auth_token,
                    timeout=timeout,
                    json_body=json_body,
                ),
                path,
            )
        except requests.HTTPError as exc:
            response = exc.response
            status_code = response.status_code if response is not None else None
            if status_code not in {404, 405}:
                raise
            attempts.append(f"{method} {path} -> {status_code}")
            last_error = exc
    detail = "; ".join(attempts) if attempts else "no request paths were attempted"
    raise RuntimeError(f"no Galileo endpoint accepted the request: {detail}") from last_error


def _unversioned_and_v2(path: str) -> tuple[str, str]:
    if path.startswith("/v2/"):
        return (path[3:], path)
    return (path, "/v2" + path)


def latest_dataset_version_index(
    session: requests.Session,
    *,
    api_base: str,
    api_key: str,
    auth_token: str | None = None,
    dataset_id: str,
    timeout: float,
    fallback: int | None = None,
) -> int:
    payload, _ = _request_json_any(
        session,
        "POST",
        api_base,
        _unversioned_and_v2(f"/datasets/{dataset_id}/versions/query"),
        api_key=api_key,
        auth_token=auth_token,
        timeout=timeout,
        json_body={"sort": {"name": "version_index", "ascending": True, "sort_type": "column"}},
    )
    versions = payload.get("versions") if isinstance(payload.get("versions"), list) else []
    indexes = [int(item["version_index"]) for item in versions if isinstance(item, dict) and "version_index" in item]
    if indexes:
        return max(indexes)
    if fallback is not None:
        return int(fallback)
    raise RuntimeError(f"no versions returned for dataset {dataset_id}")


def _scorer_version_id(scorer: dict[str, Any]) -> str | None:
    for key in ("default_version", "latest_version"):
        version = scorer.get(key)
        if isinstance(version, dict) and version.get("id"):
            return str(version["id"])
    value = scorer.get("default_version_id")
    return str(value) if value else None


def _scorer_key_values(scorer: dict[str, Any]) -> set[str]:
    values = {str(scorer.get("name") or ""), str(scorer.get("label") or "")}
    for key in ("required_scorers", "included_fields"):
        items = scorer.get(key)
        if isinstance(items, list):
            values.update(str(item) for item in items)
    return {_normalize_metric_name(item) for item in values if item}


def _metric_lookup_keys(metric_name: str) -> list[str]:
    try:
        from run_galileo_runtime_evidence_experiment import STANDARD_METRIC_ATTRS
    except ModuleNotFoundError:
        from scripts.run_galileo_runtime_evidence_experiment import STANDARD_METRIC_ATTRS

    normalized = _normalize_metric_name(metric_name)
    keys = [normalized]
    mapped = STANDARD_METRIC_ATTRS.get(normalized)
    if mapped:
        keys.append(_normalize_metric_name(mapped))
    return _ordered_unique(keys)


def resolve_scorers(
    session: requests.Session,
    *,
    api_base: str,
    api_key: str,
    auth_token: str | None = None,
    required: list[str],
    optional: list[str],
    timeout: float,
) -> tuple[list[dict[str, Any]], list[str]]:
    from galileo.scorers import Scorers

    # Use the SDK scorer listing because demo-v2 scorer REST response shape has
    # changed across releases while the generated SDK normalizes it.
    scorers = [scorer.to_dict() for scorer in Scorers().list()]
    by_metric: dict[str, dict[str, Any]] = {}
    for scorer in scorers:
        if not isinstance(scorer, dict):
            continue
        for key in _scorer_key_values(scorer):
            by_metric.setdefault(key, scorer)

    resolved: list[dict[str, Any]] = []
    missing_required: list[str] = []
    skipped_optional: list[str] = []
    for metric_name in required:
        scorer = next((by_metric[key] for key in _metric_lookup_keys(metric_name) if key in by_metric), None)
        if scorer is None:
            missing_required.append(metric_name)
            continue
        resolved.append(_resolved_scorer(metric_name, scorer, required=True))

    if missing_required:
        raise RuntimeError(f"required Galileo scorer(s) not found: {', '.join(sorted(missing_required))}")

    seen_ids = {item.get("id") for item in resolved}
    for metric_name in optional:
        scorer = next((by_metric[key] for key in _metric_lookup_keys(metric_name) if key in by_metric), None)
        if scorer is None:
            skipped_optional.append(metric_name)
            continue
        item = _resolved_scorer(metric_name, scorer, required=False)
        if item.get("id") not in seen_ids:
            resolved.append(item)
            seen_ids.add(item.get("id"))

    return resolved, skipped_optional


def _resolved_scorer(metric_name: str, scorer: dict[str, Any], *, required: bool) -> dict[str, Any]:
    return {
        "metric": metric_name,
        "id": scorer.get("id"),
        "name": scorer.get("name"),
        "label": scorer.get("label"),
        "scorer_type": scorer.get("scorer_type"),
        "model_type": scorer.get("model_type"),
        "version_id": _scorer_version_id(scorer),
        "required": required,
    }


def playground_patch_payload(plan: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": plan["playground_name"],
        "description": plan.get("playground_description"),
        "project_id": plan["project_id"],
        "dataset": {
            "id": plan["dataset"]["id"],
            "name": plan["dataset"]["name"],
            "version_index": plan["dataset"]["version_index"],
        },
        "prompt": {
            "id": plan["prompt"]["id"],
            "version": plan["prompt"]["version"],
            "version_id": plan["prompt"]["version_id"],
            "source": plan["prompt"]["source"],
            "variables": plan["prompt"]["variables"],
        },
        "settings": plan["model_settings"],
        "scorers": [
            {
                "id": scorer["id"],
                "name": scorer.get("name"),
                "label": scorer.get("label"),
                "scorer_type": scorer.get("scorer_type") or "preset",
                "model_name": plan["model_settings"]["model_alias"],
                "num_judges": 1,
                "cot_enabled": False,
                "version_id": scorer.get("version_id"),
                "metric": scorer["metric"],
            }
            for scorer in plan["scorers"]["resolved"]
        ],
        "metadata": {
            "managed_by": "defenseclaw",
            "manifest": str(DEFAULT_MANIFEST.relative_to(REPO_ROOT)),
            "dataset_rows": plan["dataset"]["rows"],
        },
    }


def playground_prompt_patch_payload(plan: dict[str, Any]) -> dict[str, Any]:
    return {
        "base_prompt_template_version_id": plan["prompt"]["version_id"],
        "template": plan["prompt"]["template"],
        "settings": plan["model_settings"],
        "raw": False,
    }


def _playground_path(project_id: str, playground_id: str) -> tuple[str, str]:
    return _unversioned_and_v2(f"/projects/{project_id}/playgrounds/{playground_id}")


def _legacy_playground_path(playground_id: str) -> tuple[str, str]:
    return _unversioned_and_v2(f"/playgrounds/{playground_id}")


def _playground_prompt_path(project_id: str, playground_id: str, prompt_id: str) -> tuple[str, str]:
    return _unversioned_and_v2(f"/projects/{project_id}/playgrounds/{playground_id}/prompts/{prompt_id}")


def patch_saved_playground(
    session: requests.Session,
    *,
    api_base: str,
    api_key: str,
    auth_token: str | None = None,
    timeout: float,
    plan: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], str]:
    patch = playground_patch_payload(plan)
    paths = (
        *_playground_path(str(plan["project_id"]), str(plan["playground_id"])),
        *_legacy_playground_path(str(plan["playground_id"])),
    )
    updated, path = _request_json_any(
        session,
        "PATCH",
        api_base,
        paths,
        api_key=api_key,
        auth_token=auth_token,
        timeout=timeout,
        json_body=patch,
    )
    return updated, patch, path


def patch_saved_playground_prompt(
    session: requests.Session,
    *,
    api_base: str,
    api_key: str,
    auth_token: str | None = None,
    timeout: float,
    plan: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], str]:
    patch = playground_prompt_patch_payload(plan)
    updated, path = _request_json_any(
        session,
        "PATCH",
        api_base,
        _playground_prompt_path(
            str(plan["project_id"]),
            str(plan["playground_id"]),
            str(plan["playground_prompt_id"]),
        ),
        api_key=api_key,
        auth_token=auth_token,
        timeout=timeout,
        json_body=patch,
    )
    return updated, patch, path


def execute_saved_playground_config(
    manifest: dict[str, Any],
    *,
    api_key: str,
    timeout: float = 20.0,
    playground_id: str = SAVED_PLAYGROUND_ID,
    playground_prompt_id: str = SAVED_PLAYGROUND_PROMPT_ID,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    session = session or requests.Session()
    initial_plan = build_plan(manifest, playground_id=playground_id, playground_prompt_id=playground_prompt_id)
    api_base = str(initial_plan["api_url"])
    try:
        auth_token = galileo_auth_token(
            api_key,
            api_base,
            str(initial_plan.get("console_url") or ""),
            str(initial_plan["project_id"]),
        )
    except Exception as exc:
        raise ConfigureSkipped("galileo_auth_unavailable", str(exc).replace(api_key, "<redacted>")) from exc
    dataset_cfg = initial_plan["dataset"]
    score_cfg = initial_plan["scorers"]
    version_index = latest_dataset_version_index(
        session,
        api_base=api_base,
        api_key=api_key,
        auth_token=auth_token,
        dataset_id=str(dataset_cfg["id"]),
        timeout=timeout,
    )
    resolved_scorers, skipped_optional = resolve_scorers(
        session,
        api_base=api_base,
        api_key=api_key,
        auth_token=auth_token,
        required=list(score_cfg["required"]),
        optional=list(score_cfg["optional"]),
        timeout=timeout,
    )
    plan = build_plan(
        manifest,
        playground_id=playground_id,
        playground_prompt_id=playground_prompt_id,
        dataset_version_index=version_index,
        resolved_scorers=resolved_scorers,
    )
    updated, patch, playground_endpoint = patch_saved_playground(
        session,
        api_base=api_base,
        api_key=api_key,
        auth_token=auth_token,
        timeout=timeout,
        plan=plan,
    )
    prompt_updated, prompt_patch, prompt_endpoint = patch_saved_playground_prompt(
        session,
        api_base=api_base,
        api_key=api_key,
        auth_token=auth_token,
        timeout=timeout,
        plan=plan,
    )
    return {
        "ok": True,
        "status": "updated",
        "dry_run": False,
        "created_at_utc": _utc_now(),
        "playground_id": playground_id,
        "plan": plan,
        "patch": patch,
        "prompt_patch": prompt_patch,
        "updated": updated,
        "prompt_updated": prompt_updated,
        "endpoints": {
            "playground": playground_endpoint,
            "playground_prompt": prompt_endpoint,
        },
        "skipped_optional_scorers": skipped_optional,
    }


def skipped_artifact(reason: str, *, detail: str = "", dry_run: bool = False) -> dict[str, Any]:
    artifact = {
        "ok": False,
        "status": "skipped",
        "dry_run": dry_run,
        "created_at_utc": _utc_now(),
        "reason": reason,
    }
    if detail:
        env_key = os.environ.get("GALILEO_API_KEY", "")
        artifact["detail"] = detail.replace(env_key, "<redacted>") if env_key else detail
    return artifact


def _read_key_file(path: Path | None) -> str | None:
    if path is None:
        return None
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise SystemExit(f"failed to read Galileo API key file: {exc}") from exc


def read_k8s_galileo_api_key(
    *,
    namespace: str = DEFAULT_K8S_SECRET_NAMESPACE,
    secret_name: str = DEFAULT_K8S_SECRET_NAME,
    key: str = DEFAULT_K8S_SECRET_KEY,
    timeout: float = 20.0,
) -> str:
    jsonpath = "{.data." + key + "}"
    try:
        result = subprocess.run(
            ["kubectl", "-n", namespace, "get", "secret", secret_name, "-o", f"jsonpath={jsonpath}"],
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise TokenUnavailable(
            f"unable to read Kubernetes secret {namespace}/{secret_name}:{key}; run duo-sso and retry"
        ) from exc
    encoded = result.stdout.strip()
    if not encoded:
        raise TokenUnavailable(f"Kubernetes secret {namespace}/{secret_name}:{key} is empty")
    try:
        return base64.b64decode(encoded).decode("utf-8").strip()
    except (ValueError, UnicodeDecodeError) as exc:
        raise TokenUnavailable(f"Kubernetes secret {namespace}/{secret_name}:{key} is not valid base64") from exc


def _select_api_key(args: argparse.Namespace) -> tuple[str | None, str | None, str]:
    file_key = _read_key_file(args.galileo_api_key_file)
    if file_key:
        return file_key, "file", ""
    env_key = os.environ.get("GALILEO_API_KEY")
    if env_key:
        return env_key, "env", ""
    if getattr(args, "use_k8s_secret", False):
        try:
            return (
                read_k8s_galileo_api_key(
                    namespace=args.k8s_secret_namespace,
                    secret_name=args.k8s_secret_name,
                    key=args.k8s_secret_key,
                    timeout=args.timeout,
                ),
                "kubernetes_secret",
                "",
            )
        except TokenUnavailable as exc:
            return None, None, str(exc)
    return None, None, ""


def run(args: argparse.Namespace) -> dict[str, Any]:
    manifest = load_manifest(args.manifest)
    dry_run = bool(args.dry_run or not args.execute)
    if dry_run:
        return {
            "ok": True,
            "status": "planned",
            "dry_run": True,
            "created_at_utc": _utc_now(),
            "plan": build_plan(
                manifest,
                playground_id=args.playground_id,
                playground_prompt_id=args.playground_prompt_id,
            ),
        }

    api_key, api_key_source, token_detail = _select_api_key(args)
    if not api_key:
        if args.allow_token_missing:
            return skipped_artifact("missing_galileo_api_key", detail=token_detail)
        message = "GALILEO_API_KEY, --galileo-api-key-file, or --use-k8s-secret is required when --execute is set"
        if token_detail:
            message = f"{message}: {token_detail}"
        raise SystemExit(message)

    try:
        result = execute_saved_playground_config(
            manifest,
            api_key=api_key,
            timeout=args.timeout,
            playground_id=args.playground_id,
            playground_prompt_id=args.playground_prompt_id,
        )
        result["api_key_source"] = api_key_source
        return result
    except ConfigureSkipped as exc:
        artifact = skipped_artifact(exc.reason, detail=exc.detail)
        artifact["api_key_source"] = api_key_source
        return artifact


def main() -> int:
    parser = argparse.ArgumentParser(description="Patch the saved Galileo demo-v2 enterprise Playground.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Print the intended Playground patch without API calls.")
    mode.add_argument("--execute", action="store_true", help="Patch the saved Playground through the Galileo API.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--playground-id", default=SAVED_PLAYGROUND_ID)
    parser.add_argument("--playground-prompt-id", default=SAVED_PLAYGROUND_PROMPT_ID)
    parser.add_argument("--galileo-api-key-file", type=Path, default=None)
    parser.add_argument(
        "--use-k8s-secret",
        action="store_true",
        help="Read the API key from the live lab Kubernetes secret.",
    )
    parser.add_argument("--k8s-secret-namespace", default=DEFAULT_K8S_SECRET_NAMESPACE)
    parser.add_argument("--k8s-secret-name", default=DEFAULT_K8S_SECRET_NAME)
    parser.add_argument("--k8s-secret-key", default=DEFAULT_K8S_SECRET_KEY)
    parser.add_argument("--allow-token-missing", action="store_true")
    parser.add_argument("--timeout", type=float, default=20.0)
    args = parser.parse_args()
    payload = run(args)
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
