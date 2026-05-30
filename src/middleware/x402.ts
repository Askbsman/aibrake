// x402 micropayment middleware for Fastify routes — bazar-compatible.
//
// Pattern + protocol shape mirrored from bsman-ai (callbsman.com)
// `src/middleware/x402.ts`. Same x402Version (2), same CAIP-2 network
// identifiers, same PaymentRequiredBody structure. Bsman-ai uses the
// official @x402 SDK; we re-implement the server-side primitives on
// top of fetch() to keep AIBrake free of @x402 deps. Wire-compatibility
// is what matters for the bazar crawler — we match that.
//
// Bsman-ai PaymentRequiredBody fields covered:
//   - x402Version: 2
//   - error
//   - resource { url, description, mimeType }
//   - accepts[]: { scheme, network (CAIP-2), amount, asset, payTo, maxTimeoutSeconds, extra }
//   - extensions (bazaar discovery payload — schema, examples)
//   - compatibility { paymentRequiredHeader, headerIsCanonical, hint }
//   - resourceUrl, method, endpoint
//   - payment { protocol, network, networkId, price, facilitator }
//   - metadata (bazaar listing fields)
//
// USDC contract addresses per network are inlined from the canonical
// Coinbase USDC deployment list; the facilitator will reject any payment
// to a wrong contract so the bazar crawler can rely on these as ground
// truth.

import type { FastifyReply, FastifyRequest } from "fastify";
import type { X402Config } from "../config/env.js";
import {
  bazaarDiscoveryMetadata,
  bazaarTags,
  checkRequestExample,
  checkRequestDiscoverySchema,
  checkResponseExample,
  checkResponseDiscoverySchema,
} from "../config/discovery.js";

// ─────────────────────────────────────────────────────────────────────────
// Network mapping — same as bsman-ai/src/config/x402.ts
// ─────────────────────────────────────────────────────────────────────────

const NETWORK_ALIASES: Record<string, `${string}:${string}`> = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
};

const USDC_CONTRACTS: Record<string, string> = {
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",       // Base mainnet
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",      // Base Sepolia
};

