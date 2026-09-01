import { describe, expect, it } from "bun:test";
import {
  arbitrateMultipleApproaches,
  arbitrateParetoApproaches,
  arbitrateParetoCandidates,
  arbitrateParetoPair,
  checkPriority1Violation,
  computeParetoEfficiencyScore,
  describePriorityLevel,
  enforcePreDeclaredParetoArbitration,
  extractPerformanceGain,
  filterParetoFrontier,
  getPriorityPrecedenceRank,
  PARETO_DEBATE_CYCLE_THRESHOLD,
  PARETO_LEVEL_NAMES,
  PARETO_PRIORITY_LEVELS,
  PARETO_PRIORITY_NAMES,
  resolveEffectiveParetoPriority,
  resolveEffectivePriorityLevel,
  SCALABILITY_THRESHOLD_PERCENT,
  type ParetoApproachCandidate,
  type ParetoArbitrationOptions,
  type ParetoCandidate,
} from "../../../../olt/scripts/src/mind/planning/pareto-arbitration.ts";
import {
  EmpiricalCrucibleEngine,
  type FinalizeSpikeOptions,
  type SpikeFilterOptions,
} from "../../../../olt/scripts/src/mind/crucible/crucible-protocol.ts";
import { SettledInvariantRepository } from "../../../../olt/scripts/src/mind/crucible/bedrock-commitment.ts";
import {
  DEFAULT_SPIKE_TIMEBOX_MS,
  ORDER_OF_MAGNITUDE_REOPEN_THRESHOLD,
  PROTOTYPE_SPIKE_STATUSES,
  SETTLED_INVARIANT_STATUSES,
  type AntiPatternRecord,
  type FalsifiableHypothesis,
  type PrototypeSpikeConfig,
  type ReopenChallengeInput,
  type SettledInvariant,
  type SettledInvariantStore,
} from "../../../../olt/scripts/src/mind/crucible/types.ts";


