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
from pathlib import Path

import click

from defenseclaw.enterprise_ops_demo import (
    TEASTORE_INTERNAL_URL,
    TEASTORE_PUBLIC_URL,
    THOUSANDEYES_API_BASE,
    build_autonomy_slo_report,
    build_report,
    build_teastore_o11y_mcp_evidence,
    derive_autonomy_slo_evidence,
    default_workflow,
    log_live_galileo_session,
    render_control_room,
    render_markdown,
    report_to_json,
    run_live_inspect,
    run_splunk_o11y_detector_poll,
    run_thousandeyes_live_checks,
    validate_workflow,
)
from defenseclaw.enterprise_ops_demo import (
    execute_thousandeyes_create as execute_thousandeyes_create_test,
)


@click.group(name="demo")
def demo() -> None:
    """Build and validate curated DefenseClaw demo workflows."""


@demo.command("enterprise-ops")
@click.option(
    "--format",
    "output_format",
    type=click.Choice(["markdown", "json", "control-room"]),
    default="markdown",
    show_default=True,
)
@click.option("--output", type=click.Path(path_type=Path), default=None, help="Write the report to a file.")
@click.option(
    "--live-inspect",
    is_flag=True,
    help="POST inspect-only requests to a running DefenseClaw API. This does not execute tools.",
)
@click.option("--api-base", default="http://127.0.0.1:18970", show_default=True)
@click.option("--token-env", default="OPENCLAW_GATEWAY_TOKEN", show_default=True)
@click.option("--timeout", default=10.0, show_default=True, type=float)
@click.option(
    "--live-thousandeyes",
    is_flag=True,
    help="Run read-only ThousandEyes API readiness checks using --thousandeyes-token-env.",
)
@click.option("--thousandeyes-api-base", default=THOUSANDEYES_API_BASE, show_default=True)
@click.option("--thousandeyes-token-env", default="THOUSANDEYES_TOKEN", show_default=True)
@click.option(
    "--live-o11y-mcp",
    is_flag=True,
    help="Collect read-only Splunk O11y MCP-shaped incident evidence for TeaStore.",
)
@click.option("--ticket-id", default="INC-TEASTORE-001", show_default=True)
@click.option("--service-name", default="teastore-webui", show_default=True)
@click.option("--target-url", default=TEASTORE_INTERNAL_URL, show_default=True)
@click.option("--o11y-probe-url", default=TEASTORE_PUBLIC_URL, show_default=True)
@click.option("--o11y-latency-threshold-ms", default=1000.0, show_default=True, type=float)
@click.option(
    "--live-o11y-detectors",
    is_flag=True,
    help="Poll read-only Splunk O11y detectors related to TeaStore.",
)
@click.option("--o11y-realm", default="us1", show_default=True)
@click.option("--o11y-token-env", default="SPLUNK_O11Y_TOKEN", show_default=True)
@click.option("--o11y-detector-query", default="teastore", show_default=True)
@click.option(
    "--o11y-detector-tag",
    multiple=True,
    default=(),
    help="Detector tag to match. Repeat for multiple tags. Defaults to teastore when omitted.",
)
@click.option("--o11y-detector-poll-attempts", default=1, show_default=True, type=int)
@click.option("--o11y-detector-poll-interval", default=5.0, show_default=True, type=float)
@click.option("--o11y-detector-limit", default=100, show_default=True, type=int)
@click.option(
    "--execute-thousandeyes-create",
    "execute_te_create",
    is_flag=True,
    help="After live inspect and explicit approval, create or reuse the TeaStore ThousandEyes HTTP test.",
)
@click.option("--approved", is_flag=True, help="Explicit operator approval for the TE test create executor.")
@click.option("--thousandeyes-agent-id", default=None, help="Specific ThousandEyes Enterprise Agent ID to use.")
@click.option("--thousandeyes-agent-name-prefix", default="te-agent-aleccham", show_default=True)
@click.option("--thousandeyes-test-name", default="defenseclaw-demo-teastore-k8s", show_default=True)
@click.option("--thousandeyes-interval", default=60, show_default=True, type=int)
@click.option("--thousandeyes-desired-status-code", default="200", show_default=True)
@click.option("--thousandeyes-aid", default=None, help="Optional ThousandEyes account group ID.")
@click.option(
    "--live-galileo-session",
    is_flag=True,
    help="Log one Galileo Session with tool spans for the TeaStore incident flow.",
)
@click.option(
    "--allow-galileo-unavailable",
    is_flag=True,
    help="Record Galileo session failures without failing the demo command.",
)
@click.option("--galileo-project", default=None, help="Galileo project name. Defaults to GALILEO_PROJECT or clus-demo.")
@click.option(
    "--galileo-log-stream",
    default=None,
    help="Galileo log stream name. Defaults to GALILEO_LOG_STREAM or clus-demo.",
)
@click.option(
    "--galileo-session-name",
    default=None,
    help="Optional Galileo session name. Defaults to '<ticket-id> TeaStore incident'.",
)
@click.option(
    "--splunk-audit-result",
    type=click.Path(path_type=Path),
    default=None,
    help="Optional JSON artifact to include as the Splunk audit search span output.",
)
@click.option(
    "--autonomy-slo",
    is_flag=True,
    help="Include the shadow-autonomy scorecard and Autonomy SLO promotion policy.",
)
@click.option(
    "--autonomy-evidence",
    type=click.Path(path_type=Path),
    default=None,
    help="Optional JSON evidence with galileo, splunk_o11y, and splunk_enterprise SLO metrics.",
)
def enterprise_ops_cmd(
    output_format: str,
    output: Path | None,
    live_inspect: bool,
    api_base: str,
    token_env: str,
    timeout: float,
    live_thousandeyes: bool,
    thousandeyes_api_base: str,
    thousandeyes_token_env: str,
    live_o11y_mcp: bool,
    ticket_id: str,
    service_name: str,
    target_url: str,
    o11y_probe_url: str,
    o11y_latency_threshold_ms: float,
    live_o11y_detectors: bool,
    o11y_realm: str,
    o11y_token_env: str,
    o11y_detector_query: str,
    o11y_detector_tag: tuple[str, ...],
    o11y_detector_poll_attempts: int,
    o11y_detector_poll_interval: float,
    o11y_detector_limit: int,
    execute_te_create: bool,
    approved: bool,
    thousandeyes_agent_id: str | None,
    thousandeyes_agent_name_prefix: str,
    thousandeyes_test_name: str,
    thousandeyes_interval: int,
    thousandeyes_desired_status_code: str,
    thousandeyes_aid: str | None,
    live_galileo_session: bool,
    allow_galileo_unavailable: bool,
    galileo_project: str | None,
    galileo_log_stream: str | None,
    galileo_session_name: str | None,
    splunk_audit_result: Path | None,
    autonomy_slo: bool,
    autonomy_evidence: Path | None,
) -> None:
    """Emit the ThousandEyes/K8s/Splunk/Galileo enterprise demo plan."""
    workflow = default_workflow()
    validation = validate_workflow(workflow)
    live_results = None
    if live_inspect:
        live_results = run_live_inspect(
            workflow,
            api_base=api_base,
            token=os.environ.get(token_env),
            timeout=timeout,
        )
    thousandeyes_results = None
    if live_thousandeyes:
        thousandeyes_results = run_thousandeyes_live_checks(
            token=os.environ.get(thousandeyes_token_env),
            api_base=thousandeyes_api_base,
            timeout=timeout,
        )
    o11y_mcp_results = None
    if live_o11y_mcp:
        o11y_mcp_results = build_teastore_o11y_mcp_evidence(
            ticket_id=ticket_id,
            service_name=service_name,
            target_url=target_url,
            probe_url=o11y_probe_url,
            timeout=timeout,
            latency_threshold_ms=o11y_latency_threshold_ms,
        )
    o11y_detector_results = None
    if live_o11y_detectors:
        o11y_detector_results = run_splunk_o11y_detector_poll(
            token=os.environ.get(o11y_token_env),
            realm=o11y_realm,
            service_name=service_name,
            detector_tags=o11y_detector_tag or ("teastore",),
            query=o11y_detector_query,
            timeout=timeout,
            attempts=o11y_detector_poll_attempts,
            interval_seconds=o11y_detector_poll_interval,
            limit=o11y_detector_limit,
        )
    thousandeyes_create_results = None
    if execute_te_create:
        thousandeyes_create_results = execute_thousandeyes_create_test(
            token=os.environ.get(thousandeyes_token_env),
            approved=approved,
            inspect_api_base=api_base,
            inspect_token=os.environ.get(token_env),
            api_base=thousandeyes_api_base,
            test_name=thousandeyes_test_name,
            target_url=target_url,
            agent_id=thousandeyes_agent_id,
            agent_name_prefix=thousandeyes_agent_name_prefix,
            interval=thousandeyes_interval,
            desired_status_code=thousandeyes_desired_status_code,
            timeout=timeout,
            aid=thousandeyes_aid,
        )

    autonomy_slo_results = None
    if autonomy_slo:
        evidence_payload = None
        if autonomy_evidence:
            try:
                evidence_payload = json.loads(autonomy_evidence.read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                raise click.ClickException(f"failed to read autonomy evidence: {exc}") from exc
            if not isinstance(evidence_payload, dict):
                raise click.ClickException("autonomy evidence must be a JSON object")
        derived_evidence = derive_autonomy_slo_evidence(
            live_results=live_results,
            o11y_mcp_results=o11y_mcp_results,
            o11y_detector_results=o11y_detector_results,
            thousandeyes_create_results=thousandeyes_create_results,
        )
        autonomy_slo_results = build_autonomy_slo_report(
            workflow,
            evidence=evidence_payload,
            derived_evidence=derived_evidence,
            thousandeyes_create_results=thousandeyes_create_results,
        )

    report = build_report(
        workflow,
        validation=validation,
        live_results=live_results,
        thousandeyes_results=thousandeyes_results,
        o11y_mcp_results=o11y_mcp_results,
        o11y_detector_results=o11y_detector_results,
        thousandeyes_create_results=thousandeyes_create_results,
        autonomy_slo_results=autonomy_slo_results,
    )
    if live_galileo_session:
        splunk_audit_payload = None
        if splunk_audit_result:
            try:
                splunk_audit_payload = json.loads(splunk_audit_result.read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                splunk_audit_payload = {"ok": False, "artifact": str(splunk_audit_result), "errors": [str(exc)]}
        report["galileo_session"] = log_live_galileo_session(
            report,
            ticket_id=ticket_id,
            project=galileo_project or os.environ.get("GALILEO_PROJECT") or "clus-demo",
            log_stream=galileo_log_stream or os.environ.get("GALILEO_LOG_STREAM") or "clus-demo",
            session_name=galileo_session_name,
            splunk_audit_result=splunk_audit_payload if isinstance(splunk_audit_payload, dict) else None,
            allow_unavailable=allow_galileo_unavailable,
        )
    if output_format == "json":
        rendered = report_to_json(report)
    elif output_format == "control-room":
        rendered = render_control_room(report)
    else:
        rendered = render_markdown(report)
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")
        click.echo(f"wrote {output}")
    else:
        click.echo(rendered, nl=False)

    failed_live = [item for item in live_results or [] if not item.get("ok")]
    if not validation["ok"]:
        raise click.ClickException("enterprise demo workflow validation failed")
    if failed_live:
        raise click.ClickException(f"{len(failed_live)} live inspect step(s) failed")
    if thousandeyes_results and not thousandeyes_results.get("ok"):
        raise click.ClickException("ThousandEyes live readiness failed")
    if o11y_mcp_results and not o11y_mcp_results.get("ok"):
        raise click.ClickException("Splunk O11y MCP evidence collection failed")
    if o11y_detector_results and not o11y_detector_results.get("ok"):
        raise click.ClickException("Splunk O11y detector polling failed")
    if thousandeyes_create_results and not thousandeyes_create_results.get("ok"):
        raise click.ClickException("ThousandEyes test create execution failed")
    if report.get("galileo_session") and not report["galileo_session"].get("ok") and not allow_galileo_unavailable:
        raise click.ClickException("Galileo live session logging failed")