export function normalizeNetwork(value: string): `${string}:${string}` {
  if (NETWORK_ALIASES[value]) return NETWORK_ALIASES[value]!;
  if (value.includes(":")) return value as `${string}:${string}`;
  throw new Error(
    `X402_NETWORK must be a CAIP-2 identifier or known alias. Got: ${value}`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Types — x402 v2 wire shape (bazar-compatible)
// ─────────────────────────────────────────────────────────────────────────

export interface PaymentAccept {
  scheme: "exact";
  network: `${string}:${string}`;     // CAIP-2 e.g. eip155:8453
  amount: string;                       // smallest unit (microUSDC)
  asset: string;                        // 0x... contract
  payTo: string;                        // 0x... receiver
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
  // Optional v1-style fields kept on accept[] for CDP indexer linkage
  // and compatibility with v1 clients.
  resource?: string;
  description?: string;
  mimeType?: string;
}

export interface PaymentRequiredBody {
  x402Version: 2;
  error: string;
  resource: {
    url: string;
    description: string;
    mimeType: string;
  };
  accepts: PaymentAccept[];
  extensions: Record<string, unknown>;
  compatibility: {
    paymentRequiredHeader: "PAYMENT-REQUIRED";
    headerIsCanonical: true;
    hint: string;
  };
  resourceUrl: string;
  method: string;
  endpoint: string;
  payment: {
    protocol: "x402";
    network: string;                    // human-readable e.g. "Base mainnet"
    networkId: string;                  // CAIP-2 e.g. "eip155:8453"
    price: string;                      // "$0.001 per check decision"
    facilitator: string;                // "configured x402 facilitator"
  };
  metadata: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────
// Build a v2 PaymentRequiredBody (bazar-compatible).
// ─────────────────────────────────────────────────────────────────────────

export function buildPaymentRequirements(
  config: X402Config,
  resourceUrl: string,
  options: {
    method?: "GET" | "POST";
    description?: string;
  } = {}
): PaymentRequiredBody {
  const network = normalizeNetwork(config.network);
  const microUsdc = Math.round(config.priceCheckUsd * 1_000_000);
  const method = (options.method ?? "POST").toUpperCase();
  const description =
    options.description ?? bazaarDiscoveryMetadata.description;
  const mimeType = bazaarDiscoveryMetadata.mimeType;

  const accept: PaymentAccept = {
    scheme: "exact",
    network,
    amount: String(microUsdc),
    // `resource` inside accept — CDP indexer's /discovery/merchant
    // response shows resourceUrl undefined for bsman-ai (which has no
    // accept[].resource). Adding resource here lets the indexer link
    // our payTo to api.aibrake.dev/x402/v1/check instead of leaving
    // resourceUrl null.
    resource: resourceUrl,
    description,
    mimeType,
    asset:
      USDC_CONTRACTS[network] ?? USDC_CONTRACTS["eip155:8453"]!,
    payTo: config.payTo,
    maxTimeoutSeconds: 60,
    extra: {
      // EIP-712 domain separator for Base USDC. The on-chain contract's
      // `name()` returns "USD Coin" (the official ERC-20 token name) and
      // `version()` returns "2". x402 clients sign EIP-3009
      // transferWithAuthorization against this domain — mismatched values
      // produce invalid signatures and the client silently refuses to
      // submit the payment. Matches what callbsman.com ships and the
      // canonical Coinbase USDC deployment on Base.
      name: "USD Coin",
      version: "2",
      aibrake: {
        name: bazaarDiscoveryMetadata.name,
        provider: bazaarDiscoveryMetadata.provider,
        category: bazaarDiscoveryMetadata.category,
        tags: [...bazaarTags],
        docsUrl: bazaarDiscoveryMetadata.docsUrl,
        openApiUrl: bazaarDiscoveryMetadata.openApiUrl,
        githubUrl: bazaarDiscoveryMetadata.githubUrl,
        mainMode: bazaarDiscoveryMetadata.mainMode,
        supportedModes: [...bazaarDiscoveryMetadata.supportedModes],
        fallbackUrl: bazaarDiscoveryMetadata.fallbackUrl,
      },
    },
  };

  // Discovery extensions — mirror the shape that
  // @x402/extensions declareDiscoveryExtension produces, PLUS the
  // bazaar extension that agentic.market's mapper indexes off. Without
  // extensions.bazaar (with non-empty name + description), x402trace
  // bazaar-check rejects the challenge and agentic.market falls back to
  // showing raw URLs in listings.
  const extensions: Record<string, unknown> = {
    "x402.discovery": {
      bodyType: "json",
      input:
        method === "GET" ? undefined : checkRequestExample,
      inputSchema:
        method === "GET" ? undefined : checkRequestDiscoverySchema,
      output: {
        example: checkResponseExample,
        schema: checkResponseDiscoverySchema,
      },
    },
    // CDP Bazaar canonical shape — only TWO fields: `info` and `schema`.
    // Per docs.cdp.coinbase.com/x402/bazaar:
    //   "For a route to be discoverable, the Bazaar extension input
    //    must pass strict JSON Schema validation against
    //    schema.properties.input in your declared extension."
    // Earlier shapes (with discoverable/name/description/tags/icon/etc.)
    // returned EXTENSION-RESPONSES rejected: "invalid discovery
    // configuration" because anything beyond {info, schema} fails the
    // CDP indexer's schema match.
    bazaar: {
      info: {
        input: {
          type: "http",
          method,
          bodyType: "json",
          body: method === "GET" ? undefined : checkRequestExample,
        },
        output: {
          type: "json",
          example: checkResponseExample,
        },
      },
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          input: checkRequestDiscoverySchema,
          output: checkResponseDiscoverySchema,
        },
        required: ["input"],
      },
    },
  };

  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: resourceUrl,
      description,
      mimeType,
    },
    accepts: [accept],
    extensions,
    compatibility: {
      paymentRequiredHeader: "PAYMENT-REQUIRED",
      headerIsCanonical: true,
      hint:
        "The PAYMENT-REQUIRED header is canonical. This JSON body mirrors the same PaymentRequired payload for clients that read the body.",
    },
    resourceUrl,
    method,
    endpoint: `${method} ${resourceUrl}`,
    payment: {
      protocol: "x402",
      network: network === "eip155:8453" ? "Base mainnet" : "Base Sepolia",
      networkId: network,
      price: `$${config.priceCheckUsd.toFixed(3)} ${bazaarDiscoveryMetadata.payment.unit}`,
      facilitator: "configured x402 facilitator",
    },
    metadata: {
      name: bazaarDiscoveryMetadata.name,
      provider: bazaarDiscoveryMetadata.provider,
      category: bazaarDiscoveryMetadata.category,
      description: bazaarDiscoveryMetadata.shortDescription,
      mimeType,
      docsUrl: bazaarDiscoveryMetadata.docsUrl,
      openApiUrl: bazaarDiscoveryMetadata.openApiUrl,
      githubUrl: bazaarDiscoveryMetadata.githubUrl,
      mainMode: bazaarDiscoveryMetadata.mainMode,
      supportedModes: [...bazaarDiscoveryMetadata.supportedModes],
      tags: [...bazaarTags],
      fallbackUrl: bazaarDiscoveryMetadata.fallbackUrl,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Verify a payment by calling the facilitator's /verify endpoint.
//
// 0.7.2-beta: supports both unauthenticated facilitators (x402.org) AND
// the official CDP facilitator at api.cdp.coinbase.com, which requires
// every request to carry an Authorization: Bearer <JWT> header signed
// with CDP API creds. JWT signing is done via @coinbase/x402's
// `createAuthHeader` — a thin wrapper over @coinbase/cdp-sdk's
// generateJwt. We import it lazily so the package stays optional for
// users who never deploy the server (e.g. SDK-only npm consumers).
// ─────────────────────────────────────────────────────────────────────────

interface FacilitatorVerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

interface FacilitatorAuth {
  apiKeyId: string;
  apiKeySecret: string;
}

// CDP facilitator base path. When facilitatorUrl is the canonical CDP
// endpoint, both /verify and /settle live under /platform/v2/x402/.
// We detect this by hostname so callers can either pass the base URL
// (without /platform/...) and we add the suffix, or pass the full URL.
function isCdpFacilitator(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith("cdp.coinbase.com");
  } catch {
    return false;
  }
}

function facilitatorEndpoint(
  facilitatorUrl: string,
  op: "verify" | "settle" | "supported"
): { url: string; host: string; path: string } {
  const base = facilitatorUrl.replace(/\/+$/, "");
  // If caller passed the bare host (https://api.cdp.coinbase.com), splice
  // in /platform/v2/x402. If they already included the route, just append op.
  let withRoute = base;
  if (isCdpFacilitator(base) && !base.includes("/platform/v2/x402")) {
    withRoute = `${base}/platform/v2/x402`;
  }
  const full = `${withRoute}/${op}`;
  const parsed = new URL(full);
  return {
    url: full,
    host: parsed.host,
    path: parsed.pathname,
  };
}

async function buildAuthHeaders(
  facilitatorUrl: string,
  op: "verify" | "settle" | "supported",
  auth: FacilitatorAuth | undefined
): Promise<Record<string, string>> {
  if (!auth) return {};
  if (!isCdpFacilitator(facilitatorUrl)) {
    // Non-CDP facilitators may have other auth schemes; for now only
    // CDP needs the JWT dance. Future facilitators can be added here.
    return {};
  }
  // Lazy-load @coinbase/x402 — only required at runtime when CDP creds
  // are present. Keeps SDK-only consumers from paying for ~5MB of
  // viem/jose/cdp-sdk in their node_modules.
  const { createAuthHeader } = await import("@coinbase/x402");
  const ep = facilitatorEndpoint(facilitatorUrl, op);
  const method = op === "supported" ? "GET" : "POST";
  const authorization = await createAuthHeader(
    auth.apiKeyId,
    auth.apiKeySecret,
    method,
    ep.host,
    ep.path
  );
  return { Authorization: authorization };
}

// Enrich the wallet-signed payment payload with the bazaar extension
// metadata + resource URL that the CDP Facilitator needs to feed its
// indexer. Wallets like agentcash sign only the EIP-3009 authorization
// + signature — they have no knowledge of the bazaar discovery layer.
// The server is the one that must inject extensions.bazaar (with
// discoverable: true + tags + schemas) into the payload that goes into
// /verify and /settle. Without this, /discovery/merchant?payTo=... will
// keep returning 404 even after successful settles. Per CDP docs:
//   "settle request must contain paymentPayload.resource"
//   "extensions.bazaar must declare discoverable: true"
function enrichPayloadForBazaar(
  payload: any,
  paymentRequirements: PaymentAccept,
  resourceUrl: string,
  bazaarExt: unknown
): any {
  if (!payload || typeof payload !== "object") return payload;
  return {
    x402Version: payload.x402Version ?? 2,
    scheme: payload.scheme ?? paymentRequirements.scheme,
    network: payload.network ?? paymentRequirements.network,
    payload: payload.payload ?? payload,
    resource: payload.resource ?? resourceUrl,
    extensions: {
      ...(payload.extensions ?? {}),
      bazaar: bazaarExt,
    },
  };
}

export async function verifyPaymentWithFacilitator(
  facilitatorUrl: string,
  paymentPayloadB64: string,
  paymentRequirements: PaymentAccept,
  abortSignal?: AbortSignal,
  auth?: FacilitatorAuth,
  bazaarContext?: { resourceUrl: string; bazaarExt: unknown }
): Promise<FacilitatorVerifyResponse & { extensionResponses?: string | null }> {
  const ep = facilitatorEndpoint(facilitatorUrl, "verify");
  let payload: any;
  try {
    const decoded = Buffer.from(paymentPayloadB64, "base64").toString("utf8");
    payload = JSON.parse(decoded);
  } catch (err) {
    return {
      isValid: false,
      invalidReason: `Invalid X-Payment / PAYMENT-REQUIRED header: ${(err as Error).message}`,
    };
  }

  // NOTE 2026-05-30: tried enriching paymentPayload directly with
  // resource + extensions.bazaar (per CDP Bazaar docs); CDP /verify
  // rejected the modified payload with HTTP 400 "must match one of
  // [x402V2PaymentPayload, x402V1PaymentPayload]". The wallet-signed
  // payload's shape is rigid — adding top-level fields breaks the
  // EIP-712 schema match. Bazaar metadata is injected via the OUTER
  // envelope (extensions field at top level of the verify request body)
  // instead, below.
  void bazaarContext;

  let authHeaders: Record<string, string> = {};
  try {
    authHeaders = await buildAuthHeaders(facilitatorUrl, "verify", auth);
  } catch (err) {
    return {
      isValid: false,
      invalidReason: `Failed to sign CDP request: ${(err as Error).message}`,
    };
  }

  // Outer envelope: include extensions at top level for the bazaar
  // indexer (sibling to paymentPayload + paymentRequirements). The
  // wallet-signed paymentPayload stays untouched.
  const envelopeExtensions = bazaarContext
    ? { bazaar: bazaarContext.bazaarExt }
    : undefined;

  const res = await fetch(ep.url, {
    method: "POST",
    redirect: "follow",
    headers: {
      "content-type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload: payload,
      paymentRequirements,
      resource: bazaarContext?.resourceUrl,
      extensions: envelopeExtensions,
    }),
    signal: abortSignal,
  });

  // CDP returns EXTENSION-RESPONSES header signalling whether the
  // bazaar extension we injected was accepted/rejected/processing.
  // Capture so we can correlate with /discovery/merchant outcomes.
  const extensionResponses = res.headers.get("extension-responses");

  if (!res.ok) {
    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {
      // ignore
    }
    return {
      isValid: false,
      invalidReason: `facilitator returned HTTP ${res.status}${bodyText ? ": " + bodyText.slice(0, 200) : ""}`,
      extensionResponses,
    };
  }

  const data = (await res.json()) as FacilitatorVerifyResponse;
  return { ...data, extensionResponses };
}

