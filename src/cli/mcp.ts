// AIBrake MCP server.
//
// Speaks the Model Context Protocol (MCP) over stdio. Any MCP-capable
// agent runtime (Claude Code, OpenClaw, Cursor, Cline, ...) can register
// AIBrake as a tool with four config lines:
//
//     {
//       "mcpServers": {
//         "aibrake": { "command": "npx", "args": ["-y", "aibrake@beta", "mcp"] }
//       }
//     }
//
// After that the agent has an `aibrake_check` tool it can (and should)
// call before any expensive action. The tool runs AIBrake's stateless
// Core in-process — no hosted API key required for basic use.
//
// Protocol: JSON-RPC 2.0 over newline-delimited stdin/stdout
// (the MCP stdio transport). We implement the four methods Claude
// Code expects: `initialize`, `notifications/initialized`,
// `tools/list`, `tools/call`. No vendor SDK dependency.

import { runCheck } from "../core/check.js";
import type { SpendingGuardCheckInput } from "../core/types.js";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "aibrake";
const SERVER_VERSION = "0.7.0-beta";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

// ─────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "aibrake_check",
    description:
      "MUST be called BEFORE any expensive or potentially-looping action: " +
      "paid LLM calls (especially retries), file deploys, process restarts, " +
      "package installs, or any 'task complete / deployed / fixed' assertion. " +
      "Returns a decision (allow / warn / require_confirmation / block) plus " +
      "a reason and a projected $-savings estimate. If decision is " +
      "require_confirmation or block, you MUST stop and surface the reason " +
      "to the user — do not retry the action without new evidence.",
    inputSchema: {
      type: "object",
      properties: {
        action_type: {
          type: "string",
          description:
            "What is the agent about to do? Use one of: paid_llm_call, " +
            "deployment_assertion, install_assertion, restart_assertion, " +
            "fix_assertion, success_assertion, task_complete. Default: paid_llm_call.",
        },
        model: {
          type: "string",
          description:
            "For paid_llm_call: the model name (e.g. claude-opus-4.7, gpt-4o). " +
            "Used for cost estimation and escalation detection.",
        },
        estimated_cost_usd: {
          type: "number",
          description: "Estimated $-cost of the action. For LLM calls, use the model's $/1k-token price × estimated tokens.",
        },
        reason: {
          type: "string",
          description: "One-sentence description of WHY the agent is doing this action.",
        },
        prior_attempts_on_same_failure: {
          type: "number",
          description:
            "How many times the agent has already tried this same thing and failed in this session. " +
            "If 0, this is the first attempt. If 3+, it's a retry storm signal.",
        },
        failure_signal_present: {
          type: "boolean",
          description: "Did the previous attempt fail with an error / exception / failed test?",
        },
        new_evidence_since_last_attempt: {
          type: "boolean",
          description:
            "Has the agent read new files, run new tests, checked new logs, " +
            "or otherwise gathered new context since the last attempt? If retrying " +
            "without new evidence, AIBrake will flag a retry-storm pattern.",
        },
        verifications_done: {
          type: "array",
          items: { type: "string" },
          description:
            "For *_assertion action types: which verifications has the agent run? " +
            "Valid values: process_status_checked, endpoint_curled, health_check_run, " +
            "logs_read_after_action, tests_run_after_action, file_re_read_after_edit, " +
            "git_diff_verified, smoke_test_passed. If empty for a deploy/restart assertion, " +
            "AIBrake will block.",
        },
        budget_cap_usd: {
          type: "number",
          description:
            "Hard or soft budget cap in USD for the current objective. When set, " +
            "the task_budget_breach detector compares (spent_on_objective_usd + " +
            "estimated_cost_usd) against this cap. If omitted, AIBrake uses a " +
            "permissive default of $50 (effectively dormant) — pass an actual " +
            "budget so the detector can protect you.",
        },
        budget_hard_limit: {
          type: "boolean",
          description:
            "If true and the budget would be breached, AIBrake deterministically " +
            "BLOCKS the action (returns decision: 'block'). If false (default), it " +
            "warns or requires confirmation. Use true for production-grade budget " +
            "guardrails; false for early experimentation.",
        },
        spent_on_objective_usd: {
          type: "number",
          description:
            "How much the agent has ALREADY spent on this objective in this " +
            "session, in USD. Used together with estimated_cost_usd to project " +
            "the post-action total against budget_cap_usd. If omitted, AIBrake " +
            "approximates as prior_attempts × estimated_cost.",
        },
      },
      required: ["action_type", "reason"],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Tool execution
// ─────────────────────────────────────────────────────────────────────────

function runAibrakeCheck(args: any): {
  decision: string;
  risk_score: number;
  pattern: string;
  reason: string;
  projected_savings_usd?: number;
  matched_rules: string[];
  suggested_action: string;
} {
  const actionType = args.action_type ?? "paid_llm_call";
  const model = args.model;
  const cost = args.estimated_cost_usd ?? 0;
  const prior = args.prior_attempts_on_same_failure ?? 0;
  const failurePresent = args.failure_signal_present ?? false;
  const newEvidence = args.new_evidence_since_last_attempt;
  const verifications: string[] = Array.isArray(args.verifications_done)
    ? args.verifications_done
    : [];
  // Budget cap: if caller passes one, honour it; else permissive $50 default
  // (effectively dormant — task_budget_breach detector can't fire usefully).
  const budgetCap = typeof args.budget_cap_usd === "number" && args.budget_cap_usd > 0
    ? args.budget_cap_usd
    : 50;
  const budgetHardLimit = args.budget_hard_limit === true;
  // Spent-on-objective: if caller passes one, honour it; else approximate as
  // prior_attempts × estimated_cost (covers the simple "I retried N times"
  // case without making the agent track running totals itself).
  const spentOnObjective = typeof args.spent_on_objective_usd === "number"
    ? args.spent_on_objective_usd
    : prior * cost;

  // Build verification evidence map for assertion-shaped actions
  const verificationKeys = [
    "process_status_checked",
    "endpoint_curled",
    "health_check_run",
    "logs_read_after_action",
    "tests_run_after_action",
    "file_re_read_after_edit",
    "git_diff_verified",
    "smoke_test_passed",
  ];
  const evidenceSignals: Record<string, any> = {};
  for (const key of verificationKeys) {
    evidenceSignals[key] = verifications.includes(key);
  }
  // Also include LLM-call evidence keys (always 0/false for MCP-driven calls
  // since the agent doesn't pass them — that's honest telemetry).
  evidenceSignals["files_read_since_last_attempt"] = 0;
  evidenceSignals["tests_run_since_last_attempt"] = 0;
  evidenceSignals["logs_read_since_last_attempt"] = 0;
  evidenceSignals["git_diff_changed_since_last_attempt"] = false;
  evidenceSignals["context_source_confirmed"] = false;

  const input: SpendingGuardCheckInput = {
    actor: {
      type: "agent",
      runtime: "mcp",
      id: `mcp-${process.pid}`,
    },
    objective: {
      id: "mcp_session",
      goal: args.reason,
      budget: { amount: budgetCap, currency: "USD", hard_limit: budgetHardLimit },
      success_criteria: [],
      max_paid_attempts: 20,
      allowed_actions: [actionType],
      blocked_actions: [],
    },
    next_action: {
      type: actionType,
      provider: model && model.startsWith("claude") ? "anthropic" : model ? "openai" : undefined,
      model,
      estimated_cost: { amount: cost, currency: "USD" },
      reason: args.reason,
    },
    history: {
      attempt_number: prior + 1,
      same_action_count: prior,
      paid_attempts_on_same_failure: prior,
      failure_signal_present: failurePresent,
      failure_signal_type: failurePresent ? "exception" : undefined,
      failure_fingerprint: failurePresent ? `fp_v1_${actionType}` : undefined,
      same_failure_count: prior,
      new_evidence_since_last_attempt:
        newEvidence === undefined ? null : newEvidence,
      evidence_kind: "code",
      evidence_signals: evidenceSignals,
      confidence_delta: newEvidence ? 0.1 : 0,
    },
    spend: {
      spent_on_objective: { amount: spentOnObjective, currency: "USD" },
    },
    telemetry_quality: { completeness: "medium" },
  };

  const out = runCheck(input, { emitLog: false });

  // Fire-and-forget hosted forwarding. If AIBRAKE_API_KEY is set, POST the
  // same input to api.aibrake.dev/v1/check so the hosted decision log
  // captures the call and /v1/public/stats counter increments. We do NOT
  // await it — the agent gets its decision from the in-process Core
  // immediately, the hosted call is best-effort observability. Failures
  // are logged to stderr but never propagate (the agent must not block
  // on AIBrake's own telemetry).
  forwardToHosted(input).catch((err) => {
    process.stderr.write(
      `[aibrake mcp] hosted forward failed (non-fatal): ${err?.message ?? err}\n`
    );
  });

  return {
    decision: out.decision,
    risk_score: out.risk_score,
    pattern: out.pattern,
    reason: out.reason,
    projected_savings_usd: out.projected_savings?.amount_usd,
    matched_rules: out.matched_rules,
    suggested_action: out.suggested_action.type,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Hosted-API forwarder (best-effort, non-blocking)
// ─────────────────────────────────────────────────────────────────────────

async function forwardToHosted(input: SpendingGuardCheckInput): Promise<void> {
  const apiKey =
    process.env.AIBRAKE_API_KEY ?? process.env.AGENT_SPEND_GUARD_API_KEY;
  if (!apiKey) return; // No key → no hosted log, local Core decision only.

  const baseUrl =
    process.env.AIBRAKE_URL ??
    process.env.AGENT_SPEND_GUARD_URL ??
    "https://api.aibrake.dev";

  if (typeof fetch !== "function") return; // Node <18 — skip silently.

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    await fetch(`${baseUrl}/v1/check`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "x-aibrake-source": "mcp-server",
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    // We don't even read the response — the local Core already produced the
    // canonical decision. The POST is purely for hosted-side logging.
  } finally {
    clearTimeout(timeout);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// JSON-RPC dispatcher
// ─────────────────────────────────────────────────────────────────────────

function handleRequest(req: JsonRpcRequest): JsonRpcResponse | null {
  switch (req.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id: req.id!,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      };

    case "notifications/initialized":
      // Notification — no response.
      return null;

    case "tools/list":
      return { jsonrpc: "2.0", id: req.id!, result: { tools: TOOLS } };

    case "tools/call": {
      const name = req.params?.name;
      const args = req.params?.arguments ?? {};
      if (name === "aibrake_check") {
        try {
          const result = runAibrakeCheck(args);
          return {
            jsonrpc: "2.0",
            id: req.id!,
            result: {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            },
          };
        } catch (err) {
          return {
            jsonrpc: "2.0",
            id: req.id!,
            error: {
              code: -32000,
              message: `aibrake_check failed: ${(err as Error).message}`,
            },
          };
        }
      }
      return {
        jsonrpc: "2.0",
        id: req.id!,
        error: { code: -32601, message: `Unknown tool: ${name}` },
      };
    }

    default:
      if (req.id === undefined) return null; // notification
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Stdio loop
// ─────────────────────────────────────────────────────────────────────────

export function runMcpServer(): void {
  // Anything written to stderr goes to the agent's MCP log — useful for
  // partners to see AIBrake is alive. stdout is reserved for JSON-RPC.
  process.stderr.write(
    `[aibrake mcp] server started (protocol ${PROTOCOL_VERSION}, version ${SERVER_VERSION})\n`
  );

  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const req = JSON.parse(line) as JsonRpcRequest;
        const res = handleRequest(req);
        if (res) process.stdout.write(JSON.stringify(res) + "\n");
      } catch (err) {
        process.stderr.write(
          `[aibrake mcp] failed to parse line: ${(err as Error).message}\n`
        );
      }
    }
  });

  process.stdin.on("end", () => {
    process.stderr.write("[aibrake mcp] stdin closed, exiting\n");
    process.exit(0);
  });
}
