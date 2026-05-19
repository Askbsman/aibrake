// Per-process call-history tracker for the auto-patch.
//
// `aibrake/auto` can't see file reads, git diffs, or test runs the way
// a coding-agent adapter can. What it CAN see, deterministically:
//
//   - the model + provider being called
//   - a hash of the system prompt + first user message (the "objective"
//     in agent-speak — what the agent is trying to do)
//   - how many times we've called the same model on the same objective
//   - elapsed time between calls
//   - any error from the previous call (so we can flag failure_signal)
//
// That's enough to detect the canonical retry-storm: same model + same
// prompt + many attempts + recent errors. We don't catch evidence-aware
// patterns (those need the OpenClawAdapter). But we catch the worst
// offender — agents hammering one prompt with no feedback loop.

import { createHash } from "node:crypto";

export interface LoggedAttempt {
  objective_hash: string;        // hash(system + first_user_message)
  model: string;
  provider: "openai" | "anthropic" | "other";
  ts_ms: number;
  estimated_cost_usd: number;
  succeeded?: boolean;
  error_signature?: string;       // hash of error message if last call failed
}

const MAX_HISTORY = 200;

const history: LoggedAttempt[] = [];

export function recordAttempt(a: LoggedAttempt): void {
  history.push(a);
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

export function recentForObjective(objectiveHash: string): LoggedAttempt[] {
  // Last 60 minutes for the same objective_hash.
  const cutoff = Date.now() - 60 * 60_000;
  return history.filter(
    (h) => h.objective_hash === objectiveHash && h.ts_ms >= cutoff
  );
}

export function lastError(objectiveHash: string): LoggedAttempt | undefined {
  const recent = recentForObjective(objectiveHash);
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i]!.succeeded === false) return recent[i];
  }
  return undefined;
}

export function hashObjective(parts: Array<string | undefined | null>): string {
  const joined = parts.filter(Boolean).join("|");
  return createHash("sha256").update(joined).digest("hex").slice(0, 16);
}

export function hashError(msg: string): string {
  return createHash("sha256").update(msg).digest("hex").slice(0, 12);
}

export function clearHistory(): void {
  history.length = 0;
}

export function _historyForTests(): readonly LoggedAttempt[] {
  return history;
}
