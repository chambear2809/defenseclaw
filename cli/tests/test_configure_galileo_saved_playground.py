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
import importlib.util
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

import requests

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "configure_galileo_saved_playground.py"
spec = importlib.util.spec_from_file_location("configure_galileo_saved_playground", SCRIPT_PATH)
configure_playground = importlib.util.module_from_spec(spec)
sys.modules["configure_galileo_saved_playground"] = configure_playground
assert spec and spec.loader
spec.loader.exec_module(configure_playground)


class FakeResponse:
    def __init__(self, status_code: int, payload: dict | list | None = None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.ok = 200 <= status_code < 300
        self.text = json.dumps(self._payload)

    def json(self):
        return self._payload

    def raise_for_status(self):
        if not self.ok:
            raise requests.HTTPError(f"HTTP {self.status_code}", response=self)


class FakeSession:
    def __init__(self, responses: list[FakeResponse]):
        self.responses = responses
        self.calls: list[dict] = []

    def request(self, method, url, headers=None, json=None, timeout=None):
        self.calls.append({"method": method, "url": url, "headers": headers, "json": json, "timeout": timeout})
        if not self.responses:
            raise AssertionError(f"unexpected request: {method} {url}")
        return self.responses.pop(0)


def scorer(name: str, *, label: str | None = None):
    return {
        "id": f"{name}-id",
        "name": name,
        "label": label or name,
        "default_version": {"id": f"{name}-version", "version": 2, "scorer_id": f"{name}-id"},
    }


class ConfigureGalileoSavedPlaygroundTests(unittest.TestCase):
    def test_dry_run_uses_enterprise_manifest_without_key(self):
        manifest = configure_playground.load_manifest(configure_playground.DEFAULT_MANIFEST)
        plan = configure_playground.build_plan(manifest)

        self.assertEqual(plan["playground_id"], configure_playground.SAVED_PLAYGROUND_ID)
        self.assertEqual(plan["dataset"]["name"], configure_playground.ENTERPRISE_DATASET_NAME)
        self.assertEqual(plan["dataset"]["rows"], 16)
        self.assertIn("agent_flow", plan["scorers"]["required"])
        self.assertIn("action_completion", plan["scorers"]["required"])
        self.assertIn("correctness", plan["scorers"]["optional"])
        self.assertEqual(plan["model_settings"]["model_alias"], "gpt-4.1-nano")

    def test_execute_patches_saved_playground_with_latest_dataset_version_and_scorers(self):
        manifest = configure_playground.load_manifest(configure_playground.DEFAULT_MANIFEST)
        required = configure_playground.scorer_plan(configure_playground.enterprise_dataset(manifest))["required"]
        session = FakeSession(
            [
                FakeResponse(200, {"versions": [{"version_index": 3}, {"version_index": 5}]}),
                FakeResponse(200, {"scorers": [scorer(name) for name in [*required, "correctness", "output_pii"]]}),
                FakeResponse(200, {"id": configure_playground.SAVED_PLAYGROUND_ID, "updated": True}),
            ]
        )

        result = configure_playground.execute_saved_playground_config(
            manifest,
            api_key="secret-token",
            session=session,
            timeout=7,
        )

        self.assertTrue(result["ok"], result)
        self.assertEqual(result["plan"]["dataset"]["version_index"], 5)
        patch_call = session.calls[2]
        self.assertEqual(patch_call["method"], "PATCH")
        self.assertTrue(patch_call["url"].endswith(f"/v2/playgrounds/{configure_playground.SAVED_PLAYGROUND_ID}"))
        self.assertEqual(patch_call["headers"]["Galileo-API-Key"], "secret-token")
        patch_payload = patch_call["json"]
        self.assertEqual(patch_payload["dataset"]["version_index"], 5)
        self.assertEqual(
            patch_payload["prompt"]["version_id"],
            manifest["prompt"]["selected_version_id"],
        )
        self.assertEqual(patch_payload["settings"]["temperature"], 0.2)
        self.assertIn("output_pii", {item["metric"] for item in patch_payload["scorers"]})

    def test_missing_token_can_skip_without_api_call(self):
        args = argparse.Namespace(
            manifest=configure_playground.DEFAULT_MANIFEST,
            dry_run=False,
            execute=True,
            galileo_api_key_file=None,
            allow_token_missing=True,
            timeout=20.0,
            playground_id=configure_playground.SAVED_PLAYGROUND_ID,
        )
        with mock.patch.dict(os.environ, {}, clear=True):
            result = configure_playground.run(args)

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "skipped")
        self.assertEqual(result["reason"], "missing_galileo_api_key")

    def test_unauthorized_response_is_redacted_skip(self):
        manifest = configure_playground.load_manifest(configure_playground.DEFAULT_MANIFEST)
        session = FakeSession([FakeResponse(403, {"message": "forbidden for this key"})])

        with self.assertRaises(configure_playground.ConfigureSkipped) as ctx:
            configure_playground.execute_saved_playground_config(
                manifest,
                api_key="secret-token",
                session=session,
            )

        self.assertEqual(ctx.exception.reason, "galileo_auth_unavailable")
        self.assertNotIn("secret-token", ctx.exception.detail)

    def test_provider_quota_response_is_redacted_skip(self):
        manifest = configure_playground.load_manifest(configure_playground.DEFAULT_MANIFEST)
        required = configure_playground.scorer_plan(configure_playground.enterprise_dataset(manifest))["required"]
        session = FakeSession(
            [
                FakeResponse(200, {"versions": [{"version_index": 5}]}),
                FakeResponse(200, {"scorers": [scorer(name) for name in required]}),
                FakeResponse(429, {"message": "provider quota exceeded"}),
            ]
        )

        with self.assertRaises(configure_playground.ConfigureSkipped) as ctx:
            configure_playground.execute_saved_playground_config(
                manifest,
                api_key="secret-token",
                session=session,
            )

        self.assertEqual(ctx.exception.reason, "provider_quota_unavailable")


if __name__ == "__main__":
    unittest.main()
