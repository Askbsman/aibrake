"""checkOrDowngrade integration example (Python).

Demonstrates auto-routing to the configured secondary model when the guard
detects a premium-model loop. The structured `model_route.to` in the
response (populated when objective.model_policy.secondaryModel is set)
takes precedence over the static downgrade_to argument.

Run:
    AGENT_SPEND_GUARD_URL=http://localhost:8080 \\
    AGENT_SPEND_GUARD_API_KEY=asg_v1_demo \\
    python examples/downgrade.py
"""

from __future__ import annotations

import os

from agent_spend_guard import AgentSpendGuard, SpendingGuardBlockedError

URL = os.environ.get("AGENT_SPEND_GUARD_URL", "http://localhost:8080")
KEY = os.environ.get("AGENT_SPEND_GUARD_API_KEY", "asg_v1_demo")

guard = AgentSpendGuard(
    base_url=URL,
    api_key=KEY,
    failure_mode="open",
    timeout_ms=1000,
)


def planned_action(attempt: int) -> dict:
    return {
        "actor": {"type": "agent", "runtime": "python-langchain"},
        "objective": {
            "id": "obj_summary_loop",
            "goal": "summarize a long document",
            "budget": {"amount": 10, "currency": "USD", "hard_limit": False},
            "model_policy": {
                "primaryModel": {
                    "provider": "openai",
                    "model": "gpt-4",
                    "role": "primary",
                    "tier": "premium",
                },
                "secondaryModel": {
                    "provider": "openai",
                    "model": "gpt-3.5-turbo",
                    "role": "secondary",
                    "tier": "standard",
                },
            },
        },
        "next_action": {
            "type": "paid_llm_call",
            "provider": "openai",
            "model": "gpt-4",
            "model_role": "primary",
            "model_tier": "premium",
            "estimated_cost": {"amount": 0.30, "currency": "USD"},
            "reason": "retry summary",
        },
        "history": {
            "attempt_number": attempt,
            "same_action_count": attempt - 1,
            "paid_attempts_on_same_failure": max(0, attempt - 1),
            "failure_signal_present": attempt > 1,
            "failure_signal_type": "validation_error",
            "failure_fingerprint": "fp_v1_failure_summary_too_long",
            "same_failure_count": max(0, attempt - 1),
            "new_evidence_since_last_attempt": None if attempt == 1 else False,
            "evidence_kind": "generic",
            "evidence_signals": {"tool_results_changed_since_last_attempt": False},
        },
        "spend": {"spent_on_objective": {"amount": (attempt - 1) * 0.30, "currency": "USD"}},
        "telemetry_quality": {"completeness": "high"},
    }


for attempt in range(1, 5):
    payload = planned_action(attempt)
    try:
        action, result = guard.check_or_downgrade(
            payload,
            downgrade_to={
                "provider": "openai",
                "model": "gpt-3.5-turbo",     # static fallback if no model_route.to
                "estimated_cost": 0.02,
            },
        )
    except SpendingGuardBlockedError as err:
        print(f"[#{attempt}] BLOCKED — pattern={err.result['pattern']} reason={err.result['reason']}")
        continue
    print(
        f"[#{attempt}] decision={result['decision']} pattern={result['pattern']} "
        f"→ will run on {action['provider']}/{action['model']} "
        f"@ ${action['estimated_cost']['amount']:.2f}"
    )
