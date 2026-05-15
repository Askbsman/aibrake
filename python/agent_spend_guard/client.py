"""AgentSpendGuard Python client — thin urllib-based HTTP wrapper.

Mirrors the four integration patterns of the TypeScript SDK:

  - check()              — returns the structured result; never throws on a
                            guard decision
  - check_shadow()       — same, but synthesizes allow on any guard outage
  - check_or_confirm()   — raises SpendingGuardBlockedError on block; calls
                            on_warn callback on warn / require_confirmation
  - check_or_downgrade() — auto-applies suggested_action.model_route.to if
                            present, falling back to a static downgrade_to

The client is intentionally synchronous and uses only stdlib. No requests,
no httpx, no aiohttp. Add async only when a real partner asks for it.

Type hints use plain `Dict[str, Any]` and `Any` because the upstream
`/v1/check` response is rapidly evolving and we do not want Python-side
TypedDicts to drift from the TS source of truth.
"""

from __future__ import annotations

import hashlib
import json
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, Literal, Optional, Tuple

from .errors import (
    SpendingGuardBlockedError,
    SpendingGuardClientError,
    SpendingGuardConfirmationDeniedError,
)

FailureMode = Literal["open", "closed", "throw"]
UncertainPolicy = Literal["allow_with_log", "ask_human", "run_deep_check", "throw"]

OnWarnCallback = Callable[[Dict[str, Any]], bool]

_DEFAULT_TIMEOUT_MS = 500
_POLICY_VERSION = "policy@0.1.0"


