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
import datetime as dt
import json
import os
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = REPO_ROOT / "playgrounds" / "galileo" / "defenseclaw-runtime-governance.playground.json"
SAME_AS_MODEL = "same-as-model"
DEFAULT_SCORER_JUDGES = 1

from run_galileo_runtime_evidence_experiment import (  # noqa: E402
    SESSION_ONLY_EXPERIMENT_METRICS,
    _resolve_galileo_metrics,
)


def _load_manifest(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        manifest = json.load(handle)
    if not isinstance(manifest.get("datasets"), list):
        raise ValueError(f"{path}: datasets must be a list")
    return manifest


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


def _select_datasets(manifest: dict[str, Any], names: list[str], include_all: bool) -> list[dict[str, Any]]:
    datasets = [item for item in manifest["datasets"] if isinstance(item, dict)]
    if include_all:
        return datasets
    wanted = set(names)
    if not wanted:
        return [item for item in datasets if item.get("name") == "defenseclaw-safe-ops"]
    selected = [item for item in datasets if item.get("name") in wanted]
    missing = sorted(wanted - {str(item.get("name")) for item in selected})
    if missing:
        raise ValueError(f"unknown dataset(s): {', '.join(missing)}")
    return selected


def _experiment_name(prefix: str, dataset_name: str) -> str:
    stamp = dt.datetime.now(dt.UTC).strftime("%Y%m%d-%H%M%S")
    return f"{prefix}-{dataset_name}-{stamp}"


def _metric_names(dataset_cfg: dict[str, Any], extra_metrics: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for metric in [*list(dataset_cfg.get("default_metrics") or []), *extra_metrics]:
        metric_name = str(metric).strip()
        if not metric_name or metric_name in SESSION_ONLY_EXPERIMENT_METRICS or metric_name in seen:
            continue
        seen.add(metric_name)
        out.append(metric_name)
    return out


def _plan(
    manifest: dict[str, Any],
    selected: list[dict[str, Any]],
    model_alias: str,
    extra_metrics: list[str],
) -> dict[str, Any]:
    return {
        "project_id": manifest["project"]["id"],
        "prompt": manifest["prompt"]["name"],
        "prompt_id": manifest["prompt"]["id"],
        "model_alias": model_alias,
        "datasets": [
            {
                "name": item["name"],
                "id": item["id"],
                "rows": item["rows"],
                "metrics": _metric_names(item, extra_metrics),
            }
            for item in selected
        ],
    }


def _model_catalog_aliases() -> set[str]:
    from galileo.config import GalileoPythonConfig
    from galileo.resources.api.llm_integrations import get_integrations_and_model_info_llm_integrations_get
    from galileo.resources.models.http_validation_error import HTTPValidationError

    response = get_integrations_and_model_info_llm_integrations_get.sync(client=GalileoPythonConfig.get().api_client)
    if response is None or isinstance(response, HTTPValidationError):
        return set()
    data = response.to_dict()
    aliases: set[str] = set()
    for integration_info in data.values():
        for alias in integration_info.get("models") or []:
            if isinstance(alias, str):
                aliases.add(alias)
        for model in integration_info.get("model_properties") or []:
            alias = model.get("alias") if isinstance(model, dict) else None
            if isinstance(alias, str):
                aliases.add(alias)
    return aliases


def _resolve_catalog_alias(model_alias: str) -> str:
    aliases = _model_catalog_aliases()
    if not aliases or model_alias in aliases:
        return model_alias

    candidates = [f"{model_alias} (custom)"]
    matches = [candidate for candidate in candidates if candidate in aliases]
    if len(matches) == 1:
        return matches[0]

    raise RuntimeError(
        f"model alias {model_alias!r} is not available in Galileo. "
        f"Available aliases include: {', '.join(sorted(aliases)[:20])}"
    )


def _scorer_configs(
    *,
    project_id: str,
    metric_names: list[str],
    scorer_model_alias: str | None,
    scorer_judges: int | None,
    scorer_cot: bool | None,
) -> list[Any]:
    from galileo.utils.metrics import create_metric_configs

    metric_refs = _resolve_galileo_metrics(metric_names, "standard")
    scorers, local_metrics = create_metric_configs(project_id, None, metric_refs)
    if local_metrics:
        raise RuntimeError("local metrics are not supported for Galileo prompt-template experiments")

    if scorer_model_alias:
        for scorer in scorers:
            scorer.model_name = scorer_model_alias
            if scorer_judges is not None:
                scorer.num_judges = scorer_judges
            if scorer_cot is not None:
                scorer.cot_enabled = scorer_cot
    return scorers


def _scorer_summary(scorers: list[Any]) -> list[dict[str, Any]]:
    def jsonable(value: Any) -> Any:
        if value is None or isinstance(value, str | int | float | bool):
            return value
        if value.__class__.__name__ == "Unset":
            return None
        return str(value)

    return [
        {
            "name": jsonable(getattr(scorer, "name", "")),
            "model_name": jsonable(getattr(scorer, "model_name", None)),
            "num_judges": jsonable(getattr(scorer, "num_judges", None)),
            "cot_enabled": jsonable(getattr(scorer, "cot_enabled", None)),
        }
        for scorer in scorers
    ]


def _run_experiment(
    manifest: dict[str, Any],
    dataset_cfg: dict[str, Any],
    model_alias: str,
    extra_metrics: list[str],
    scorer_model_alias: str | None,
    scorer_judges: int | None,
    scorer_cot: bool | None,
    experiment_prefix: str,
) -> dict[str, Any]:
    _patch_galileo_permission_enum()
    from galileo.datasets import get_dataset
    from galileo.experiment_tags import upsert_experiment_tag
    from galileo.experiments import Experiments
    from galileo.projects import get_project
    from galileo.prompts import get_prompt

    project_id = manifest["project"]["id"]
    project = get_project(id=project_id)
    prompt = get_prompt(id=manifest["prompt"]["id"])
    dataset = get_dataset(id=dataset_cfg["id"])
    if project is None:
        raise RuntimeError(f"project not found: {project_id}")
    if prompt is None:
        raise RuntimeError(f"prompt not found: {manifest['prompt']['id']}")
    if dataset is None:
        raise RuntimeError(f"dataset not found: {dataset_cfg['id']}")

    resolved_model_alias = _resolve_catalog_alias(model_alias)
    resolved_scorer_model_alias = (
        resolved_model_alias if scorer_model_alias == SAME_AS_MODEL else scorer_model_alias
    )
    if resolved_scorer_model_alias:
        resolved_scorer_model_alias = _resolve_catalog_alias(resolved_scorer_model_alias)

    settings = dict(manifest["model"]["settings"])
    settings["model_alias"] = resolved_model_alias
    metric_names = _metric_names(dataset_cfg, extra_metrics)
    scorers = _scorer_configs(
        project_id=project_id,
        metric_names=metric_names,
        scorer_model_alias=resolved_scorer_model_alias,
        scorer_judges=scorer_judges,
        scorer_cot=scorer_cot,
    )
    result = Experiments().run(
        project,
        dataset,
        _experiment_name(experiment_prefix, dataset_cfg["name"]),
        prompt,
        scorers,
        settings,
    )
    experiment = result.get("experiment") if isinstance(result, dict) else None
    if experiment is not None:
        tags = {
            "demo": "defenseclaw-runtime-governance",
            "dataset": str(dataset_cfg["name"]),
            "prompt_model": resolved_model_alias,
        }
        if resolved_scorer_model_alias:
            tags["scorer_model"] = resolved_scorer_model_alias
        if scorer_judges is not None:
            tags["scorer_judges"] = str(scorer_judges)
        for key, value in tags.items():
            try:
                upsert_experiment_tag(project_id, experiment.id, key, value)
            except Exception:
                pass
    return {
        "dataset": dataset_cfg["name"],
        "experiment_id": getattr(experiment, "id", None),
        "experiment_name": getattr(experiment, "name", None),
        "model_alias": resolved_model_alias,
        "scorers": _scorer_summary(scorers),
        "link": result.get("link") if isinstance(result, dict) else None,
        "message": result.get("message") if isinstance(result, dict) else str(result),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the DefenseClaw Galileo playground recipe as experiments.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--dataset", action="append", default=[], help="Dataset name. Repeat for multiple datasets.")
    parser.add_argument("--all", action="store_true", help="Run every dataset in the playground recipe.")
    parser.add_argument("--metric", action="append", default=[], help="Additional metric name. Repeat as needed.")
    parser.add_argument("--model-alias", default=None)
    parser.add_argument(
        "--scorer-model-alias",
        default=SAME_AS_MODEL,
        help=f"Model alias for Galileo LLM scorers. Use {SAME_AS_MODEL!r} or 'default'.",
    )
    parser.add_argument(
        "--scorer-judges",
        type=int,
        default=DEFAULT_SCORER_JUDGES,
        help="Number of judges for Galileo LLM scorers.",
    )
    parser.add_argument("--scorer-cot", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--experiment-prefix", default="defenseclaw-playground")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually start Galileo experiments. Defaults to dry-run.",
    )
    args = parser.parse_args()

    manifest = _load_manifest(args.manifest)
    model_alias = args.model_alias or manifest["model"]["default_alias"]
    scorer_model_alias = None if args.scorer_model_alias == "default" else args.scorer_model_alias
    selected = _select_datasets(manifest, args.dataset, args.all)
    plan = _plan(manifest, selected, model_alias, args.metric)
    plan["scorer_model_alias"] = scorer_model_alias
    plan["scorer_judges"] = args.scorer_judges
    plan["scorer_cot"] = args.scorer_cot
    if not args.execute:
        print(json.dumps({"dry_run": True, "plan": plan}, indent=2, sort_keys=True))
        return 0

    if not os.environ.get("GALILEO_API_KEY"):
        raise SystemExit("GALILEO_API_KEY is required when --execute is set")

    results: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for dataset_cfg in selected:
        try:
            results.append(
                _run_experiment(
                    manifest,
                    dataset_cfg,
                    model_alias,
                    args.metric,
                    scorer_model_alias,
                    args.scorer_judges,
                    args.scorer_cot,
                    args.experiment_prefix,
                )
            )
        except Exception as exc:
            errors.append(
                {
                    "dataset": str(dataset_cfg["name"]),
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                }
            )
    payload: dict[str, Any] = {"dry_run": False, "plan": plan, "experiments": results}
    if errors:
        payload["errors"] = errors
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
