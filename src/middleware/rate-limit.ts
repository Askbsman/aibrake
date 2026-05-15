// Per-key sliding-window rate limit (Stage 0.3).
//
// In-process Map only. Single-instance hosted beta is the design target;
// horizontal scaling will require a Redis-backed limit in a future stage.

import type { FastifyReply, FastifyRequest } from "fastify";
import { getAuthState } from "./auth.js";
import type { EnvConfig } from "../config/env.js";

const WINDOW_MS = 60_000;
const ANON_BUCKET = "anon";

interface Bucket {
  count: number;
  windowStart: number;
}

export interface RateLimitMiddleware {
  (request: FastifyRequest, reply: FastifyReply): Promise<void> | void;
  reset(): void;
}

export function createRateLimitMiddleware(
  config: EnvConfig,
  clock: () => number = Date.now
): RateLimitMiddleware {
  const buckets = new Map<string, Bucket>();
  const limit = config.rateLimitPerKeyPerMin;

  function reset(): void {
    buckets.clear();
  }

  const middleware: RateLimitMiddleware = async (request, reply) => {
    if (limit <= 0) return; // limit disabled
    const auth = getAuthState(request);
    const bucketKey = auth.apiKeyHash ?? ANON_BUCKET;

    const now = clock();
    const bucket = buckets.get(bucketKey);

    if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
      buckets.set(bucketKey, { count: 1, windowStart: now });
      return;
    }

    if (bucket.count >= limit) {
      const retryAfterMs = WINDOW_MS - (now - bucket.windowStart);
      const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
      reply.header("Retry-After", String(retryAfterSec));
      reply.status(429);
      reply.send({
        error: {
          code: "RATE_LIMITED",
          message: `Rate limit exceeded for this API key (${limit} req/min). Retry after ${retryAfterSec}s.`,
        },
      });
      return;
    }

    bucket.count += 1;
  };

  middleware.reset = reset;
  return middleware;
}
