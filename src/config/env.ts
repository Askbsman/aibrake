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
  // CDP facilitator credentials. When the facilitatorUrl points at
  // `api.cdp.coinbase.com`, every /verify and /settle call must be
  // authenticated with a JWT signed by these creds. Optional: when unset,
  // the middleware falls back to unauthenticated calls — fine for free
  // facilitators (x402.org/facilitator) but rejected by CDP with 401.
  cdpApiKeyId: string | undefined;
  cdpApiKeySecret: string | undefined;
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

// Transparent override: when X402_FACILITATOR_URL is empty or points at
// a facilitator that doesn't currently route Base mainnet exact-v2
// payments (CDP and x402.org both return "No facilitator registered
// for scheme: exact and network: eip155:8453" as of 2026-05-30), route
// through xpay — the public no-auth facilitator bsman-ai uses in
// production. xpay.sh /supported declares
//   { x402Version:2, scheme:"exact", network:"eip155:8453" }
// and works end-to-end with agentcash on Base mainnet USDC.
function rewriteFacilitatorUrl(raw: string | undefined): string {
  const XPAY = "https://facilitator.xpay.sh";
  if (!raw || raw.length === 0) return XPAY;
  try {
    const host = new URL(raw).hostname;
    if (host.endsWith("cdp.coinbase.com")) return XPAY;
    if (host.endsWith("x402.org")) return XPAY;
  } catch {
    return XPAY;
  }
  return raw;
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
    serviceVersion: "0.7.2-beta",
    publicUrl: env.AGENT_SPEND_GUARD_PUBLIC_URL,

    x402: {
      enabled: parseBool(env.X402_ENABLED, false),
      network: parseX402Network(env.X402_NETWORK),
      // CDP /verify currently returns "No facilitator registered for
      // scheme:exact + network:eip155:8453" (upstream Coinbase issue,
      // 2026-05-30). Until that's resolved we transparently rewrite
      // CDP URLs to www.x402.org/facilitator — a public free facilitator
      // that supports x402Version:2 exact-scheme + Base mainnet. Removing
      // this override is a 1-line code change once CDP routing is fixed.
      facilitatorUrl: rewriteFacilitatorUrl(env.X402_FACILITATOR_URL?.trim()),
      payTo: env.X402_PAY_TO?.trim() ?? "",
      priceCheckUsd: parseFloatPositive(env.X402_PRICE_CHECK_USD, 0.001),
      cdpApiKeyId: env.CDP_API_KEY_ID?.trim() || undefined,
      cdpApiKeySecret: env.CDP_API_KEY_SECRET?.trim() || undefined,
    },
  };
}
