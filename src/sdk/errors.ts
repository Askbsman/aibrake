import type { SpendingGuardCheckOutput } from "../core/types.js";

export class SpendingGuardBlockedError extends Error {
  readonly result: SpendingGuardCheckOutput;
  constructor(result: SpendingGuardCheckOutput) {
    super(
      `Spending Guard blocked the action (pattern=${result.pattern}, reason=${result.reason})`
    );
    this.name = "SpendingGuardBlockedError";
    this.result = result;
  }
}

export class SpendingGuardConfirmationDeniedError extends Error {
  readonly result: SpendingGuardCheckOutput;
  constructor(result: SpendingGuardCheckOutput) {
    super(
      `Operator denied confirmation for Spending Guard result (pattern=${result.pattern})`
    );
    this.name = "SpendingGuardConfirmationDeniedError";
    this.result = result;
  }
}

// Stage 0.4.2 — typed errors so the SDK can discriminate transport failures
// (synthesize allow via failureMode) from validation / programmer errors
// (propagate to the caller so they fix their integration). Mirrors the
// Python 0.4.1 narrow-catch fix.

export interface SpendingGuardTransportErrorOptions {
  status?: number;
  cause?: unknown;
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
 */
export class SpendingGuardTransportError extends Error {
  readonly status: number | undefined;
  readonly cause: unknown;
  constructor(message: string, options: SpendingGuardTransportErrorOptions = {}) {
    super(message);
    this.name = "SpendingGuardTransportError";
    this.status = options.status;
    this.cause = options.cause;
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
 */
export class SpendingGuardValidationError extends Error {
  readonly status: number;
  readonly body: unknown;
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
  }
}
