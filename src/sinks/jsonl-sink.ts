// Fail-safe JSONL log sink for Stage 0.3.
//
// Appends one redacted decision event per line. Auto-creates parent directory
// once at first write; on persistent write failure, emits a single rate-limited
// stderr warning and swallows the error so API responses never fail because
// the disk is full or the directory is unwritable.

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LoggerSink } from "../core/logger.js";

const WARNING_RATE_LIMIT_MS = 60_000;

export interface JsonlSinkOptions {
  filePath: string;
  // Optional override for stderr writer — used by tests.
  onError?: (err: unknown) => void;
}

export function createJsonlSink(options: JsonlSinkOptions): LoggerSink {
  const { filePath } = options;
  let dirReady = false;
  let lastWarningAt = 0;

  function warnRateLimited(err: unknown): void {
    if (options.onError) {
      options.onError(err);
      return;
    }
    const now = Date.now();
    if (now - lastWarningAt < WARNING_RATE_LIMIT_MS) return;
    lastWarningAt = now;
    // eslint-disable-next-line no-console
    console.warn(
      `[agent-spend-guard] jsonl log sink write failed (${
        err instanceof Error ? err.message : String(err)
      }). Subsequent failures are suppressed for 60s.`
    );
  }

  function ensureDir(): void {
    if (dirReady) return;
    try {
      const dir = dirname(filePath);
      if (dir && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      dirReady = true;
    } catch (err) {
      // Fail-open. Next write attempt will surface the warning.
      warnRateLimited(err);
    }
  }

  return {
    emit(event) {
      ensureDir();
      try {
        appendFileSync(filePath, JSON.stringify(event) + "\n", { encoding: "utf8" });
      } catch (err) {
        warnRateLimited(err);
      }
    },
  };
}
