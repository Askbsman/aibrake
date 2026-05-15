"""Stage 0.5 — structured error attributes on the Python SDK.

Mirrors `tests/stage-05-partner-ready-hardening.test.ts` in the TypeScript
suite. Every SDK error now exposes:

    err.kind          : str   — discriminator
    err.status_code   : int|None
    err.retryable     : bool

Partners can branch on `err.kind` instead of importing every subclass.
"""

from __future__ import annotations

import urllib.error
from typing import Any, Dict

import pytest

from agent_spend_guard import (
    KIND_BLOCKED,
    KIND_CONFIRMATION_DENIED,
    KIND_HTTP_4XX,
    KIND_HTTP_5XX,
    KIND_TRANSPORT,
    KIND_VALIDATION,
    AgentSpendGuard,
    SpendingGuardBlockedError,
    SpendingGuardConfirmationDeniedError,
    SpendingGuardError,
    SpendingGuardTransportError,
    SpendingGuardValidationError,
)


# ── 1. Error class hierarchy & base attributes ───────────────────────────


def test_05_01_base_error_has_kind_status_retryable() -> None:
    err = SpendingGuardError("x", kind=KIND_TRANSPORT, status_code=None, retryable=True)
    assert err.kind == "transport"
    assert err.status_code is None
    assert err.retryable is True


def test_05_02_transport_error_default_is_kind_transport_retryable_true() -> None:
    err = SpendingGuardTransportError("DNS failed")
    assert err.kind == KIND_TRANSPORT
    assert err.kind == "transport"
    assert err.retryable is True
    assert err.status_code is None
    # Still an Exception
    assert isinstance(err, Exception)
    # Still subclass of base SpendingGuardError
    assert isinstance(err, SpendingGuardError)


def test_05_03_transport_error_with_5xx_status_uses_http_5xx_kind() -> None:
    err = SpendingGuardTransportError("server error", status_code=503)
    assert err.kind == KIND_HTTP_5XX
    assert err.kind == "http_5xx"
    assert err.status_code == 503
    assert err.retryable is True


def test_05_04_validation_error_status_400_is_kind_validation_retryable_false() -> None:
    body = {"error": {"code": "VALIDATION_ERROR", "message": "missing next_action"}}
    err = SpendingGuardValidationError(400, body)
    assert err.kind == KIND_VALIDATION
    assert err.kind == "validation"
    assert err.status_code == 400
    assert err.retryable is False
    assert err.code == "VALIDATION_ERROR"
    assert err.body is body


def test_05_05_validation_error_status_401_is_kind_http_4xx_retryable_false() -> None:
    err = SpendingGuardValidationError(401, {"error": {"code": "UNAUTHORIZED", "message": "x"}})
    assert err.kind == KIND_HTTP_4XX
    assert err.status_code == 401
    assert err.retryable is False


def test_05_06_validation_error_status_429_is_kind_http_4xx_retryable_true() -> None:
    err = SpendingGuardValidationError(429, {"error": {"code": "RATE_LIMIT", "message": "x"}})
    assert err.kind == KIND_HTTP_4XX
    assert err.status_code == 429
    assert err.retryable is True


def test_05_07_blocked_error_kind_is_blocked_retryable_false() -> None:
    result: Dict[str, Any] = {
        "decision": "block",
        "pattern": "task_budget_breach",
        "reason": "Hard budget exceeded",
    }
    err = SpendingGuardBlockedError(result)
    assert err.kind == KIND_BLOCKED
    assert err.kind == "blocked"
    assert err.retryable is False
    assert err.result is result


def test_05_08_confirmation_denied_kind() -> None:
    result: Dict[str, Any] = {"decision": "warn", "pattern": "stale_context_retry_storm"}
    err = SpendingGuardConfirmationDeniedError(result)
    assert err.kind == KIND_CONFIRMATION_DENIED
    assert err.kind == "confirmation_denied"
    assert err.retryable is False


# ── 2. Single-except branching ───────────────────────────────────────────


