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
import json
import os
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATASET_DIR = REPO_ROOT / "datasets" / "galileo"
DEFAULT_PROMPT_FILE = REPO_ROOT / "prompts" / "galileo" / "defenseclaw-runtime-governance.md"
DEFAULT_PROMPT_NAME = "defenseclaw-runtime-governance"
DEFAULT_AGENT_FLOW_PROMPT_FILE = REPO_ROOT / "prompts" / "galileo" / "enterprise-ops-agent-flow.md"
DEFAULT_AGENT_FLOW_PROMPT_NAME = "defenseclaw-enterprise-ops-agent-flow"


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            text = line.strip()
            if not text:
                continue
            try:
                row = json.loads(text)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_no}: invalid JSON: {exc}") from exc
            if not isinstance(row, dict):
                raise ValueError(f"{path}:{line_no}: row must be a JSON object")
            rows.append(row)
    if not rows:
        raise ValueError(f"{path}: no rows found")
    return rows


def _dataset_name(path: Path, prefix: str) -> str:
    stem = path.stem.replace("_", "-")
    return f"{prefix}{stem}"


def _load_galileo():
    try:
        _patch_galileo_permission_enum()
        from galileo.datasets import create_dataset, get_dataset
        from galileo.prompts import create_prompt, get_prompt, get_prompts
    except ImportError as exc:
        raise SystemExit(
            "Galileo SDK is not installed. Install it in a temporary venv with "
            "`python3 -m pip install galileo` and rerun this script."
        ) from exc
    return create_dataset, get_dataset, create_prompt, get_prompt, get_prompts


def _ensure_project(name: str | None) -> dict[str, Any] | None:
    if not name:
        return None
    _patch_galileo_permission_enum()
    from galileo.projects import create_project, get_project

    project = get_project(name=name)
    status = "exists"
    if project is None:
        project = create_project(name=name)
        status = "created"
    return {
        "name": getattr(project, "name", name),
        "id": getattr(project, "id", None),
        "status": status,
    }


def _ensure_log_stream(
    name: str | None,
    *,
    project_id: str | None,
    project_name: str | None,
) -> dict[str, Any] | None:
    if not name:
        return None
    _patch_galileo_permission_enum()
    from galileo.log_streams import create_log_stream, get_log_stream

    project_kwargs = _project_kwargs(project_id, project_name)
    if not project_kwargs:
        raise SystemExit("--log-stream-name requires --project-id, --project-name, or --ensure-project")
    stream = get_log_stream(name=name, **project_kwargs)
    status = "exists"
    if stream is None:
        stream = create_log_stream(name=name, **project_kwargs)
        status = "created"
    return {
        "name": getattr(stream, "name", name),
        "id": getattr(stream, "id", None),
        "project_id": getattr(stream, "project_id", project_id),
        "status": status,
    }


