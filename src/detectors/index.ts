import type { DetectorDefinition } from "../core/types.js";
import { staleContextRetryStormDetector } from "./stale-context-retry-storm.js";
import { taskBudgetBreachDetector } from "./task-budget-breach.js";
import { sameToolRetryLoopDetector } from "./same-tool-retry-loop.js";
import { modelEscalationWithoutEvidenceDetector } from "./model-escalation-without-evidence.js";
import { objectiveDriftDetector } from "./objective-drift.js";
import { unverifiedSuccessAssertionDetector } from "./unverified-success-assertion.js";

export const DEFAULT_DETECTORS: DetectorDefinition[] = [
  taskBudgetBreachDetector,
  staleContextRetryStormDetector,
  sameToolRetryLoopDetector,
  modelEscalationWithoutEvidenceDetector,
  objectiveDriftDetector,
  unverifiedSuccessAssertionDetector,
];

export function selectDetectors(enabled?: string[]): DetectorDefinition[] {
  if (!enabled || enabled.length === 0) return DEFAULT_DETECTORS;
  const set = new Set(enabled);
  return DEFAULT_DETECTORS.filter((d) => set.has(d.name));
}

export {
  staleContextRetryStormDetector,
  taskBudgetBreachDetector,
  sameToolRetryLoopDetector,
  modelEscalationWithoutEvidenceDetector,
  objectiveDriftDetector,
  unverifiedSuccessAssertionDetector,
};
