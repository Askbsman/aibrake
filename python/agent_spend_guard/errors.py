"""Exceptions raised by the Agent Spend Guard Python client."""

from __future__ import annotations

from typing import Any, Dict


class SpendingGuardClientError(Exception):
    """Base class for all Agent Spend Guard client errors.

    Local programmer errors (bad config, invalid arguments) raise the base
    class. Decision-driven errors (block / confirmation denied) raise the
    specific subclasses below.
    """


class SpendingGuardBlockedError(SpendingGuardClientError):
    """Raised by check_or_confirm / check_or_downgrade when the guard
    returns decision: "block".

    The full structured result is available on the .result attribute so
    callers can read pattern / reason / suggested_action and surface them
    to the user.
    """

    def __init__(self, result: Dict[str, Any]) -> None:
        self.result = result
        pattern = result.get("pattern", "unknown")
        reason = result.get("reason", "")
        super().__init__(
            f"Spending Guard blocked the action (pattern={pattern}, reason={reason})"
        )


class SpendingGuardConfirmationDeniedError(SpendingGuardClientError):
    """Raised by check_or_confirm when the on_warn callback returned False.

    Used so operators can distinguish "guard said maybe and the human said
    no" from "guard said block."
    """

    def __init__(self, result: Dict[str, Any]) -> None:
        self.result = result
        pattern = result.get("pattern", "unknown")
        super().__init__(
            f"Operator denied confirmation for Spending Guard result (pattern={pattern})"
        )