def _normalize_rows_for_galileo(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        if "ground_truth" in item and "output" not in item:
            item["output"] = item.pop("ground_truth")
        normalized.append(item)
    return normalized


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


def _create_prompt_version(template_id: str, template: str) -> tuple[str | None, int | None]:
    _patch_galileo_permission_enum()
    from galileo.config import GalileoPythonConfig
    from galileo.resources.api.prompts import (
        create_global_prompt_template_version_templates_template_id_versions_post,
        set_selected_global_template_version_templates_template_id_versions_version_put,
    )
    from galileo.resources.models import BasePromptTemplateVersion, HTTPValidationError

    config = GalileoPythonConfig.get()
    body = BasePromptTemplateVersion(template=template)
    response = create_global_prompt_template_version_templates_template_id_versions_post.sync(
        template_id=template_id,
        client=config.api_client,
        body=body,
    )
    if response is None or isinstance(response, HTTPValidationError):
        raise RuntimeError(f"failed to create prompt version for {template_id}")
    set_selected_global_template_version_templates_template_id_versions_version_put.sync(
        template_id=template_id,
        version=response.version,
        client=config.api_client,
    )
    return response.id, response.version


def _project_kwargs(project_id: str | None, project_name: str | None) -> dict[str, str]:
    if project_id:
        return {"project_id": project_id}
    if project_name:
        return {"project_name": project_name}
    return {}


def _get_existing_dataset(get_dataset, name: str, project_kwargs: dict[str, str]):
    try:
        return get_dataset(name=name, **project_kwargs)
    except Exception:
        return None


def _get_existing_prompt(
    get_prompt,
    get_prompts,
    name: str,
    project_kwargs: dict[str, str],
):
    try:
        if project_kwargs:
            prompts = get_prompts(name_filter=name, **project_kwargs)
            exact = [prompt for prompt in prompts if getattr(prompt, "name", None) == name]
            return exact[0] if exact else None
        return get_prompt(name=name)
    except Exception:
        return None


def _dataset_content_state(dataset_id: str) -> tuple[list[str], str | None]:
    _patch_galileo_permission_enum()
    from galileo.config import GalileoPythonConfig
    from galileo.resources.api.datasets import get_dataset_content_datasets_dataset_id_content_get

    config = GalileoPythonConfig.get()
    row_ids: list[str] = []
    etag: str | None = None
    starting_token = 0
    while True:
        response = get_dataset_content_datasets_dataset_id_content_get.sync_detailed(
            dataset_id=dataset_id,
            client=config.api_client,
            starting_token=starting_token,
            limit=100,
        )
        if etag is None:
            etag = response.headers.get("etag")
        content = response.parsed
        rows = getattr(content, "rows", None) or []
        row_ids.extend(str(row.row_id) for row in rows)
        next_token = getattr(content, "next_starting_token", None)
        if next_token is None or next_token == starting_token:
            break
        starting_token = int(next_token)
    return row_ids, etag


def _replace_dataset_content(dataset_id: str, rows: list[dict[str, Any]]) -> None:
    _patch_galileo_permission_enum()
    from galileo.config import GalileoPythonConfig
    from galileo.resources.api.datasets import update_dataset_content_datasets_dataset_id_content_patch
    from galileo.resources.models import (
        DatasetAppendRow,
        DatasetAppendRowValues,
        DatasetDeleteRow,
        HTTPValidationError,
        UpdateDatasetContentRequest,
    )

    row_ids, etag = _dataset_content_state(dataset_id)
    edits: list[Any] = [DatasetDeleteRow(row_id=row_id) for row_id in row_ids]
    for row in _normalize_rows_for_galileo(rows):
        values = DatasetAppendRowValues()
        values.additional_properties.update(row)
        edits.append(DatasetAppendRow(values=values))

    response = update_dataset_content_datasets_dataset_id_content_patch.sync(
        dataset_id=dataset_id,
        client=GalileoPythonConfig.get().api_client,
        body=UpdateDatasetContentRequest(edits=edits),
        if_match=etag,
    )
    if isinstance(response, HTTPValidationError):
        raise RuntimeError(f"failed to update dataset content: {response.to_dict()}")


def upload_datasets(
    dataset_dir: Path,
    prefix: str,
    skip_existing: bool,
    update_existing: bool,
    project_id: str | None,
    project_name: str | None,
) -> list[dict[str, Any]]:
    if not os.environ.get("GALILEO_API_KEY"):
        raise SystemExit("GALILEO_API_KEY is required")

    create_dataset, get_dataset, _, _, _ = _load_galileo()
    project_kwargs = _project_kwargs(project_id, project_name)
    paths = sorted(dataset_dir.glob("*.jsonl"))
    if not paths:
        raise SystemExit(f"No JSONL datasets found in {dataset_dir}")

    results: list[dict[str, Any]] = []
    for path in paths:
        name = _dataset_name(path, prefix)
        rows = _load_jsonl(path)
        existing = _get_existing_dataset(get_dataset, name, project_kwargs)
        if existing is not None and update_existing:
            _replace_dataset_content(str(existing.id), rows)
            results.append(
                {
                    "name": name,
                    "source": str(path.relative_to(REPO_ROOT)),
                    "rows": len(rows),
                    "status": "updated",
                    "id": getattr(existing, "id", None),
                }
            )
            continue
        if existing is not None and skip_existing:
            results.append(
                {
                    "name": name,
                    "source": str(path.relative_to(REPO_ROOT)),
                    "rows": len(rows),
                    "status": "exists",
                    "id": getattr(existing, "id", None),
                }
            )
            continue

        dataset = create_dataset(name=name, content=_normalize_rows_for_galileo(rows), **project_kwargs)
        results.append(
            {
                "name": name,
                "source": str(path.relative_to(REPO_ROOT)),
                "rows": len(rows),
                "status": "created",
                "id": getattr(dataset, "id", None),
            }
        )
    return results


def upload_prompt(
    prompt_file: Path,
    prompt_name: str,
    skip_existing: bool,
    project_id: str | None,
    project_name: str | None,
) -> dict[str, Any]:
    if not os.environ.get("GALILEO_API_KEY"):
        raise SystemExit("GALILEO_API_KEY is required")
    _, _, create_prompt, get_prompt, get_prompts = _load_galileo()
    project_kwargs = _project_kwargs(project_id, project_name)
    template = prompt_file.read_text(encoding="utf-8")
    existing = _get_existing_prompt(get_prompt, get_prompts, prompt_name, project_kwargs)
    if existing is not None and skip_existing:
        if getattr(existing, "template", None) != template:
            version_id, version = _create_prompt_version(existing.id, template)
            return {
                "name": prompt_name,
                "source": str(prompt_file.relative_to(REPO_ROOT)),
                "status": "updated",
                "id": getattr(existing, "id", None),
                "version": version,
                "version_id": version_id,
            }
        return {
            "name": prompt_name,
            "source": str(prompt_file.relative_to(REPO_ROOT)),
            "status": "exists",
            "id": getattr(existing, "id", None),
        }
    prompt = create_prompt(name=prompt_name, template=template, **project_kwargs)
    return {
        "name": prompt_name,
        "source": str(prompt_file.relative_to(REPO_ROOT)),
        "status": "created",
        "id": getattr(prompt, "id", None),
    }


def _parse_extra_prompt(value: str) -> tuple[str, Path]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("extra prompts must use NAME=PATH")
    name, path = value.split("=", 1)
    if not name.strip():
        raise argparse.ArgumentTypeError("extra prompt name must not be empty")
    return name.strip(), Path(path).expanduser()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Upload DefenseClaw demo datasets and prompt to Galileo.")
    parser.add_argument("--dataset-dir", type=Path, default=DEFAULT_DATASET_DIR)
    parser.add_argument("--prefix", default="", help="Optional dataset name prefix.")
    parser.add_argument("--prompt-file", type=Path, default=DEFAULT_PROMPT_FILE)
    parser.add_argument("--prompt-name", default=DEFAULT_PROMPT_NAME)
    parser.add_argument(
        "--extra-prompt",
        action="append",
        default=[],
        type=_parse_extra_prompt,
        help="Additional Galileo prompt to upload as NAME=PATH. Repeat for multiple prompts.",
    )
    parser.add_argument(
        "--include-agent-flow-prompt",
        action="store_true",
        help=f"Upload {DEFAULT_AGENT_FLOW_PROMPT_NAME} from prompts/galileo/enterprise-ops-agent-flow.md.",
    )
    parser.add_argument("--skip-prompt", action="store_true")
    parser.add_argument(
        "--ensure-project",
        default=None,
        help="Create the named Galileo project if it does not exist, then upload into it.",
    )
    parser.add_argument(
        "--log-stream-name",
        default=None,
        help="Create the named Galileo log stream in the target project if it does not exist.",
    )
    parser.add_argument("--project-id", default=os.environ.get("GALILEO_PROJECT_ID"))
    parser.add_argument("--project-name", default=os.environ.get("GALILEO_PROJECT"))
    parser.add_argument(
        "--create-duplicates",
        action="store_true",
        help="Create a new dataset even when a dataset with the same name already exists.",
    )
    parser.add_argument(
        "--update-existing-datasets",
        action="store_true",
        help="Replace content for existing datasets instead of skipping them.",
    )
    args = parser.parse_args(argv)

    if args.create_duplicates and args.update_existing_datasets:
        raise SystemExit("--create-duplicates and --update-existing-datasets are mutually exclusive")

    project = _ensure_project(args.ensure_project)
    project_id = args.project_id
    project_name = args.project_name
    if project is not None:
        project_id = str(project["id"]) if project["id"] else None
        project_name = str(project["name"]) if project["name"] else args.ensure_project

    log_stream = _ensure_log_stream(
        args.log_stream_name,
        project_id=project_id,
        project_name=None if project_id else project_name,
    )

    datasets = upload_datasets(
        args.dataset_dir,
        args.prefix,
        skip_existing=not args.create_duplicates,
        update_existing=args.update_existing_datasets,
        project_id=project_id,
        project_name=project_name,
    )
    payload: dict[str, Any] = {"datasets": datasets}
    if project is not None:
        payload["project"] = project
    if log_stream is not None:
        payload["log_stream"] = log_stream
    if not args.skip_prompt:
        prompts = [
            upload_prompt(
                args.prompt_file,
                args.prompt_name,
                skip_existing=not args.create_duplicates,
                project_id=project_id,
                project_name=project_name,
            )
        ]
        extra_prompts = list(args.extra_prompt)
        if args.include_agent_flow_prompt:
            extra_prompts.append((DEFAULT_AGENT_FLOW_PROMPT_NAME, DEFAULT_AGENT_FLOW_PROMPT_FILE))
        for prompt_name, prompt_file in extra_prompts:
            prompts.append(
                upload_prompt(
                    prompt_file.resolve(),
                    prompt_name,
                    skip_existing=not args.create_duplicates,
                    project_id=project_id,
                    project_name=project_name,
                )
            )
        payload["prompts"] = prompts
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
