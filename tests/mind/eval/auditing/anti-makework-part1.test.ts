import { describe, expect, it } from "bun:test";
import {
  GENUINE_VALUE_PILLARS,
  GENUINE_VALUE_PILLAR_DEFINITIONS,
  SYNTHETIC_CHURN_TYPES,
  SyntheticChurnDetector,
  detectCosmeticChurn,
  detectAbstractionBloat,
  detectSpeculativeRefactoring,
  analyzeTaskForChurn,
  GenuineValueEvaluator,
  evaluateTaskValue,
  buildRejectionNotice,
  type DiffAnalysisInput,
  type TaskEvaluationInput,
} from "../../../../olt/scripts/src/mind/auditing/anti-makework/index.ts";


