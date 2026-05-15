"""Shadow-mode integration example (Python).

Drop this in BEFORE each expensive AI action. It never blocks your agent.

Run:
    AGENT_SPEND_GUARD_URL=http://localhost:8080 \\
    AGENT_SPEND_GUARD_API_KEY=asg_v1_demo \\
    python examples/shadow.py
"""

from __future__ import annotations

import os

from agent_spend_guard import AgentSpendGuard

URL = os.environ.get("AGENT_SPEND_GUARD_URL", "http://localhost:8080")
KEY = os.environ.get("AGENT_SPEND_GUARD_API_KEY", "asg_v1_demo")

guard = AgentSpendGuard(
    base_url=URL,
    api_key=KEY,
    failure_mode="open",      # CRITICAL: guard outages never take your agent offline
    timeout_ms=1000,
)

payload = {
    "actor": {"type": "agent", "runtime": "python-langchain"},
    "objective": {
        "id": "obj_summary",
        "goal": "summarize 10-K filing",
        "budget": {"amount": 10, "currency": "USD", "hard_limit": False},
    },
    "next_action": {
        "type": "paid_llm_call",
        "provider": "openai",
        "model": "gpt-4",
        "estimated_cost": {"amount": 0.30, "currency": "USD"},
        "reason": "summarize document",
    },
    # Fill in history fields as you accumulate session state.
    "history": {
        "attempt_number": 1,
        "same_action_count": 0,
        "paid_attempts_on_same_failure": 0,
        "failure_signal_present": False,
        # Cold start: send null (not false). See PYTHON_SDK.md / PARTNER_ONBOARDING.md.
        "new_evidence_since_last_attempt": None,
    },
    "telemetry_quality": {"completeness": "high"},
}

result = guard.check_shadow(payload)

print(f"decision:            {result['decision']}")
print(f"pattern:             {result['pattern']}")
print(f"risk_score:          {result['risk_score']}")
print(f"confidence:          {result['confidence']:.2f}")
print(f"recommended_policy:  {result['recommended_policy']}")
print(f"reason:              {result['reason']}")
print(f"suggested:           {result['suggested_action']['type']}")
if "error" in result:
    print(f"guard error:         {result['error']['code']} — {result['error']['message']}")

# Shadow-mode contract: execute the planned action regardless.
print("\n[agent] proceeding with the planned action regardless (shadow mode)")
