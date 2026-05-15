// Stage 0.3 — typed env loader.
//
// All AGENT_SPEND_GUARD_* variables read once at process start (or per test).
// No magic strings inside route or middleware code — go through this module.

export type AuthMode = "optional" | "required";
export type LogSinkKind = "stdout" | "jsonl" | "none";

export interface EnvConfig {
  port: number;
  nodeEnv: string;

  authMode: AuthMode;
  apiKeys: ReadonlySet<string>;

  rateLimitPerKeyPerMin: number;

  logSink: LogSinkKind;
  logPath: string;

  serviceName: string;
  serviceVersion: string;
  publicUrl: string | undefined;
}

function parseList(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
}

function parseAuthMode(raw: string | undefined): AuthMode {
  if (raw === "required") return "required";
  return "optional";
}

function parseLogSink(raw: string | undefined): LogSinkKind {
  if (raw === "jsonl") return "jsonl";
  if (raw === "none") return "none";
  return "stdout";
}

function parseNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadEnvConfig(
  env: NodeJS.ProcessEnv = process.env
): EnvConfig {
  return {
    // Stage 0.3 default is 8080 to avoid local conflicts with Next/CRA/Rails
    // (port 3000 is the default everywhere). The harness uses
    // SPENDING_GUARD_URL override to point at whichever port is up.
    port: parseNumber(env.PORT, 8080),
    nodeEnv: env.NODE_ENV ?? "development",

    authMode: parseAuthMode(env.AGENT_SPEND_GUARD_AUTH_MODE),
    apiKeys: parseList(env.AGENT_SPEND_GUARD_API_KEYS),

    rateLimitPerKeyPerMin: parseNumber(
      env.AGENT_SPEND_GUARD_RATE_LIMIT_PER_KEY_PER_MIN,
      600
    ),

    logSink: parseLogSink(env.AGENT_SPEND_GUARD_LOG_SINK),
    logPath: env.AGENT_SPEND_GUARD_LOG_PATH ?? "./logs/decisions.jsonl",

    serviceName: env.AGENT_SPEND_GUARD_SERVICE_NAME ?? "agent-spend-guard",
    serviceVersion: "0.3.1-beta",
    publicUrl: env.AGENT_SPEND_GUARD_PUBLIC_URL,
  };
}
