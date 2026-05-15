// Stage 0.4 — Coding-Agent Adapter.
//
// This module is intentionally a thin re-export of OpenClawAdapter. The
// universal evidence model (Stage 0.2-minimal) means the adapter logic for
// coding-agent runtimes — Claude Code, Codex, Cursor, custom wrappers — is
// the same. What differs between runtimes is how lifecycle events translate
// into AgentActionTelemetry; that translation belongs in operator code
// (see examples/coding-agent-integration.ts) or in a future runtime-specific
// translator, not in another adapter implementation.
//
// Naming rationale: partners running Claude Code / Codex / Cursor expect to
// `import { CodingAgentAdapter } from "spending-guard/adapters/coding-agent"`
// rather than `OpenClawAdapter`, which is a placeholder name from the
// Stage 0.1 spec. Both exports point at the same class so existing 0.1.x
// imports keep working.

export {
  OpenClawAdapter as CodingAgentAdapter,
  // Original name is preserved for backward compatibility with 0.1.x callers.
  OpenClawAdapter,
  actionFp,
  evidenceFp,
  failureFp,
} from "../openclaw/index.js";

export type {
  AgentActionTelemetry,
  ObjectiveDescriptor,
  SpendDescriptor,
} from "../openclaw/index.js";
