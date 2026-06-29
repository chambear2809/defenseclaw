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
from pathlib import Path
import re
import subprocess
from typing import Any

import requests

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = REPO_ROOT / "playgrounds" / "galileo" / "defenseclaw-runtime-governance.playground.json"
DEFAULT_DATASET_DIR = REPO_ROOT / "datasets" / "galileo"
DEFAULT_PROMPT = REPO_ROOT / "prompts" / "galileo" / "defenseclaw-runtime-governance.md"
DEFAULT_DATASET = "defenseclaw-safe-ops"
DEFAULT_ENDPOINT = "https://openclaw.rosa.fso-tme.eoha.p3.openshiftapps.com/v1"
DEFAULT_MODEL = "gpt-4o-mini"
DEFAULT_K8S_NAMESPACE = "defenseclaw"
DEFAULT_GALILEO_SECRET = "defenseclaw-secrets"
DEFAULT_GALILEO_SECRET_KEY = "GALILEO_DEMO_V2_API_KEY"
DEFAULT_BRIDGEIT_SECRET = "openclaw-secrets"
DEFAULT_BRIDGEIT_SECRET_KEY = "BRIDGEIT_PROXY_API_KEY"

VARIABLE_RE = re.compile(r"{{\s*([a-zA-Z0-9_]+)\s*}}")


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


def _utc_stamp() -> str:
    return dt.datetime.now(dt.UTC).strftime("%Y%m%d-%H%M%S")


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


def dataset_config(manifest: dict[str, Any], name: str) -> dict[str, Any]:
    for item in manifest.get("datasets") or []:
        if isinstance(item, dict) and item.get("name") == name:
            return item
    raise ValueError(f"unknown dataset: {name}")


