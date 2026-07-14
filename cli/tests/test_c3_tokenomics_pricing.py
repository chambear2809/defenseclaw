import pytest
from defenseclaw.c3_agent_tokenomics.transform import (
    build_summary,
    estimate_model_cost_usd,
    gateway_observations_to_metric_rows,
)


def _observation(**overrides):
    row = {
        "id": "obs-1",
        "source": "openclaw_session_snapshot",
        "connector": "openclaw",
        "agent_id": "main",
        "agent_name": "main",
        "session_id": "session-1",
        "model": "gpt-4o-mini",
        "prompt_tokens": 306_638,
        "completion_tokens": 6_016,
        "total_tokens": 312_654,
    }
    row.update(overrides)
    return row


def test_gpt_4o_mini_estimate_uses_exact_public_token_rates():
    assert estimate_model_cost_usd(
        "bridgeit/gpt-4o-mini",
        input_tokens=306_638,
        output_tokens=6_016,
    ) == pytest.approx((0.0459957, 0.0036096))
    assert estimate_model_cost_usd("gpt-4o-mini-tts", input_tokens=1_000_000) is None
    assert estimate_model_cost_usd("gpt-4o-mini", provider="azure", input_tokens=1_000_000) is None


def test_gateway_rows_estimate_missing_gpt_4o_mini_cost():
    payload = build_summary(gateway_observations_to_metric_rows([_observation()]))

    assert payload["summary"]["cost"] == {
        "total": 0.0496,
        "input": 0.046,
        "output": 0.0036,
        "currency": "USD",
        "pricing_status": "estimated",
    }
    assert payload["top_models"][0]["estimated_spend"] == 0.0496


def test_source_reported_cost_takes_precedence_over_estimate():
    payload = build_summary(
        gateway_observations_to_metric_rows([_observation(cost_usd=0.25)])
    )

    assert payload["summary"]["cost"]["total"] == 0.25
    assert payload["summary"]["cost"]["pricing_status"] == "priced"


def test_unknown_model_remains_unpriced_and_mixed_usage_is_partial():
    unknown = _observation(id="obs-unknown", session_id="session-2", model="custom-local-model")
    unknown_payload = build_summary(gateway_observations_to_metric_rows([unknown]))
    assert unknown_payload["summary"]["cost"]["pricing_status"] == "unpriced"
    assert unknown_payload["summary"]["cost"]["total"] == 0

    mixed_payload = build_summary(gateway_observations_to_metric_rows([_observation(), unknown]))
    assert mixed_payload["summary"]["cost"]["pricing_status"] == "partially_priced"
    assert mixed_payload["summary"]["cost"]["total"] == 0.0496
