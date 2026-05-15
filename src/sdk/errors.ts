import type { SpendingGuardCheckOutput } from "../core/types.js";

// Stage 0.5: structured `details` on every SDK error so partners can branch on
// `err.details.kind` / `err.details.retryable` instead of `instanceof` walls.
// The TS error class hierarchy stays the same — we only added a uniform
// `details` shape on each subclass.

export type SpendingGuardErrorKind =
  | "transport"
  | "validation"
  | "http_4xx"
  | "http_5xx"
  | "serialization"
  | "parse"
  | "blocked"
  | "confirmation_denied"
  | "unknown";

export interface SpendingGuardErrorDetails {
  kind: SpendingGuardErrorKind;
  statusCode?: number;
  code?: string;
  requestId?: string;
  retryable?: boolean;
  message?: string;
}

export class SpendingGuardBlockedError extends Error {
  readonly result: SpendingGuardCheckOutput;
  readonly details: SpendingGuardErrorDetails;
  constructor(result: SpendingGuardCheckOutput) {
    super(
      `Spending Guard blocked the action (pattern=${result.pattern}, reason=${result.reason})`
    );
    this.name = "SpendingGuardBlockedError";
    this.result = result;
    this.details = {
      kind: "blocked",
      retryable: false,
      code: result.error?.code,
      message: result.reason,
    };
  }
}

export class SpendingGuardConfirmationDeniedError extends Error {
  readonly result: SpendingGuardCheckOutput;
  readonly details: SpendingGuardErrorDetails;
  constructor(result: SpendingGuardCheckOutput) {
    super(
      `Operator denied confirmation for Spending Guard result (pattern=${result.pattern})`
    );
    this.name = "SpendingGuardConfirmationDeniedError";
    this.result = result;
    this.details = {
      kind: "confirmation_denied",
      retryable: false,
      code: result.error?.code,
      message: result.reason,
    };
  }
}

// Stage 0.4.2 — typed errors so the SDK can discriminate transport failures
// (synthesize allow via failureMode) from validation / programmer errors
// (propagate to the caller so they fix their integration). Mirrors the
// Python 0.4.1 narrow-catch fix.

export interface SpendingGuardTransportErrorOptions {
  status?: number;
  cause?: unknown;
  requestId?: string;
}

/**
 * Marker class for guard-unavailability errors:
 *   - 5xx responses
 *   - DNS / connection refused / connection reset
 *   - request timeout (AbortError)
 *
 * SDK's `invoke()` catches this and routes through `failureMode`
 * ("open" → synthetic allow, "closed" → synthetic block, "throw" → re-throw).
 *
 * Custom fetchers (used in tests or for special transports) should throw this
 * class to signal "the guard was unreachable — apply the failure mode."
 *
 * Stage 0.5: `details.kind` is "transport" for network/timeout errors and
 * "http_5xx" for 5xx responses; `details.retryable` is always true.
 */
export class SpendingGuardTransportError extends Error {
  readonly status: number | undefined;
  readonly cause: unknown;
  readonly details: SpendingGuardErrorDetails;
  constructor(message: string, options: SpendingGuardTransportErrorOptions = {}) {
    super(message);
    this.name = "SpendingGuardTransportError";
    this.status = options.status;
    this.cause = options.cause;
    const isHttp5xx =
      typeof options.status === "number" && options.status >= 500 && options.status < 600;
    this.details = {
      kind: isHttp5xx ? "http_5xx" : "transport",
      statusCode: options.status,
      retryable: true,
      message,
      requestId: options.requestId,
    };
  }
}

/**
 * Server returned a 4xx — the partner's payload (or auth) is wrong. This is
 * NOT a guard-unavailable situation; the guard saw the request and rejected
 * it. The SDK propagates this so the partner fixes their integration instead
 * of silently getting `decision: allow, pattern: guard_unavailable`.
 *
 * `.body` carries the parsed JSON response body (typically
 * `{ error: { code: "VALIDATION_ERROR", message, details } }` for /v1/check).
 *
 * Stage 0.5:
 *   - status 400 → details.kind = "validation"
 *   - status 401/403/404/etc. → details.kind = "http_4xx"
 *   - status 429 → details.kind = "http_4xx" with retryable = true
 *   - retryable defaults to false for all other 4xx
 */
export class SpendingGuardValidationError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly details: SpendingGuardErrorDetails;
  constructor(status: number, body: unknown, message?: string) {
    const codeMessage =
      typeof body === "object" && body !== null && "error" in body
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ` — ${(body as any).error?.code ?? "unknown"}`
        : "";
    super(message ?? `Spending Guard rejected payload (HTTP ${status})${codeMessage}`);
    this.name = "SpendingGuardValidationError";
    this.status = status;
    this.body = body;
    const code =
      typeof body === "object" && body !== null && "error" in body
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((body as any).error?.code as string | undefined)
        : undefined;
    const kind: SpendingGuardErrorKind = status === 400 ? "validation" : "http_4xx";
    this.details = {
      kind,
      statusCode: status,
      code,
      retryable: status === 429,
      message: this.message,
    };
  }
}
