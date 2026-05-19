"""Art-generation pipeline — AIBrake shadow-mode integration template.

Drop-in template for projects that generate art via paid APIs (OpenAI
DALL-E, MidJourney, Stable Diffusion paid endpoints, etc.). Designed
around the pattern that drove this template into existence: OurTrace's
weekly pipeline (`monday_manifest.py` and friends) that fans out art
prompts and historically had no protection against:

  - prompt-loop storms: same prompt regenerated 6 times because the
    quality check kept failing, no context refresh between attempts
  - model escalation: silently falling back from dall-e-3 to
    midjourney-v6 mid-loop without anyone noticing the cost delta
  - budget drift: weekly art budget burned in one bad pipeline run

This template runs in SHADOW MODE — it OBSERVES every art-gen call and
LOGS the decision, but never blocks. After 7 days of shadow logs, you
flip a flag and AIBrake starts actually pausing the bad runs.

Setup:

    pip install agent-spend-guard

    export AIBRAKE_API_KEY=asg_v1_owner_xxx
    export AIBRAKE_URL=https://api.aibrake.dev

    python art_pipeline_shadow.py

What to do with it:

  1. Copy this file into your OurTrace repo (or any art pipeline).
  2. Replace `your_art_generation_call(...)` with whatever you actually
     call to generate art (the OpenAI client, the MidJourney REST call,
     `aiohttp.post(...)`, whatever it is).
  3. Wrap that call with `guard_art_gen(...)` from below.
  4. Let it run for a week. Check the AIBrake decision log:
     https://api.aibrake.dev/v1/public/stats  ← shows aggregate counts
     Your own decisions live in your hosted AIBrake instance log.
  5. When you see useful catches: switch `failure_mode="open"` to
     `failure_mode="closed"` and change `check_shadow` to `check` —
     AIBrake starts actually pausing the bad runs.
"""

from __future__ import annotations

import os
import time
import hashlib
from typing import Any, Optional

from agent_spend_guard import AgentSpendGuard

# ─────────────────────────────────────────────────────────────────────────
# AIBrake client — one instance per process is fine.
# ─────────────────────────────────────────────────────────────────────────
guard = AgentSpendGuard(
    base_url=os.environ.get("AIBRAKE_URL", "https://api.aibrake.dev"),
    api_key=os.environ["AIBRAKE_API_KEY"],
    failure_mode="open",       # CRITICAL: guard outages never block your pipeline
    timeout_ms=800,
)

# ─────────────────────────────────────────────────────────────────────────
# Tiny per-session history. In production you'd persist this to a DB
# (per pipeline run, per art brief, per user — whatever your unit of work
# is). For a weekly cron like monday_manifest.py, a simple in-memory dict
# scoped to one run is enough.
# ─────────────────────────────────────────────────────────────────────────
class ArtSession:
    def __init__(self, objective_id: str, goal: str, budget_usd: float):
        self.objective_id = objective_id
        self.goal = goal
        self.budget_usd = budget_usd
        self.attempts: list[dict[str, Any]] = []

    def record(self, *, prompt: str, model: str, cost_usd: float,
               success: bool, error: Optional[str] = None) -> None:
        self.attempts.append({
            "prompt_hash": hashlib.sha256(prompt.encode()).hexdigest()[:16],
            "model": model,
            "cost_usd": cost_usd,
            "success": success,
            "error": error,
            "ts": time.time(),
        })

    @property
    def total_spent_usd(self) -> float:
        return sum(a["cost_usd"] for a in self.attempts)

    @property
    def last_failure_fingerprint(self) -> Optional[str]:
        """A stable fingerprint of the most recent error, so retries
        on the same error get caught as a retry-storm."""
        for a in reversed(self.attempts):
            if not a["success"] and a["error"]:
                return f"fp_v1_{hashlib.sha256(a['error'].encode()).hexdigest()[:12]}"
        return None

    @property
    def attempts_on_same_failure(self) -> int:
        fp = self.last_failure_fingerprint
        if not fp:
            return 0
        return sum(
            1 for a in self.attempts
            if not a["success"] and a["error"]
            and f"fp_v1_{hashlib.sha256(a['error'].encode()).hexdigest()[:12]}" == fp
        )


