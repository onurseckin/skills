/**
 * Anti-Make-Work Safeguards & Synthetic Churn Detection Module.
 *
 * Implements the Empirical Reality-Anchored Value Standard (Blueprint Section 11)
 * to guard against cosmetic churn, abstraction bloat, and speculative refactoring.
 */

export {
  GENUINE_VALUE_PILLARS,
  GENUINE_VALUE_PILLAR_DEFINITIONS,
  SYNTHETIC_CHURN_TYPES,
  type GenuineValuePillar,
  type SyntheticChurnType,
  type ChurnSeverity,
  type SyntheticChurnViolation,
  type DiffAnalysisInput,
  type TaskEvaluationInput,
  type TaskValueEvaluation,
} from "./types.ts";

export {
  SyntheticChurnDetector,
  detectCosmeticChurn,
  detectAbstractionBloat,
  detectSpeculativeRefactoring,
  analyzeTaskForChurn,
} from "./churn-detector.ts";

export {
  GenuineValueEvaluator,
  evaluateTaskValue,
  buildRejectionNotice,
} from "./value-evaluator.ts";
