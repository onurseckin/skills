export type {
  BrentConcurrencyPlan,
  BrentDecompositionOptions,
  BrentPartition,
  FalseSerializationReport,
  FalseSerializationViolation,
  QuotaState,
  RebalancedTaskPackage,
  RebalanceStragglerOptions,
  StragglerPartitionReport,
  StragglingTask,
} from "./types.ts";

export { partitionScopeDisjoint } from "./scope-partition.ts";
export {
  calculateBrentConcurrency,
  calculateBrentDecomposition,
  calculateDynamicWaveCapacity,
  DECOMPOSITION_LOW_QUOTA_THRESHOLD,
  DEFAULT_MAX_PARALLELISM,
  DEFAULT_MIN_PARALLELISM,
  DEFAULT_TARGET_DURATION_SECONDS,
} from "./brent-scaling.ts";
export {
  decomposeStragglingTask,
  isTaskStraggling,
  partitionStragglers,
  rebalanceStragglerTask,
  STRAGGLER_SLA_MS,
  STRAGGLER_SLA_SECONDS,
} from "./straggler-partition.ts";
export { assertNoFalseSerialization, detectFalseSerialization } from "./false-serialization.ts";
export {
  getTelemetryQuotaProvider,
  resolveMeasuredQuotaPercentage,
  setTelemetryQuotaProvider,
} from "../../telemetry/index.ts";
export {
  bootstrapTelemetryQuota,
  getActiveTelemetryCollector,
  readCurrentQuota,
  sampleTelemetryQuota,
  setActiveTelemetryCollector,
  updateCachedTelemetryQuota,
} from "../lifecycle/index.ts";
