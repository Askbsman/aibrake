import type {
  DetectorDefinition,
  SpendingGuardCheckInput,
  TelemetryCompleteness,
} from "./types.js";

export function signalQualityMultiplier(
  completeness: TelemetryCompleteness | undefined
): number {
  switch (completeness) {
    case "high":
      return 1.0;
    case "medium":
      return 0.85;
    case "low":
      return 0.65;
    case "unknown":
    case undefined:
    default:
      return 0.6;
  }
}

// Resolve a dot path on the input; returns undefined if any segment missing
// or if the leaf value is explicitly null (spec: null counts as missing).
export function resolvePath(input: SpendingGuardCheckInput, path: string): unknown {
  const segments = path.split(".");
  let cursor: unknown = input;
  for (const seg of segments) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
    if (cursor === undefined || cursor === null) return undefined;
  }
  return cursor;
}

export function coverageRatio(
  input: SpendingGuardCheckInput,
  recommendedFields: string[]
): number {
  if (recommendedFields.length === 0) return 1.0;
  let present = 0;
  for (const path of recommendedFields) {
    const v = resolvePath(input, path);
    if (v !== undefined) present += 1;
  }
  return present / recommendedFields.length;
}

export function detectorConfidence(
  detector: DetectorDefinition,
  input: SpendingGuardCheckInput
): number {
  const coverage = coverageRatio(input, detector.recommendedFields);
  const quality = signalQualityMultiplier(input.telemetry_quality?.completeness);
  const raw = detector.baseConfidence * coverage * quality;
  return clamp(raw, 0, 1);
}

export function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
