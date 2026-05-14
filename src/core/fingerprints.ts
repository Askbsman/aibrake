// Versioned, deterministic fingerprint helpers.
// All fingerprints use the prefix `<kind>_v1_` followed by 16 hex chars of sha256.
// Normalization is fully specified in IMPLEMENTATION_NOTES.md and v0.1.1 § 17.4.

import { createHash } from "node:crypto";

export const FINGERPRINT_VERSION = "v1";

// Lexicographic stable JSON, undefineds dropped, no whitespace.
// Arrays preserved in order.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(sortValue);
  const obj = v as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const inner = obj[key];
    if (inner === undefined) continue;
    sorted[key] = sortValue(inner);
  }
  return sorted;
}

export function sha256Hex16(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function normalizeString(input: string): string {
  return input
    .normalize("NFC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\\/g, "/");
}

export function normalizePath(p: string, projectRoot?: string): string {
  let out = p.replace(/\\/g, "/").trim();
  if (projectRoot) {
    const root = projectRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    if (out.startsWith(root + "/")) out = out.slice(root.length + 1);
    else if (out === root) out = ".";
  }
  return out.toLowerCase();
}

// Strip noisy parts of a raw error string before hashing.
// Removes line:column markers, hex addresses, request IDs, timestamps,
// and temp-path basenames.
export function normalizeErrorMessage(input: string): string {
  return normalizeString(
    input
      .replace(/\b0x[0-9a-fA-F]+\b/g, "0x")
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "UUID")
      .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?\b/g, "TS")
      .replace(/\b\d+:\d+\b/g, "LINE:COL")
      .replace(/\/tmp\/[A-Za-z0-9_.-]+/g, "/tmp/X")
      .replace(/req[_-]?id[=:][A-Za-z0-9_-]+/gi, "req_id=X")
  );
}

export interface FailureFingerprintInput {
  failure_signal_type?: string;
  error_code?: string;
  normalized_error_message?: string;
  failing_file?: string;
  failing_test?: string;
  http_status?: number;
  tool_name?: string;
  command_name?: string;
  projectRoot?: string;
}

export function failureFingerprint(input: FailureFingerprintInput): string {
  const payload = {
    failure_signal_type: input.failure_signal_type ?? "",
    error_code: input.error_code ? normalizeString(input.error_code) : "",
    normalized_error_message: input.normalized_error_message
      ? normalizeErrorMessage(input.normalized_error_message)
      : "",
    failing_file: input.failing_file
      ? normalizePath(input.failing_file, input.projectRoot)
      : "",
    failing_test: input.failing_test ? normalizeString(input.failing_test) : "",
    http_status: input.http_status ?? null,
    tool_name: input.tool_name ? normalizeString(input.tool_name) : "",
    command_name: input.command_name ? normalizeString(input.command_name) : "",
  };
  return `fp_${FINGERPRINT_VERSION}_failure_${sha256Hex16(canonicalJson(payload))}`;
}

export interface ActionFingerprintInput {
  action_type: string;
  tool_name?: string;
  provider?: string;
  model?: string;
  normalized_reason?: string;
  objective_id?: string;
}

export function actionFingerprint(input: ActionFingerprintInput): string {
  const payload = {
    action_type: normalizeString(input.action_type),
    tool_name: input.tool_name ? normalizeString(input.tool_name) : "",
    provider: input.provider ? normalizeString(input.provider) : "",
    model: input.model ? normalizeString(input.model) : "",
    normalized_reason: input.normalized_reason
      ? normalizeString(input.normalized_reason)
      : "",
    objective_id: input.objective_id ?? "",
  };
  return `fp_${FINGERPRINT_VERSION}_action_${sha256Hex16(canonicalJson(payload))}`;
}

export interface EvidenceFingerprintInput {
  evidence_kind: string;
  signals: Record<string, unknown>;
}

export function evidenceFingerprint(input: EvidenceFingerprintInput): string {
  return `fp_${FINGERPRINT_VERSION}_evidence_${sha256Hex16(
    canonicalJson({ kind: input.evidence_kind, signals: input.signals })
  )}`;
}

// Input hash for decision logging. Redacts raw text fields so the hash
// is useful for equality grouping but never carries payload content.
const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /raw_prompt/i,
  /raw_response/i,
  /secret/i,
  /token/i,
  /api_key/i,
  /password/i,
];

const RAW_TEXT_PATHS: string[] = ["objective.goal", "next_action.reason"];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

function redactValue(value: unknown, currentPath: string): unknown {
  if (RAW_TEXT_PATHS.includes(currentPath)) {
    if (typeof value === "string") return sha256Hex16(value);
    return value;
  }
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v, i) => redactValue(v, `${currentPath}[${i}]`));
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (isSensitiveKey(key)) {
      const v = obj[key];
      out[key] = typeof v === "string" ? sha256Hex16(v) : "[REDACTED]";
      continue;
    }
    const childPath = currentPath ? `${currentPath}.${key}` : key;
    out[key] = redactValue(obj[key], childPath);
  }
  return out;
}

export function inputHash(input: unknown): string {
  const redacted = redactValue(input, "");
  return `input_${FINGERPRINT_VERSION}_${sha256Hex16(canonicalJson(redacted))}`;
}
