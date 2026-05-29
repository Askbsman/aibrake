// Stage 0.3 — typed env loader.
//
// All AGENT_SPEND_GUARD_* variables read once at process start (or per test).
// No magic strings inside route or middleware code — go through this module.

export type AuthMode = "optional" | "required";
export type LogSinkKind = "stdout" | "jsonl" | "none";

export type X402Network = "base" | "base-sepolia";

export interface X402Config {
  enabled: boolean;
  network: X402Network;
  facilitatorUrl: string;
  payTo: string;
  priceCheckUsd: number;
}

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

  // Stage 0.7: x402 micropayments on Base. Off by default for backwards compat.
  // When enabled, mounts POST /x402/v1/check as a paid resource alongside the
  // free /v1/check (which keeps the Bearer-auth contract).
  x402: X402Config;
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

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return fallback;
}

function parseFloatPositive(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseX402Network(raw: string | undefined): X402Network {
  return raw === "base" ? "base" : "base-sepolia";
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
    serviceVersion: "0.7.0-beta",
    publicUrl: env.AGENT_SPEND_GUARD_PUBLIC_URL,

    x402: {
      enabled: parseBool(env.X402_ENABLED, false),
      network: parseX402Network(env.X402_NETWORK),
      facilitatorUrl:
        env.X402_FACILITATOR_URL?.trim() ||
        "https://x402.org/facilitator",
      payTo: env.X402_PAY_TO?.trim() ?? "",
      priceCheckUsd: parseFloatPositive(env.X402_PRICE_CHECK_USD, 0.001),
    },
  };
}