class AgentSpendGuard:
    """Synchronous HTTP client for the Agent Spend Guard API."""

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        timeout_ms: int = _DEFAULT_TIMEOUT_MS,
        failure_mode: FailureMode = "open",
        uncertain_policy: UncertainPolicy = "allow_with_log",
        on_failure_open: Optional[Callable[[Exception], None]] = None,
    ) -> None:
        if not base_url:
            raise SpendingGuardClientError("base_url is required")
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout_seconds = max(0.05, timeout_ms / 1000.0)
        self._failure_mode: FailureMode = failure_mode
        self._uncertain_policy: UncertainPolicy = uncertain_policy
        self._on_failure_open = on_failure_open

    # ── Public helpers ────────────────────────────────────────────────

    def check(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Call POST /v1/check. Returns the structured result.

        Never raises on a guard decision (allow / warn / block / ...).
        Raises only on local programmer errors or, with failure_mode="throw",
        on transport errors.
        """
        return self._invoke(payload)

    def check_shadow(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Same as check() but converts transport-level failures into a
        synthetic `allow` result — your agent stays online when the guard
        cannot be reached.

        Stage 0.4.1 fix: this method catches ONLY transport / network /
        service-availability errors. Programmer errors (malformed payload,
        JSON serialization failures, type errors) propagate normally —
        silently converting them into `decision: allow` would mask
        integration bugs and let agents run without the guardrail their
        operator thinks they have.

        Raised by this method:
          - TypeError / ValueError    — bad payload, programmer error
          - json.JSONDecodeError      — guard returned non-JSON
          - SpendingGuardClientError  — SDK-internal configuration error

        Caught and converted to synthetic allow:
          - urllib.error.URLError     — host unreachable, DNS failure
          - urllib.error.HTTPError    — 4xx/5xx (only when failure_mode="throw"
                                        causes _invoke to re-raise; otherwise
                                        _handle_failure already wraps)
          - TimeoutError              — request timed out
          - OSError                   — socket reset, connection refused, etc.
        """
        try:
            return self._invoke(payload)
        except (
            urllib.error.URLError,
            urllib.error.HTTPError,
            TimeoutError,
            OSError,
        ) as err:
            return _synthesize_failure_open(err)

    def check_or_confirm(
        self,
        payload: Dict[str, Any],
        on_warn: Optional[OnWarnCallback] = None,
    ) -> Dict[str, Any]:
        """Call /v1/check; on warn/require_confirmation invoke on_warn(result).

        - allow                  → return result
        - warn / require_confirm → on_warn(result); if returns False, raise
                                   SpendingGuardConfirmationDeniedError
        - delay                  → return result (no callback)
        - block                  → raise SpendingGuardBlockedError
        - uncertain              → apply uncertain_policy
        """
        result = self._invoke(payload)
        decision = result.get("decision")
        if decision == "allow":
            return result
        if decision in ("warn", "require_confirmation"):
            if on_warn is None:
                return result
            ok = on_warn(result)
            if not ok:
                raise SpendingGuardConfirmationDeniedError(result)
            return result
        if decision == "delay":
            return result
        if decision == "block":
            raise SpendingGuardBlockedError(result)
        if decision == "uncertain":
            return self._apply_uncertain_policy(result, on_warn)
        # Unknown decision — treat as allow but signal weirdness via the
        # synthetic error field so the caller can log it.
        result.setdefault("error", {"code": "UNKNOWN_DECISION", "message": str(decision)})
        return result

    def check_or_downgrade(
        self,
        payload: Dict[str, Any],
        downgrade_to: Dict[str, Any],
        on_warn: Optional[OnWarnCallback] = None,
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """Like check_or_confirm but on model-escalation warnings, return a
        downgraded next_action instead of asking for human confirmation.

        Returns (action, result). `action` is the (possibly downgraded)
        next_action dict — pass it to your agent's actual model call.
        `result` is the full structured guard response for logging.

        downgrade_to dict shape: { "provider"?: str, "model": str, "estimated_cost"?: float }
        """
        result = self._invoke(payload)
        decision = result.get("decision")
        next_action = payload.get("next_action", {})

        if decision == "allow":
            return next_action, result
        if decision in ("warn", "require_confirmation"):
            suggestion_type = (result.get("suggested_action") or {}).get("type")
            policy = result.get("recommended_policy")
            is_model_escalation = (
                result.get("pattern") == "model_escalation_without_evidence"
                or policy == "downgrade"
                or suggestion_type == "switch_model"
            )
            if is_model_escalation:
                # Prefer the structured model_route from the response.
                route_to = (
                    (result.get("suggested_action") or {})
                    .get("model_route", {})
                    .get("to", {})
                )
                downgraded = _apply_downgrade(
                    next_action,
                    provider=route_to.get("provider") or downgrade_to.get("provider"),
                    model=route_to.get("model") or downgrade_to.get("model"),
                    estimated_cost=downgrade_to.get("estimated_cost"),
                )
                return downgraded, result
            if on_warn is not None:
                ok = on_warn(result)
                if not ok:
                    raise SpendingGuardConfirmationDeniedError(result)
            return next_action, result
        if decision == "delay":
            return next_action, result
        if decision == "block":
            raise SpendingGuardBlockedError(result)
        if decision == "uncertain":
            self._apply_uncertain_policy(result, on_warn)
            return next_action, result
        return next_action, result

    # ── Internals ─────────────────────────────────────────────────────

    def _invoke(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        headers = {
            "content-type": "application/json",
            "accept": "application/json",
        }
        if self._api_key:
            headers["authorization"] = f"Bearer {self._api_key}"
        req = urllib.request.Request(
            f"{self._base_url}/v1/check",
            data=body,
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self._timeout_seconds) as resp:
                raw = resp.read()
                return json.loads(raw)
        except urllib.error.HTTPError as err:
            return self._handle_failure(err)
        except urllib.error.URLError as err:
            return self._handle_failure(err)
        except (TimeoutError, OSError) as err:
            return self._handle_failure(err)

    def _handle_failure(self, err: Exception) -> Dict[str, Any]:
        if self._failure_mode == "throw":
            raise err
        if self._on_failure_open is not None:
            try:
                self._on_failure_open(err)
            except Exception:  # noqa: BLE001 — on_failure_open must not break us
                pass
        if self._failure_mode == "closed":
            return _synthesize_failure_closed(err)
        return _synthesize_failure_open(err)

    def _apply_uncertain_policy(
        self,
        result: Dict[str, Any],
        on_warn: Optional[OnWarnCallback],
    ) -> Dict[str, Any]:
        policy = self._uncertain_policy
        if policy == "allow_with_log":
            return result
        if policy == "ask_human":
            if on_warn is None:
                return result
            ok = on_warn(result)
            if not ok:
                raise SpendingGuardConfirmationDeniedError(result)
            return result
        if policy == "run_deep_check":
            # SDK fallback: deep check is server-side, not auto-called from
            # the client. Operators wire it explicitly if they want.
            return result
        if policy == "throw":
            raise SpendingGuardConfirmationDeniedError(result)
        return result


# ── Helpers ──────────────────────────────────────────────────────────────


def _apply_downgrade(
    original: Dict[str, Any],
    provider: Optional[str],
    model: Optional[str],
    estimated_cost: Optional[float],
) -> Dict[str, Any]:
    out = dict(original)
    if provider is not None:
        out["provider"] = provider
    if model is not None:
        out["model"] = model
    if estimated_cost is not None:
        currency = (original.get("estimated_cost") or {}).get("currency", "USD")
        out["estimated_cost"] = {"amount": float(estimated_cost), "currency": currency}
    return out


def _synthesize_failure_open(err: Exception) -> Dict[str, Any]:
    return {
        "decision": "allow",
        "risk_score": 0,
        "risk_level": "low",
        "confidence": 0,
        "pattern": "guard_unavailable",
        "matched_rules": [],
        "reason": "Spending Guard was unavailable. Failing open by default.",
        "suggested_action": {
            "type": "continue_with_log",
            "message": "Guard unavailable; SDK failing open. Log this event.",
        },
        "recommended_policy": "log_only",
        "hard_block": False,
        "requires_human_confirmation": False,
        "metadata": {"failure_mode": "open"},
        "detector_version": "guard_unavailable@0.1.0",
        "policy_version": _POLICY_VERSION,
        "error": {"code": "GUARD_UNAVAILABLE", "message": str(err)},
    }


def _synthesize_failure_closed(err: Exception) -> Dict[str, Any]:
    return {
        "decision": "block",
        "risk_score": 100,
        "risk_level": "critical",
        "confidence": 0,
        "pattern": "guard_unavailable",
        "matched_rules": [],
        "reason": "Spending Guard was unavailable. Failing closed by configuration.",
        "suggested_action": {
            "type": "stop_action",
            "message": "Guard unavailable; SDK configured to fail closed. Stop the action.",
        },
        "recommended_policy": "stop_action",
        "hard_block": True,
        "requires_human_confirmation": False,
        "metadata": {"failure_mode": "closed"},
        "detector_version": "guard_unavailable@0.1.0",
        "policy_version": _POLICY_VERSION,
        "error": {"code": "GUARD_UNAVAILABLE", "message": str(err)},
    }


def hash_api_key(key: str) -> str:
    """Mirror of the server-side hashApiKey() — useful for partners who want
    to correlate their own logs with the guard's decision logs without
    keeping the raw key in their pipeline."""
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    return f"key_v1_{digest}"
