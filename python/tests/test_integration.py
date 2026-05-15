"""Integration tests against a live Agent Spend Guard server.

Run with:

    AGENT_SPEND_GUARD_URL=http://localhost:8080 \
    AGENT_SPEND_GUARD_API_KEY=asg_v1_demo \
    python -m pytest -m integration

These are skipped by default if no server is reachable; explicit env opts in.
"""

from __future__ import annotations

import os
import urllib.request
from typing import Any, Dict

import pytest

from agent_spend_guard import AgentSpendGuard, SpendingGuardBlockedError


def _server_reachable(url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{url}/health", timeout=1.0) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001 — integration probe
        return False


pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _skip_if_no_server(integration_url: str) -> None:
    if not _server_reachable(integration_url):
        pytest.skip(f"server not reachable at {integration_url}")


def _retry_storm_payload(attempt: int) -> Dict[str, Any]:
    return {
        "actor": {"type": "agent", "runtime": "python-integration-test"},
        "objective": {
            "id": "obj_int_test",
            "goal": "test the integration",
            "budget": {"amount": 5, "currency": "USD", "hard_limit": False},
        },
        "next_action": {
            "type": "paid_llm_call",
            "provider": "anthropic",
            "model": "claude-opus",
            "estimated_cost": {"amount": 0.42, "currency": "USD"},
            "reason": "retry build fix",
        },
        "history": {
            "attempt_number": attempt,
            "same_action_count": attempt - 1,
            "paid_attempts_on_same_failure": attempt - 1,
            "failure_signal_present": True,
            "failure_signal_type": "build_error",
            "failure_fingerprint": "fp_v1_failure_ts2307",
            "same_failure_count": attempt - 1,
            "new_evidence_since_last_attempt": False if attempt > 1 else None,
            "evidence_kind": "code",
            "evidence_signals": {
                "files_read_since_last_attempt": 0,
                "tests_run_since_last_attempt": 0,
                "git_diff_changed_since_last_attempt": False,
            },
            "confidence_delta": 0,
        },
        "spend": {"spent_on_objective": {"amount": (attempt - 1) * 0.42, "currency": "USD"}},
        "telemetry_quality": {"completeness": "high"},
    }


def test_int_01_health_returns_0_4_branding(integration_url: str) -> None:
    with urllib.request.urlopen(f"{integration_url}/health", timeout=2) as r:
        import json
        body = json.loads(r.read())
    assert body["service"] == "agent-spend-guard"
    assert body["mode"] == "hosted-beta"


def test_int_02_first_call_returns_allow(integration_url: str, integration_api_key: str) -> None:
    guard = AgentSpendGuard(
        base_url=integration_url,
        api_key=integration_api_key,
        failure_mode="open",
        timeout_ms=2000,
    )
    result = guard.check_shadow(_retry_storm_payload(1))
    assert result["decision"] == "allow"
    assert result["pattern"] == "none"


def test_int_03_canonical_retry_storm_escalates(
    integration_url: str, integration_api_key: str
) -> None:
    guard = AgentSpendGuard(
        base_url=integration_url,
        api_key=integration_api_key,
        failure_mode="open",
        timeout_ms=2000,
    )
    decisions = []
    for i in range(1, 8):
        r = guard.check_shadow(_retry_storm_payload(i))
        decisions.append(r["decision"])
    # Trajectory: allow → warn (or allow) → ... → require_confirmation
    assert decisions[0] == "allow"
    assert "require_confirmation" in decisions[3:]


def test_int_04_invalid_key_returns_401_handled_as_failure_open(
    integration_url: str,
) -> None:
    guard = AgentSpendGuard(
        base_url=integration_url,
        api_key="totally_wrong_key",
        failure_mode="open",
        timeout_ms=2000,
    )
    result = guard.check(_retry_storm_payload(1))
    # With failure_mode=open, even a 401 yields a synthetic allow result.
    assert result["decision"] == "allow"
    assert result["pattern"] == "guard_unavailable"