def load_dataset_rows(dataset_name: str, max_rows: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    path = DEFAULT_DATASET_DIR / f"{dataset_name}.jsonl"
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if max_rows > 0 and len(rows) >= max_rows:
                break
            rows.append(json.loads(line))
    return rows


def render_prompt(template: str, row_input: dict[str, Any]) -> str:
    def replace(match: re.Match[str]) -> str:
        value = row_input.get(match.group(1), "")
        if isinstance(value, str):
            return value
        return json.dumps(value, sort_keys=True)

    return VARIABLE_RE.sub(replace, template)


def string_metadata(metadata: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in metadata.items():
        out[key] = value if isinstance(value, str) else json.dumps(value, sort_keys=True)
    return out


def bridgeit_chat(
    *,
    endpoint: str,
    bridgeit_proxy_key: str,
    model: str,
    prompt: str,
    max_tokens: int,
    temperature: float,
    timeout: float,
) -> tuple[str, dict[str, Any]]:
    response = requests.post(
        endpoint.rstrip("/") + "/chat/completions",
        headers={
            "Authorization": f"Bearer {bridgeit_proxy_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": temperature,
        },
        timeout=timeout,
    )
    payload = response.json() if response.text else {}
    if not response.ok:
        raise RuntimeError(f"BridgeIT proxy HTTP {response.status_code}: {json.dumps(payload)[:500]}")
    content = payload["choices"][0]["message"]["content"]
    return str(content), {
        "id": payload.get("id"),
        "model": payload.get("model"),
        "usage": payload.get("usage"),
    }


def build_generated_rows(args: argparse.Namespace, bridgeit_proxy_key: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    prompt_template = args.prompt.read_text(encoding="utf-8")
    source_rows = load_dataset_rows(args.dataset, args.max_rows)
    generated_rows: list[dict[str, Any]] = []
    bridgeit_calls: list[dict[str, Any]] = []
    for idx, row in enumerate(source_rows):
        row_input = row["input"]
        rendered = render_prompt(prompt_template, row_input)
        output, metadata = bridgeit_chat(
            endpoint=args.endpoint,
            bridgeit_proxy_key=bridgeit_proxy_key,
            model=args.model,
            prompt=rendered,
            max_tokens=args.max_tokens,
            temperature=args.temperature,
            timeout=args.timeout,
        )
        generated_rows.append(
            {
                "input": row_input,
                "generated_output": output,
                "ground_truth": row.get("ground_truth"),
                "metadata": string_metadata({
                    **(row.get("metadata") or {}),
                    "bridgeit_model": metadata.get("model") or args.model,
                    "bridgeit_proxy_endpoint": args.endpoint,
                    "source_dataset": args.dataset,
                    "source_row_index": idx,
                }),
            }
        )
        bridgeit_calls.append(
            {
                "row_index": idx,
                "bridgeit_response_id": metadata.get("id"),
                "bridgeit_model": metadata.get("model"),
                "usage": metadata.get("usage"),
                "output_preview": output[:240],
            }
        )
    return generated_rows, bridgeit_calls


def run_experiment(args: argparse.Namespace, generated_rows: list[dict[str, Any]], galileo_key: str) -> dict[str, Any]:
    manifest = load_manifest(args.manifest)
    project = manifest["project"]
    os.environ["GALILEO_API_KEY"] = galileo_key
    os.environ["GALILEO_API_URL"] = args.api_url or project.get("api_url") or "https://api.galileo.ai"
    os.environ["GALILEO_CONSOLE_URL"] = args.console_url or project.get("console_url") or "https://app.galileo.ai"
    _patch_galileo_permission_enum()
    from galileo.experiments import run_experiment as galileo_run_experiment

    records: list[dict[str, Any]] = []
    outputs_by_input: dict[str, str] = {}
    for row in generated_rows:
        input_key = json.dumps(row["input"], sort_keys=True)
        outputs_by_input[input_key] = str(row["generated_output"])
        records.append(
            {
                "input": row["input"],
                "ground_truth": row.get("ground_truth"),
                "metadata": row.get("metadata") or {},
            }
        )

    def bridgeit_generated_output(row_input: dict[str, Any]) -> str:
        return outputs_by_input[json.dumps(row_input, sort_keys=True)]

    result = galileo_run_experiment(
        f"{args.experiment_prefix}-{args.dataset}-{_utc_stamp()}",
        project_id=args.project_id or project["id"],
        dataset=records,
        function=bridgeit_generated_output,
        metrics=args.metric or None,
        experiment_tags={
            "demo": "defenseclaw-runtime-governance",
            "runner": "bridgeit-proxy-local-function",
            "dataset": args.dataset,
            "model": args.model,
        },
    )
    experiment = result.get("experiment") if isinstance(result, dict) else None
    return {
        "experiment_id": getattr(experiment, "id", None),
        "experiment_name": getattr(experiment, "name", None),
        "link": result.get("link") if isinstance(result, dict) else None,
        "message": result.get("message") if isinstance(result, dict) else str(result),
    }


def execute(args: argparse.Namespace) -> dict[str, Any]:
    manifest = load_manifest(args.manifest)
    cfg = dataset_config(manifest, args.dataset)
    plan = {
        "project_id": args.project_id or manifest["project"]["id"],
        "dataset": {"name": cfg["name"], "id": cfg["id"], "max_rows": args.max_rows},
        "endpoint": args.endpoint,
        "model": args.model,
        "metrics": args.metric or [],
    }
    if args.dry_run or not args.execute:
        return {"dry_run": True, "plan": plan}

    bridgeit_key, bridgeit_source = resolve_secret(
        env_name="BRIDGEIT_PROXY_API_KEY",
        use_k8s_secret=args.use_k8s_secret,
        namespace=args.k8s_namespace,
        secret_name=args.bridgeit_secret_name,
        secret_key=args.bridgeit_secret_key,
        timeout=args.timeout,
    )
    galileo_key, galileo_source = resolve_secret(
        env_name="GALILEO_API_KEY",
        use_k8s_secret=args.use_k8s_secret,
        namespace=args.k8s_namespace,
        secret_name=args.galileo_secret_name,
        secret_key=args.galileo_secret_key,
        timeout=args.timeout,
    )
    generated_rows, bridgeit_calls = build_generated_rows(args, bridgeit_key)
    experiment = run_experiment(args, generated_rows, galileo_key)
    return {
        "dry_run": False,
        "ok": True,
        "plan": plan,
        "row_count": len(generated_rows),
        "bridgeit_calls": bridgeit_calls,
        "experiment": experiment,
        "bridgeit_key_source": bridgeit_source,
        "galileo_key_source": galileo_source,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a Galileo generated-output experiment using BridgeIT proxy output.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--execute", action="store_true")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--prompt", type=Path, default=DEFAULT_PROMPT)
    parser.add_argument("--dataset", default=DEFAULT_DATASET)
    parser.add_argument("--max-rows", type=int, default=1)
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--max-tokens", type=int, default=350)
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--metric", action="append", default=[])
    parser.add_argument("--experiment-prefix", default="defenseclaw-bridgeit-generated-output")
    parser.add_argument("--project-id", default=None)
    parser.add_argument("--api-url", default=None)
    parser.add_argument("--console-url", default=None)
    parser.add_argument("--use-k8s-secret", action="store_true")
    parser.add_argument("--k8s-namespace", default=DEFAULT_K8S_NAMESPACE)
    parser.add_argument("--galileo-secret-name", default=DEFAULT_GALILEO_SECRET)
    parser.add_argument("--galileo-secret-key", default=DEFAULT_GALILEO_SECRET_KEY)
    parser.add_argument("--bridgeit-secret-name", default=DEFAULT_BRIDGEIT_SECRET)
    parser.add_argument("--bridgeit-secret-key", default=DEFAULT_BRIDGEIT_SECRET_KEY)
    parser.add_argument("--timeout", type=float, default=60.0)
    args = parser.parse_args()
    print(json.dumps(execute(args), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
