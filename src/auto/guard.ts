// Lazy SpendingGuard instance for the auto-patch. Reads config from env.
//
// Reads AIBRAKE_* prefer-first, falls back to AGENT_SPEND_GUARD_* for
// partners on the preservation-contract aliases.

import { SpendingGuard } from "../sdk/client.js";
import type { FailureMode, SpendingGuardClientOptions } from "../sdk/client.js";

let _guard: SpendingGuard | null = null;

function readEnv(key: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  return process.env[key];
}

export function getGuard(): SpendingGuard {
  if (_guard) return _guard;

  const apiKey =
    readEnv("AIBRAKE_API_KEY") ?? readEnv("AGENT_SPEND_GUARD_API_KEY");
  const baseUrl =
    readEnv("AIBRAKE_URL") ??
    readEnv("AGENT_SPEND_GUARD_URL") ??
    "https://api.aibrake.dev";
  const failureMode = (readEnv("AIBRAKE_FAILURE_MODE") ??
    "open") as FailureMode;
  const timeoutMs = parseInt(readEnv("AIBRAKE_TIMEOUT_MS") ?? "800", 10);

  const opts: SpendingGuardClientOptions = {
    baseUrl,
    timeoutMs,
    failureMode,
  };
  if (apiKey) opts.apiKey = apiKey;
  // If no apiKey is provided, the SDK falls back to in-process runCheck,
  // which still gives useful decisions (just no hosted decision log).

  _guard = new SpendingGuard(opts);
  return _guard;
}

export function resetGuardForTests(): void {
  _guard = null;
}

export function modeFromEnv(): "shadow" | "hard" {
  const m = readEnv("AIBRAKE_MODE")?.toLowerCase();
  return m === "hard" || m === "enforce" ? "hard" : "shadow";
}
