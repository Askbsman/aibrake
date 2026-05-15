"""Agent Spend Guard — Python client.

Loop detection and model stop-loss for paid AI agents.

This package is a thin HTTP client mirroring the four integration patterns
of the TypeScript SDK. It is NOT a feature-parity SDK — Core features land
in the server first; Python catches up only where partners ask for it.

Quickstart:

    from agent_spend_guard import AgentSpendGuard

    guard = AgentSpendGuard(
        base_url="https://agent-spend-guard.example.com",
        api_key="asg_v1_partner_key",
        failure_mode="open",       # CRITICAL: never block your agent on guard outage
        timeout_ms=1000,
    )

    result = guard.check_shadow(payload)
    # result is a plain dict mirroring the /v1/check response shape.
    print(result["decision"], result["pattern"], result["reason"])

See PYTHON_SDK.md in the repo root for the four helpers and integration patterns.

Stage 0.5 — every SDK error exposes `.kind`, `.status_code`, `.retryable`:

    try:
        guard.check(payload)
    except SpendingGuardError as err:
        if err.kind == "transport":
            ...  # retry
        elif err.kind == "validation":
            ...  # fix payload
"""

from .client import AgentSpendGuard, FailureMode, UncertainPolicy, hash_api_key
from .errors import (
    KIND_BLOCKED,
    KIND_CONFIRMATION_DENIED,
    KIND_HTTP_4XX,
    KIND_HTTP_5XX,
    KIND_PARSE,
    KIND_SERIALIZATION,
    KIND_TRANSPORT,
    KIND_UNKNOWN,
    KIND_VALIDATION,
    SpendingGuardBlockedError,
    SpendingGuardClientError,
    SpendingGuardConfirmationDeniedError,
    SpendingGuardError,
    SpendingGuardErrorKind,
    SpendingGuardTransportError,
    SpendingGuardValidationError,
)

__all__ = [
    "AgentSpendGuard",
    "FailureMode",
    "UncertainPolicy",
    "hash_api_key",
    # Errors
    "SpendingGuardError",
    "SpendingGuardErrorKind",
    "SpendingGuardClientError",
    "SpendingGuardTransportError",
    "SpendingGuardValidationError",
    "SpendingGuardBlockedError",
    "SpendingGuardConfirmationDeniedError",
    # Kind constants
    "KIND_TRANSPORT",
    "KIND_VALIDATION",
    "KIND_HTTP_4XX",
    "KIND_HTTP_5XX",
    "KIND_SERIALIZATION",
    "KIND_PARSE",
    "KIND_BLOCKED",
    "KIND_CONFIRMATION_DENIED",
    "KIND_UNKNOWN",
]

__version__ = "0.5.0b0"
