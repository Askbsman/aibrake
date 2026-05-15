import Fastify, { type FastifyInstance } from "fastify";
import { loadEnvConfig, type EnvConfig } from "./config/env.js";
import { setLoggerSink } from "./core/logger.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createRateLimitMiddleware, type RateLimitMiddleware } from "./middleware/rate-limit.js";
import { createJsonlSink } from "./sinks/jsonl-sink.js";
import { registerCheckRoute } from "./routes/check.js";
import { registerCheckDeepRoute } from "./routes/check-deep.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerMetaRoute } from "./routes/meta.js";

export interface BuildServerOptions {
  logger?: boolean;
  config?: EnvConfig;
  // Used by tests to opt out of mounting a JSONL sink even when env says so.
  installLogSink?: boolean;
}

export interface BuiltServer {
  app: FastifyInstance;
  config: EnvConfig;
  rateLimitMiddleware: RateLimitMiddleware;
}

export async function buildServer(
  options: BuildServerOptions = {}
): Promise<FastifyInstance> {
  const built = await buildServerWithDeps(options);
  return built.app;
}

export async function buildServerWithDeps(
  options: BuildServerOptions = {}
): Promise<BuiltServer> {
  const config = options.config ?? loadEnvConfig();

  if (options.installLogSink !== false) {
    if (config.logSink === "jsonl") {
      setLoggerSink(createJsonlSink({ filePath: config.logPath }));
    } else if (config.logSink === "none") {
      setLoggerSink({ emit: () => {} });
    }
    // "stdout" keeps the default console sink from logger.ts
  }

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 256 * 1024,
  });

  const authMiddleware = createAuthMiddleware(config);
  const rateLimitMiddleware = createRateLimitMiddleware(config);

  await registerHealthRoute(app, config);
  await registerMetaRoute(app, config);
  await registerCheckRoute(app, { authMiddleware, rateLimitMiddleware });
  await registerCheckDeepRoute(app, { authMiddleware, rateLimitMiddleware });

  return { app, config, rateLimitMiddleware };
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /server\.(ts|js)$/.test(process.argv[1]);

if (isDirectRun) {
  const config = loadEnvConfig();
  buildServer({ logger: true, config })
    .then((app) => app.listen({ port: config.port, host: "0.0.0.0" }))
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "agent_spend_guard.started",
          service: config.serviceName,
          version: config.serviceVersion,
          port: config.port,
          auth_mode: config.authMode,
          log_sink: config.logSink,
        })
      );
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
