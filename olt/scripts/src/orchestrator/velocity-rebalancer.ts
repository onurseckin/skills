/**
 * Facade for Brent Work/Span dynamic concurrency scaling, 5-minute straggler SLA partitioning,
 * and false-serialization prevention.
 */

export type {
  BrentConcurrencyPlan,
  BrentDecompositionOptions,
  BrentPartition,
  FalseSerializationReport,
  FalseSerializationViolation,
  RebalancedTaskPackage,
  RebalanceStragglerOptions,
  StragglerPartitionReport,
  StragglingTask,
} from "./concurrency/index.ts";

export {
  assertNoFalseSerialization,
  calculateBrentConcurrency,
  calculateBrentDecomposition,
  calculateDynamicWaveCapacity,
  decomposeStragglingTask,
  DEFAULT_MAX_PARALLELISM,
  DEFAULT_MIN_PARALLELISM,
  DEFAULT_TARGET_DURATION_SECONDS,
  detectFalseSerialization,
  isTaskStraggling,
  partitionScopeDisjoint,
  partitionStragglers,
  rebalanceStragglerTask,
  STRAGGLER_SLA_MS,
  STRAGGLER_SLA_SECONDS,
} from "./concurrency/index.ts";
