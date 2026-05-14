import Fastify, { type FastifyInstance } from "fastify";
import { registerCheckRoute } from "./routes/check.js";
import { registerCheckDeepRoute } from "./routes/check-deep.js";
import { registerHealthRoute } from "./routes/health.js";

export interface BuildServerOptions {
  logger?: boolean;
}

export async function buildServer(
  options: BuildServerOptions = {}
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 256 * 1024,
  });

  await registerHealthRoute(app);
  await registerCheckRoute(app);
  await registerCheckDeepRoute(app);

  return app;
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /server\.(ts|js)$/.test(process.argv[1]);

if (isDirectRun) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  buildServer({ logger: true })
    .then((app) => app.listen({ port, host }))
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ event: "spending_guard.started", port, host }));
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