# ─────────────────────────────────────────────────────────────────────────
# The guard call — wrap this around every paid art-gen request.
# ─────────────────────────────────────────────────────────────────────────
def guard_art_gen(
    session: ArtSession,
    *,
    prompt: str,
    model: str,
    estimated_cost_usd: float,
) -> dict[str, Any]:
    """Ask AIBrake whether the next art-gen call is worth making.

    Returns the AIBrake decision dict. In shadow mode we always proceed
    regardless of the decision — we just log it for analysis.
    """
    payload = {
        "actor": {
            "type": "agent",
            "runtime": "art_pipeline",
            "id": "ourtrace_monday_manifest",
        },
        "objective": {
            "id": session.objective_id,
            "goal": session.goal,
            "budget": {
                "amount": session.budget_usd,
                "currency": "USD",
                "hard_limit": False,
            },
        },
        "next_action": {
            "type": "paid_llm_call",
            "provider": "openai" if "dall-e" in model else "midjourney",
            "model": model,
            "estimated_cost": {"amount": estimated_cost_usd, "currency": "USD"},
            "reason": f"Generate art for brief: {session.goal[:60]}",
        },
        "history": {
            "attempt_number": len(session.attempts) + 1,
            "same_action_count": sum(
                1 for a in session.attempts if a["model"] == model
            ),
            "paid_attempts_on_same_failure": session.attempts_on_same_failure,
            "failure_signal_present": session.last_failure_fingerprint is not None,
            "failure_fingerprint": session.last_failure_fingerprint,
            "new_evidence_since_last_attempt": False if session.attempts else None,
        },
        "spend": {
            "spent_on_objective": {
                "amount": session.total_spent_usd,
                "currency": "USD",
            },
        },
        "telemetry_quality": {"completeness": "high"},
    }

    return guard.check_shadow(payload)


# ─────────────────────────────────────────────────────────────────────────
# The actual pipeline — replace `your_art_generation_call` with reality.
# ─────────────────────────────────────────────────────────────────────────
def your_art_generation_call(prompt: str, model: str) -> dict[str, Any]:
    """STUB — replace with your actual art-gen call (OpenAI / MidJourney /
    whatever). For this template we simulate a failure pattern."""
    # Simulated: the model keeps producing low-quality results
    # because the prompt is malformed. In reality this would be a call
    # like openai.images.generate(...) or aiohttp.post(midjourney_url, ...).
    if "broken_prompt_marker" in prompt:
        return {"success": False, "error": "Quality check failed: image off-brief"}
    return {"success": True, "url": "https://example.com/art.png"}


def generate_art_with_guard(session: ArtSession, prompt: str, model: str) -> Optional[str]:
    """Wraps art generation with an AIBrake check + history recording."""
    # 1. Estimate the cost from a tiny lookup table.
    PRICING = {
        "dall-e-3": 0.04,
        "dall-e-3-hd": 0.08,
        "midjourney-v6": 0.10,
    }
    estimated = PRICING.get(model, 0.05)

    # 2. Ask AIBrake (shadow mode — always proceeds).
    decision = guard_art_gen(
        session, prompt=prompt, model=model, estimated_cost_usd=estimated,
    )

    # 3. Log the decision (this is where you'd hook into your existing
    # observability — stdout, Datadog, whatever).
    print(
        f"[aibrake] obj={session.objective_id} "
        f"attempt={len(session.attempts) + 1} "
        f"decision={decision['decision']} "
        f"pattern={decision['pattern']} "
        f"risk={decision['risk_score']}"
    )
    ps = decision.get("projected_savings")
    if ps:
        print(
            f"[aibrake]   would have saved: ${ps['amount_usd']:.2f} "
            f"({ps['basis']})"
        )

    # 4. Proceed regardless (shadow mode).
    result = your_art_generation_call(prompt, model)

    # 5. Record what happened so the next check has accurate history.
    session.record(
        prompt=prompt,
        model=model,
        cost_usd=estimated if result["success"] else 0,
        success=result["success"],
        error=result.get("error"),
    )

    return result.get("url") if result["success"] else None


# ─────────────────────────────────────────────────────────────────────────
# Demo run — simulates a retry storm that AIBrake should catch.
# ─────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    session = ArtSession(
        objective_id="ourtrace_2026_w20_hero",
        goal="Generate hero art for OurTrace 2026 week 20 manifest",
        budget_usd=2.00,
    )

    # Pretend the pipeline keeps retrying the same broken prompt.
    print("=" * 60)
    print("Simulating a retry storm: 5 attempts with a broken prompt")
    print("=" * 60)
    for i in range(5):
        print(f"\n— Attempt {i + 1} —")
        generate_art_with_guard(
            session,
            prompt="broken_prompt_marker generate fancy art",
            model="dall-e-3",
        )

    print()
    print("=" * 60)
    print(f"Pipeline finished. Total spent: ${session.total_spent_usd:.2f}")
    print("=" * 60)
    print()
    print("What you should see above:")
    print("  attempt 1-2: allow / uncertain (not enough history yet)")
    print("  attempt 3+:  require_confirmation or block — stale_context_retry_storm")
    print("  projected_savings appears once the detector fires")
    print()
    print("In production, you'd:")
    print("  - swap check_shadow → check")
    print("  - if decision in {'block', 'require_confirmation'}: pause or ask human")
    print("  - persist `session` to a DB so it survives across pipeline runs")
