"""Shared pytest fixtures."""

from __future__ import annotations

import os
from typing import Any, Callable, Dict, Optional

import pytest


@pytest.fixture
def fake_response_factory() -> Callable[..., Dict[str, Any]]:
    """Build a synthetic /v1/check response shape for mocking."""

    def _build(
        decision: str = "allow",
        pattern: str = "test_pattern",
        recommended_policy: str = "continue",
        suggested_action_type: str = "continue",
        model_route_to: Optional[Dict[str, Any]] = None,
        **extras: Any,
    ) -> Dict[str, Any]:
        suggested_action: Dict[str, Any] = {
            "type": suggested_action_type,
            "message": "test",
        }
        if model_route_to is not None:
            suggested_action["model_route"] = {"to": model_route_to}
        return {
            "decision": decision,
            "risk_score": 50,
            "risk_level": "elevated",
            "confidence": 0.85,
            "pattern": pattern,
            "matched_rules": [],
            "reason": "test",
            "suggested_action": suggested_action,
            "recommended_policy": recommended_policy,
            "hard_block": decision == "block",
            "requires_human_confirmation": decision == "require_confirmation",
            "metadata": {},
            "detector_version": "test@0.4.0",
            "policy_version": "policy@0.1.0",
            **extras,
        }

    return _build


@pytest.fixture
def integration_url() -> str:
    """URL of a live Agent Spend Guard server, for @pytest.mark.integration tests."""
    return os.environ.get("AGENT_SPEND_GUARD_URL", "http://localhost:8080")


@pytest.fixture
def integration_api_key() -> str:
    return os.environ.get("AGENT_SPEND_GUARD_API_KEY", "asg_v1_demo")
