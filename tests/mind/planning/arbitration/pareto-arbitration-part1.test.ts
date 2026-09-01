import { describe, expect, it } from "bun:test";
import {
  arbitrateMultipleApproaches,
  arbitrateParetoApproaches,
  arbitrateParetoPair,
  checkPriority1Violation,
  computeParetoEfficiencyScore,
  describePriorityLevel,
  extractPerformanceGain,
  filterParetoFrontier,
  PARETO_PRIORITY_LEVELS,
  resolveEffectivePriorityLevel,
  SCALABILITY_THRESHOLD_PERCENT,
  type ParetoApproachCandidate,
} from "../../../../olt/scripts/src/mind/planning/pareto-arbitration.ts";
