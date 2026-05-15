// Bearer-token auth middleware for Stage 0.3 hosted beta.
//
// Single header contract: `Authorization: Bearer <key>`. The original spec
// also accepted `X-Agent-Spend-Guard-Key`; that custom header was dropped per
// the reviewer modifications to keep the integration surface tight.

import type { FastifyReply, FastifyRequest } from "fastify";
import { sha256Hex16 } from "../core/fingerprints.js";
import type { EnvConfig } from "../config/env.js";

export interface AuthState {
  apiKeyHash: string | null;
}

const AUTH_STATE = Symbol("agent-spend-guard.auth-state");

export function getAuthState(request: FastifyRequest): AuthState {
  const state = (request as unknown as Record<symbol, AuthState>)[AUTH_STATE];
  return state ?? { apiKeyHash: null };
}

function setAuthState(request: FastifyRequest, state: AuthState): void {
  (request as unknown as Record<symbol, AuthState>)[AUTH_STATE] = state;
}

function extractBearerKey(request: FastifyRequest): string | null {
  const raw = request.headers.authorization;
  if (typeof raw !== "string") return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const key = match[1]!.trim();
  return key.length > 0 ? key : null;
}

export function hashApiKey(key: string): string {
  return `key_v1_${sha256Hex16(key)}`;
}

export interface AuthMiddleware {
  (request: FastifyRequest, reply: FastifyReply): Promise<void> | void;
}

export function createAuthMiddleware(config: EnvConfig): AuthMiddleware {
  return async (request, reply) => {
    const key = extractBearerKey(request);

    if (key === null) {
      if (config.authMode === "required") {
        reply.status(401);
        reply.send({
          error: {
            code: "UNAUTHORIZED",
            message:
              "Missing API key. Send Authorization: Bearer <key>. See DEPLOYMENT.md.",
          },
        });
        return;
      }
      // optional + no key → anonymous, hash = null
      setAuthState(request, { apiKeyHash: null });
      return;
    }

    if (!config.apiKeys.has(key)) {
      reply.status(401);
      reply.send({
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid API key.",
        },
      });
      return;
    }

    setAuthState(request, { apiKeyHash: hashApiKey(key) });
  };
}
