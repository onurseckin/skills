import { describe, expect, it } from "bun:test";
import {
  EmpiricalCrucibleEngine,
  ORDER_OF_MAGNITUDE_REOPEN_THRESHOLD,
  PROTOTYPE_SPIKE_STATUSES,
  SETTLED_INVARIANT_STATUSES,
  SettledInvariantRepository,
  type AntiPatternRecord,
  type FalsifiableHypothesis,
  type PrototypeSpikeConfig,
  type ReopenChallengeInput,
} from "../../../olt/scripts/src/mind/crucible/index.ts";
import {
  PARETO_PRIORITY_LEVELS,
  type ParetoApproachCandidate,
} from "../../../olt/scripts/src/mind/planning/pareto-arbitration.ts";
