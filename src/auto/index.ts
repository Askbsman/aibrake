// aibrake/auto — drop-in monkey-patch for OpenAI / Anthropic SDKs.
//
// Usage (one line, anywhere before your LLM calls happen):
//
//     import "aibrake/auto";
//
//     // Your existing code, unchanged:
//     import OpenAI from "openai";
//     const client = new OpenAI();
//     await client.chat.completions.create({ ... });
//
// Every `chat.completions.create` (OpenAI) and `messages.create`
// (Anthropic) call now passes through AIBrake first. Decisions print
// to stderr; in shadow mode (default) the call always proceeds.
//
// Configuration via env vars (all optional):
//
//   AIBRAKE_API_KEY      Beta key. Without it we still run an in-process
//                        check — useful but no hosted decision log.
//   AIBRAKE_URL          Default https://api.aibrake.dev
//   AIBRAKE_MODE         "shadow" (default) | "hard"
//                        Hard mode throws on block / require_confirmation.
//   AIBRAKE_FAILURE_MODE "open" (default) | "closed" | "throw"
//                        How the SDK reacts to a guard outage.
//   AIBRAKE_TIMEOUT_MS   Default 800.
//
// Backwards-compatible aliases (rebrand contract): AGENT_SPEND_GUARD_*
// env vars are read if AIBRAKE_* are absent.

import { bootstrap } from "./patch.js";

// Top-level side effect: patch whatever LLM SDKs are present.
// Top-level await is fine in ESM — `import 'aibrake/auto'` will wait
// for the patches to install before returning.
await bootstrap();

// Re-export the patcher entry points so power-users can patch lazily
// (e.g. after dynamic SDK install).
export { patchOpenAI, patchAnthropic, bootstrap } from "./patch.js";
export { recordAttempt, clearHistory, _historyForTests } from "./history.js";
