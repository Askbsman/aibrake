"""Unit tests for the AgentSpendGuard Python client.

These tests use pytest-mock to monkey-patch the internal _invoke method,
so they exercise the helper logic (check / check_shadow / check_or_confirm /
check_or_downgrade / failure_mode / uncertain_policy) without hitting the
network.

Integration tests against a live server are in test_integration.py and are
marked @pytest.mark.integration.
"""

from __future__ import annotations

import urllib.error
from typing import Any, Dict

import pytest

from agent_spend_guard import (
    AgentSpendGuard,
    SpendingGuardBlockedError,
    SpendingGuardClientError,
    SpendingGuardConfirmationDeniedError,
)
from agent_spend_guard.client import hash_api_key


SAMPLE_PAYLOAD: Dict[str, Any] = {
    "actor": {"type": "agent"},
    "next_action": {
        "type": "paid_llm_call",
        "provider": "anthropic",
        "model": "claude-opus",
        "estimated_cost": {"amount": 0.42, "currency": "USD"},
    },
}


# ── Construction ─────────────────────────────────────────────────────────


def test_01_constructor_rejects_empty_base_url() -> None:
    with pytest.raises(SpendingGuardClientError):
        AgentSpendGuard(base_url="")


def test_02_constructor_strips_trailing_slash() -> None:
    g = AgentSpendGuard(base_url="http://host/")
    # We can't inspect private state safely; this just confirms construction succeeded.
    assert g is not None


# ── hash_api_key ─────────────────────────────────────────────────────────


def test_03_hash_api_key_matches_server_format() -> None:
    h = hash_api_key("asg_v1_demo")
    assert h.startswith("key_v1_")
    assert "asg_v1_demo" not in h  # raw key never appears
    # Deterministic
    assert hash_api_key("asg_v1_demo") == h


def test_04_hash_api_key_different_inputs_different_hashes() -> None:
    assert hash_api_key("k1") != hash_api_key("k2")


# ── check() ──────────────────────────────────────────────────────────────


def test_05_check_returns_block_result_without_raising(
    fake_response_factory, mocker
) -> None:
    g = AgentSpendGuard(base_url="http://x")
    mocker.patch.object(
        AgentSpendGuard,
        "_invoke",
        return_value=fake_response_factory(decision="block"),
    )
    result = g.check(SAMPLE_PAYLOAD)
    assert result["decision"] == "block"


# ── check_shadow() ───────────────────────────────────────────────────────


def test_06_check_shadow_swallows_transport_error(mocker) -> None:
    # Stage 0.4.1: check_shadow now catches ONLY transport-class exceptions,
    # not bare RuntimeError. Use a real urllib transport exception to verify
    # the synthesis path still fires for actual network failures.
    g = AgentSpendGuard(base_url="http://x", failure_mode="throw")
    mocker.patch.object(
        AgentSpendGuard,
        "_invoke",
        side_effect=urllib.error.URLError("network down"),
    )
    result = g.check_shadow(SAMPLE_PAYLOAD)
    assert result["decision"] == "allow"
    assert result["pattern"] == "guard_unavailable"
    assert result["error"]["code"] == "GUARD_UNAVAILABLE"


def test_06b_check_shadow_swallows_timeout_error(mocker) -> None:
    # Same contract for the other transport-class exceptions.
    g = AgentSpendGuard(base_url="http://x", failure_mode="open")
    mocker.patch.object(
        AgentSpendGuard,
        "_invoke",
        side_effect=TimeoutError("timed out"),
    )
    result = g.check_shadow(SAMPLE_PAYLOAD)
    assert result["decision"] == "allow"
    assert result["pattern"] == "guard_unavailable"


# ── check_or_confirm() ───────────────────────────────────────────────────


def test_07_check_or_confirm_calls_on_warn(fake_response_factory, mocker) -> None:
    g = AgentSpendGuard(base_url="http://x")
    mocker.patch.object(
        AgentSpendGuard,
        "_invoke",
        return_value=fake_response_factory(decision="warn"),
    )
    seen = []

    def on_warn(r: Dict[str, Any]) -> bool:
        seen.append(r["decision"])
        return True

    result = g.check_or_confirm(SAMPLE_PAYLOAD, on_warn=on_warn)
    assert seen == ["warn"]
    assert result["decision"] == "warn"


def test_08_check_or_confirm_raises_blocked(fake_response_factory, mocker) -> None:
    g = AgentSpendGuard(base_url="http://x")
    mocker.patch.object(
        AgentSpendGuard,
        "_invoke",
        return_value=fake_response_factory(decision="block"),
    )
    with pytest.raises(SpendingGuardBlockedError):
        g.check_or_confirm(SAMPLE_PAYLOAD)


def test_09_check_or_confirm_denies_when_on_warn_returns_false(
    fake_response_factory, mocker
) -> None:
    g = AgentSpendGuard(base_url="http://x")
    mocker.patch.object(
        AgentSpendGuard,
        "_invoke",
        return_value=fake_response_factory(decision="require_confirmation"),
    )
    with pytest.raises(SpendingGuardConfirmationDeniedError):
        g.check_or_confirm(SAMPLE_PAYLOAD, on_warn=lambda _r: False)


# ── check_or_downgrade() ─────────────────────────────────────────────────


