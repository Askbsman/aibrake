"""Exceptions raised by the AIBrake Python client.

Stage 0.5 — every error exposes the same structured attributes the
TypeScript SDK exposes on `err.details`:

    err.kind          : str         — discriminator: transport / validation /
                                       http_4xx / http_5xx / serialization /
                                       parse / blocked / confirmation_denied /
                                       unknown
    err.status_code   : int | None  — HTTP status when applicable
    err.retryable     : bool        — operator hint: safe to retry?

This lets partners write a single `except SpendingGuardError as err:` handler
and branch on `err.kind` instead of importing every subclass.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

# Discriminator literal values (kept loose `str` so consumers can compare to
# string literals without importing an enum).
SpendingGuardErrorKind = str  # one of the constants below

KIND_TRANSPORT = "transport"
KIND_VALIDATION = "validation"
KIND_HTTP_4XX = "http_4xx"
KIND_HTTP_5XX = "http_5xx"
KIND_SERIALIZATION = "serialization"
KIND_PARSE = "parse"
KIND_BLOCKED = "blocked"
KIND_CONFIRMATION_DENIED = "confirmation_denied"
KIND_UNKNOWN = "unknown"


class SpendingGuardError(Exception):
    """Base class for all AIBrake SDK errors.

    Exposes three structured attributes — `kind`, `status_code`, `retryable`
    — that mirror `err.details.{kind,statusCode,retryable}` on the TS SDK.
    Partners should branch on `err.kind` rather than on `isinstance(...)`.
    """

    def __init__(
        self,
        message: str = "",
        *,
        kind: SpendingGuardErrorKind = KIND_UNKNOWN,
        status_code: Optional[int] = None,
        retryable: bool = False,
        code: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.kind: SpendingGuardErrorKind = kind
        self.status_code: Optional[int] = status_code
        self.retryable: bool = retryable
        self.code: Optional[str] = code


# Back-compat alias — the 0.4.x docs and tests imported this name.
SpendingGuardClientError = SpendingGuardError


class SpendingGuardTransportError(SpendingGuardError):
    """Network / DNS / connection / timeout / 5xx failure.

    `kind == "transport"` for network-class errors,
    `kind == "http_5xx"` for 5xx responses. Always retryable.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        cause: Optional[BaseException] = None,
    ) -> None:
        is_http_5xx = status_code is not None and 500 <= status_code < 600
        super().__init__(
            message,
            kind=KIND_HTTP_5XX if is_http_5xx else KIND_TRANSPORT,
            status_code=status_code,
            retryable=True,
        )
        self.cause: Optional[BaseException] = cause


class SpendingGuardValidationError(SpendingGuardError):
    """Server returned a 4xx — payload/auth was wrong. Propagates by design.

    `kind == "validation"` for HTTP 400; `kind == "http_4xx"` for the rest.
    Only HTTP 429 is marked retryable.
    """

    def __init__(
        self,
        status_code: int,
        body: Any,
        message: Optional[str] = None,
    ) -> None:
        code: Optional[str] = None
        if isinstance(body, dict):
            err = body.get("error")
            if isinstance(err, dict):
                code = err.get("code")
        kind = KIND_VALIDATION if status_code == 400 else KIND_HTTP_4XX
        super().__init__(
            message
            or f"Spending Guard rejected payload (HTTP {status_code} — {code or 'unknown'})",
            kind=kind,
            status_code=status_code,
            retryable=status_code == 429,
            code=code,
        )
        self.body: Any = body


class SpendingGuardBlockedError(SpendingGuardError):
    """Raised by check_or_confirm / check_or_downgrade when the guard
    returns decision: "block".

    The full structured result is available on the .result attribute so
    callers can read pattern / reason / suggested_action and surface them
    to the user.
    """

    def __init__(self, result: Dict[str, Any]) -> None:
        pattern = result.get("pattern", "unknown")
        reason = result.get("reason", "")
        code = (result.get("error") or {}).get("code")
        super().__init__(
            f"Spending Guard blocked the action (pattern={pattern}, reason={reason})",
            kind=KIND_BLOCKED,
            retryable=False,
            code=code,
        )
        self.result: Dict[str, Any] = result


class SpendingGuardConfirmationDeniedError(SpendingGuardError):
    """Raised by check_or_confirm when the on_warn callback returned False.

    Used so operators can distinguish "guard said maybe and the human said
    no" from "guard said block."
    """

    def __init__(self, result: Dict[str, Any]) -> None:
        pattern = result.get("pattern", "unknown")
        code = (result.get("error") or {}).get("code")
        super().__init__(
            f"Operator denied confirmation for Spending Guard result (pattern={pattern})",
            kind=KIND_CONFIRMATION_DENIED,
            retryable=False,
            code=code,
        )
        self.result: Dict[str, Any] = result
