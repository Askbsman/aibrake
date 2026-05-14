// Minimal pluggable logger sink for structured decision events.
// Default sink is console.log of a single JSON line.

export interface LoggerSink {
  emit(event: Record<string, unknown>): void;
}

const consoleSink: LoggerSink = {
  emit(event) {
    // Single JSON line for log-shipping friendliness.
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(event));
  },
};

let currentSink: LoggerSink = consoleSink;

export function setLoggerSink(sink: LoggerSink): void {
  currentSink = sink;
}

export function getLoggerSink(): LoggerSink {
  return currentSink;
}

export function log(event: Record<string, unknown>): void {
  currentSink.emit(event);
}