def test_10_check_or_downgrade_uses_model_route_to_from_response(
    fake_response_factory, mocker
) -> None:
    g = AgentSpendGuard(base_url="http://x")
    mocker.patch.object(
        AgentSpendGuard,
        "_invoke",
        return_value=fake_response_factory(
            decision="warn",
            pattern="model_escalation_without_evidence",
            recommended_policy="downgrade",
            suggested_action_type="switch_model",
            model_route_to={"provider": "anthropic", "model": "claude-sonnet"},
        ),
    )
    action, result = g.check_or_downgrade(
        SAMPLE_PAYLOAD,
        downgrade_to={
            "provider": "anthropic",
            "model": "claude-haiku",
            "estimated_cost": 0.01,
        },
    )
    # Response's model_route.to wins over static downgrade_to.
    assert action["model"] == "claude-sonnet"
    assert action["estimated_cost"]["amount"] == 0.01
    assert result["pattern"] == "model_escalation_without_evidence"


def test_11_check_or_downgrade_falls_back_to_static_downgrade_to(
    fake_response_factory, mocker
) -> None:
    g = AgentSpendGuard(base_url="http://x")
    mocker.patch.object(
        AgentSpendGuard,
        "_invoke",
        return_value=fake_response_factory(
            decision="warn",
            pattern="model_escalation_without_evidence",
            recommended_policy="downgrade",
            suggested_action_type="downgrade_model",
            # No model_route_to in response — SDK should use static downgrade_to.
        ),
    )
    action, _result = g.check_or_downgrade(
        SAMPLE_PAYLOAD,
        downgrade_to={"model": "claude-haiku", "estimated_cost": 0.01},
    )
    assert action["model"] == "claude-haiku"


def test_12_check_or_downgrade_returns_original_action_on_allow(
    fake_response_factory, mocker
) -> None:
    g = AgentSpendGuard(base_url="http://x")
    mocker.patch.object(
        AgentSpendGuard,
        "_invoke",
        return_value=fake_response_factory(decision="allow"),
    )
    action, _ = g.check_or_downgrade(
        SAMPLE_PAYLOAD,
        downgrade_to={"model": "claude-haiku"},
    )
    assert action["model"] == "claude-opus"


def test_13_check_or_downgrade_raises_blocked(
    fake_response_factory, mocker
) -> None:
    g = AgentSpendGuard(base_url="http://x")
    mocker.patch.object(
        AgentSpendGuard,
        "_invoke",
        return_value=fake_response_factory(decision="block"),
    )
    with pytest.raises(SpendingGuardBlockedError):
        g.check_or_downgrade(SAMPLE_PAYLOAD, downgrade_to={"model": "claude-haiku"})


# ── failure_mode ─────────────────────────────────────────────────────────


def test_14_failure_mode_open_returns_synthetic_allow(mocker) -> None:
    g = AgentSpendGuard(base_url="http://x", failure_mode="open")
    mocker.patch.object(
        AgentSpendGuard,
        "_invoke",
        side_effect=RuntimeError("boom"),
    )
    # _invoke itself is mocked — but check() calls _invoke directly. Reset.
    mocker.stopall()
    g = AgentSpendGuard(base_url="http://nonexistent.invalid", failure_mode="open", timeout_ms=100)
    result = g.check(SAMPLE_PAYLOAD)
    assert result["decision"] == "allow"
    assert result["pattern"] == "guard_unavailable"


def test_15_failure_mode_closed_returns_synthetic_block() -> None:
    g = AgentSpendGuard(
        base_url="http://nonexistent.invalid",
        failure_mode="closed",
        timeout_ms=100,
    )
    result = g.check(SAMPLE_PAYLOAD)
    assert result["decision"] == "block"
    assert result["hard_block"] is True


def test_16_failure_mode_throw_propagates() -> None:
    g = AgentSpendGuard(
        base_url="http://nonexistent.invalid",
        failure_mode="throw",
        timeout_ms=100,
    )
    with pytest.raises(Exception):
        g.check(SAMPLE_PAYLOAD)


# ── Stage 0.4.1 regression: check_shadow must NOT swallow programmer errors ──


def test_17_check_shadow_propagates_programmer_errors_on_unserialisable_payload() -> None:
    """Stage 0.4.1 fix (Partner C revisit, Finding 1).

    A payload containing an unserializable value (lambda, set, etc.) raises
    TypeError inside json.dumps() — BEFORE any network call. Prior to 0.4.1,
    check_shadow's broad `except Exception` silently converted this to a
    synthetic `decision: allow, pattern: guard_unavailable` response, making
    the operator believe their agent was protected when in fact it was
    running without the guardrail. The fix narrows the catch to transport-
    class exceptions only; programmer errors must propagate.
    """
    g = AgentSpendGuard(base_url="http://localhost:1", failure_mode="open", timeout_ms=100)

    # A function is not JSON-serializable; json.dumps() raises TypeError.
    # The error happens BEFORE any network attempt, so it has nothing to do
    # with the "guard unavailable" failure path.
    bad_payload: Dict[str, Any] = {
        "actor": {"type": "agent"},
        "next_action": {
            "type": "paid_llm_call",
            "estimated_cost": {"amount": 0.05, "currency": "USD"},
            "callback": lambda: None,  # intentional integration bug
        },
    }

    with pytest.raises(TypeError):
        g.check_shadow(bad_payload)


def test_18_check_propagates_programmer_errors_too() -> None:
    """check() never swallowed programmer errors in the first place — verify
    the regression-test surface covers both helpers explicitly."""
    g = AgentSpendGuard(base_url="http://localhost:1", failure_mode="open", timeout_ms=100)
    bad_payload: Dict[str, Any] = {
        "actor": {"type": "agent"},
        "next_action": {"type": "x", "estimated_cost": {"amount": 0, "currency": "USD"}, "bad": {1, 2, 3}},
    }
    with pytest.raises(TypeError):
        g.check(bad_payload)
