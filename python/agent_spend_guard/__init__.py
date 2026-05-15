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
"""

from .client import AgentSpendGuard, FailureMode, UncertainPolicy
from .errors import (
    SpendingGuardBlockedError,
    SpendingGuardConfirmationDeniedError,
    SpendingGuardClientError,
)

__all__ = [
    "AgentSpendGuard",
    "FailureMode",
    "UncertainPolicy",
    "SpendingGuardBlockedError",
    "SpendingGuardConfirmationDeniedError",
    "SpendingGuardClientError",
]

__version__ = "0.4.0b0"