def test_05_09_partners_can_catch_with_one_except_and_branch_on_kind() -> None:
    """The whole point of Stage 0.5: one try/except, branch on `.kind`."""
    errors = [
        SpendingGuardTransportError("net down"),
        SpendingGuardValidationError(400, {"error": {"code": "X"}}),
        SpendingGuardValidationError(401, {"error": {"code": "Y"}}),
        SpendingGuardValidationError(429, {"error": {"code": "Z"}}),
        SpendingGuardTransportError("502 bad gateway", status_code=502),
        SpendingGuardBlockedError({"decision": "block", "pattern": "p"}),
        SpendingGuardConfirmationDeniedError({"decision": "warn", "pattern": "p"}),
    ]
    kinds = [e.kind for e in errors]
    assert kinds == [
        "transport",
        "validation",
        "http_4xx",
        "http_4xx",
        "http_5xx",
        "blocked",
        "confirmation_denied",
    ]
    retryable = [e.retryable for e in errors]
    assert retryable == [True, False, False, True, True, False, False]


# ── 3. Live invocation — server-side 4xx propagates with structured kind ──


def test_05_10_check_shadow_propagates_validation_error_not_swallowed(monkeypatch) -> None:
    """Stage 0.4.2 contract preserved + Stage 0.5 details added:
    check_shadow must NOT silently convert a 4xx into synthetic allow."""

    class FakeHTTPError(urllib.error.HTTPError):
        def __init__(self) -> None:
            super().__init__(
                url="http://x/v1/check",
                code=400,
                msg="bad payload",
                hdrs=None,  # type: ignore[arg-type]
                fp=None,
            )

        def read(self) -> bytes:  # type: ignore[override]
            return b'{"error": {"code": "VALIDATION_ERROR", "message": "x"}}'

    def fake_urlopen(*_args: Any, **_kwargs: Any) -> Any:
        raise FakeHTTPError()

    import agent_spend_guard.client as client_mod

    monkeypatch.setattr(client_mod.urllib.request, "urlopen", fake_urlopen)

    g = AgentSpendGuard(base_url="http://x", failure_mode="open", timeout_ms=100)
    with pytest.raises(SpendingGuardValidationError) as exc:
        g.check_shadow({"actor": {"type": "agent"}, "next_action": {"type": "x", "estimated_cost": {"amount": 0, "currency": "USD"}}})
    assert exc.value.kind == "validation"
    assert exc.value.status_code == 400
    assert exc.value.retryable is False


def test_05_11_check_propagates_5xx_in_throw_mode_with_http_5xx_kind(monkeypatch) -> None:
    class Fake503(urllib.error.HTTPError):
        def __init__(self) -> None:
            super().__init__(
                url="http://x/v1/check",
                code=503,
                msg="server unavailable",
                hdrs=None,  # type: ignore[arg-type]
                fp=None,
            )

    def fake_urlopen(*_args: Any, **_kwargs: Any) -> Any:
        raise Fake503()

    import agent_spend_guard.client as client_mod

    monkeypatch.setattr(client_mod.urllib.request, "urlopen", fake_urlopen)

    g = AgentSpendGuard(base_url="http://x", failure_mode="throw", timeout_ms=100)
    with pytest.raises(SpendingGuardTransportError) as exc:
        g.check({"actor": {"type": "agent"}, "next_action": {"type": "x", "estimated_cost": {"amount": 0, "currency": "USD"}}})
    assert exc.value.kind == "http_5xx"
    assert exc.value.status_code == 503
    assert exc.value.retryable is True


def test_05_12_check_5xx_in_open_mode_synthesizes_allow(monkeypatch) -> None:
    class Fake500(urllib.error.HTTPError):
        def __init__(self) -> None:
            super().__init__(
                url="http://x/v1/check",
                code=500,
                msg="oops",
                hdrs=None,  # type: ignore[arg-type]
                fp=None,
            )

    def fake_urlopen(*_args: Any, **_kwargs: Any) -> Any:
        raise Fake500()

    import agent_spend_guard.client as client_mod

    monkeypatch.setattr(client_mod.urllib.request, "urlopen", fake_urlopen)

    g = AgentSpendGuard(base_url="http://x", failure_mode="open", timeout_ms=100)
    result = g.check(
        {"actor": {"type": "agent"}, "next_action": {"type": "x", "estimated_cost": {"amount": 0, "currency": "USD"}}}
    )
    assert result["decision"] == "allow"
    assert result["pattern"] == "guard_unavailable"
    assert result["error"]["code"] == "GUARD_UNAVAILABLE"
