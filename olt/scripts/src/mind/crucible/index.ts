export type {
  HypothesisMetricDirection,
  HypothesisValidationMethod,
  FalsifiableHypothesis,
  PrototypeSpikeStatus,
  PrototypeSpikeConfig,
  AntiPatternRecord,
  PrototypeSpikeResult,
  SettledInvariantStatus,
  SettledInvariantHistoryAction,
  SettledInvariantHistoryEntry,
  SettledInvariant,
  CommitInvariantInput,
  ReopenChallengeInput,
  ReopenChallengeResult,
  SettledInvariantStore,
} from "./types.ts";

export {
  ORDER_OF_MAGNITUDE_REOPEN_THRESHOLD,
  DEFAULT_SPIKE_TIMEBOX_MINUTES,
  DEFAULT_SPIKE_TIMEBOX_MS,
  PROTOTYPE_SPIKE_STATUSES,
  SETTLED_INVARIANT_STATUSES,
} from "./types.ts";

export { SettledInvariantRepository } from "./bedrock-commitment.ts";

export type {
  FinalizeSpikeOptions,
  SpikeFilterOptions,
} from "./crucible-protocol.ts";

export { EmpiricalCrucibleEngine } from "./crucible-protocol.ts";
