export type {
  UnlimitedDepthSchedulerConfig,
  ValidatorPairingRecord,
  UnboundedWavePartition,
  DepthMetrics,
  CriticalPathDepthResult,
  DepthInvariantValidationResult,
  PairValidatorsOptions,
  UnlimitedDepthScheduleResult,
} from "./unlimited-types.ts";

export { scheduleUnlimitedDepthDAG } from "./unlimited-core.ts";

export {
  pairValidatorsStrictly,
  assertUnboundedConcurrencySafety,
  validateDepthInvariants,
} from "./unlimited-pairing.ts";

export {
  taskRecord,
  conflicting,
  derivedRationale,
  computeCriticalPathDepth,
} from "./unlimited-utils.ts";