// Settle a verified payment — finalises the EIP-3009 transfer on-chain
// through the facilitator. CDP charges this through /platform/v2/x402/settle
// and requires a fresh JWT (different path → different signature).
export async function settlePaymentWithFacilitator(
  facilitatorUrl: string,
  paymentPayloadB64: string,
  paymentRequirements: PaymentAccept,
  abortSignal?: AbortSignal,
  auth?: FacilitatorAuth,
  bazaarContext?: { resourceUrl: string; bazaarExt: unknown }
): Promise<{ success: boolean; error?: string; txHash?: string; extensionResponses?: string | null }> {
  const ep = facilitatorEndpoint(facilitatorUrl, "settle");
  let payload: any;
  try {
    const decoded = Buffer.from(paymentPayloadB64, "base64").toString("utf8");
    payload = JSON.parse(decoded);
  } catch (err) {
    return {
      success: false,
      error: `Invalid payment payload: ${(err as Error).message}`,
    };
  }
  // Bazaar metadata is sent on the outer envelope below, not inside
  // the wallet-signed paymentPayload (see verify() for the rationale).
  void bazaarContext;
  let authHeaders: Record<string, string> = {};
  try {
    authHeaders = await buildAuthHeaders(facilitatorUrl, "settle", auth);
  } catch (err) {
    return {
      success: false,
      error: `Failed to sign CDP settle request: ${(err as Error).message}`,
    };
  }
  const settleEnvelopeExtensions = bazaarContext
    ? { bazaar: bazaarContext.bazaarExt }
    : undefined;
  const res = await fetch(ep.url, {
    method: "POST",
    redirect: "follow",
    headers: {
      "content-type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload: payload,
      paymentRequirements,
      resource: bazaarContext?.resourceUrl,
      extensions: settleEnvelopeExtensions,
    }),
    signal: abortSignal,
  });
  const extensionResponses = res.headers.get("extension-responses");
  if (!res.ok) {
    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {
      // ignore
    }
    return {
      success: false,
      error: `facilitator settle returned HTTP ${res.status}${bodyText ? ": " + bodyText.slice(0, 200) : ""}`,
      extensionResponses,
    };
  }
  const data = (await res.json()) as { success?: boolean; transaction?: string; error?: string };
  return {
    success: data.success ?? false,
    txHash: data.transaction,
    error: data.error,
    extensionResponses,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Fastify preHandler — apply to any route that needs x402 paywall.
// ─────────────────────────────────────────────────────────────────────────

export function createX402PreHandler(config: X402Config) {
  return async function x402PreHandler(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (!config.enabled) {
      reply.code(503).send({
        error: "x402_disabled",
        message: "x402 paywall is not enabled on this deployment.",
      });
      return;
    }
    if (!config.payTo) {
      reply.code(500).send({
        error: "x402_misconfigured",
        message: "X402_PAY_TO env var is not set.",
      });
      return;
    }

    const resourceUrl = `${getOrigin(req)}${req.url}`;
    const paymentRequirementsBody = buildPaymentRequirements(
      config,
      resourceUrl,
      {
        method: req.method.toUpperCase() as "GET" | "POST",
        description: bazaarDiscoveryMetadata.description,
      }
    );

    // 0.7.2-beta diagnostic: log every request hitting the paywall so we
    // can correlate 402s with what was sent. Compact: header alias used,
    // facilitator URL active for this deployment, payer wallet.
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "x402.diag.incoming",
        method: req.method,
        path: req.url,
        ua: req.headers["user-agent"] ?? null,
        headerName: req.headers["x-payment"]
          ? "x-payment"
          : req.headers["payment-signature"]
            ? "payment-signature"
            : req.headers["payment-required"]
              ? "payment-required"
              : null,
        facilitatorActive: config.facilitatorUrl,
        walletAddress: req.headers["x-wallet-address"] ?? null,
      })
    );

    // x402 canonical: clients read either PAYMENT-REQUIRED header (preferred)
    // or the body. We accept several header names for forwards-compat:
    // - x-payment (canonical x402 v2)
    // - payment-required (legacy reverse echo)
    // - payment-signature (agentcash's MCP fetch tool ships the signed
    //   payment payload here, NOT in x-payment — observed via diag logging
    //   on 2026-05-30 when agentcash-mcp-diag/1.0 POSTs always landed here)
    const paymentHeaderRaw =
      req.headers["x-payment"] ??
      req.headers["payment-signature"] ??
      req.headers["payment-required"];
    const paymentHeader = Array.isArray(paymentHeaderRaw)
      ? paymentHeaderRaw[0]
      : paymentHeaderRaw;

    if (!paymentHeader) {
      // x402 canonical: the PAYMENT-REQUIRED header carries a base64
      // encoding of the PaymentRequired body so clients reading only
      // headers can deserialize without re-fetching. bsman-ai does the
      // same on api.callbsman.com. Header value MUST be valid base64
      // JSON — clients (e.g. agentcash) call Buffer.from(value,'base64')
      // first thing, and a non-base64 value (e.g. "true") will produce
      // garbage and break parsing.
      const headerB64 = Buffer.from(
        JSON.stringify(paymentRequirementsBody),
        "utf8"
      ).toString("base64");
      reply
        .code(402)
        .header("content-type", "application/json")
        .header("access-control-expose-headers", "PAYMENT-REQUIRED")
        .header("payment-required", headerB64)
        .send(paymentRequirementsBody);
      return;
    }

    const requirement = paymentRequirementsBody.accepts[0]!;
    const facilitatorAuth =
      config.cdpApiKeyId && config.cdpApiKeySecret
        ? {
            apiKeyId: config.cdpApiKeyId,
            apiKeySecret: config.cdpApiKeySecret,
          }
        : undefined;

    // Retry bazaar injection with the canonical {info, schema} shape
    // per docs.cdp.coinbase.com/x402/bazaar. Earlier rejections used
    // bloated shapes (name/description/tags/discoverable/etc.) — CDP
    // only accepts the two-field shape with schema.properties.input
    // matching info.input.body.
    const bazaarExt =
      (paymentRequirementsBody.extensions as { bazaar?: unknown } | undefined)
        ?.bazaar ?? undefined;
    const bazaarContext = bazaarExt
      ? { resourceUrl, bazaarExt }
      : undefined;

    let verifyResult: Awaited<ReturnType<typeof verifyPaymentWithFacilitator>>;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      verifyResult = await verifyPaymentWithFacilitator(
        config.facilitatorUrl,
        paymentHeader,
        requirement,
        controller.signal,
        facilitatorAuth,
        bazaarContext
      );
    } catch (err) {
      reply.code(402).send({
        ...paymentRequirementsBody,
        error: `Payment verification failed: ${(err as Error).message}`,
      });
      return;
    } finally {
      clearTimeout(timeout);
    }

    if (verifyResult.extensionResponses) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "x402.bazaar.verify_response",
          extensionResponses: verifyResult.extensionResponses,
        })
      );
    }

    if (!verifyResult.isValid) {
      reply.code(402).send({
        ...paymentRequirementsBody,
        error: verifyResult.invalidReason ?? "Payment verification failed",
      });
      return;
    }

    // Verified — now settle on-chain through the same facilitator. We
    // settle inline so the client gets a single 200 once the USDC is in
    // payTo's wallet, matching how the official x402 middleware behaves.
    // CDP charges $0 for verify/settle; the only cost is the user's gas.
    const settleController = new AbortController();
    const settleTimeout = setTimeout(() => settleController.abort(), 30_000);
    let settleResult: Awaited<ReturnType<typeof settlePaymentWithFacilitator>>;
    try {
      settleResult = await settlePaymentWithFacilitator(
        config.facilitatorUrl,
        paymentHeader,
        requirement,
        settleController.signal,
        facilitatorAuth,
        bazaarContext
      );
    } catch (err) {
      reply.code(402).send({
        ...paymentRequirementsBody,
        error: `Payment settle failed: ${(err as Error).message}`,
      });
      return;
    } finally {
      clearTimeout(settleTimeout);
    }

    if (settleResult.extensionResponses) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "x402.bazaar.settle_response",
          extensionResponses: settleResult.extensionResponses,
        })
      );
    }

    if (!settleResult.success) {
      reply.code(402).send({
        ...paymentRequirementsBody,
        error: settleResult.error ?? "Payment settle failed",
      });
      return;
    }

    // Stamp the request so downstream handlers + access logs see who paid.
    (req as any).x402Payer = verifyResult.payer;
    (req as any).x402TxHash = settleResult.txHash;
    reply.header("X-PAYMENT-RESPONSE", JSON.stringify({
      success: true,
      transaction: settleResult.txHash,
      payer: verifyResult.payer,
    }));
    return;
  };
}

function getOrigin(req: FastifyRequest): string {
  const proto = (req.headers["x-forwarded-proto"] as string) ?? "https";
  const host =
    (req.headers["x-forwarded-host"] as string) ??
    (req.headers["host"] as string);
  return `${proto}://${host}`;
}
