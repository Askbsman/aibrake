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
