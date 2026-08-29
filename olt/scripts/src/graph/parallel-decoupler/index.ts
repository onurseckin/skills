export {
  ARTIFICIAL_SERIALIZATION_WARNING,
  FALSE_SERIALIZATION_DEFECT,
  FAST_PATH_TASK_COUNT,
  MAX_LANES_PER_COORDINATOR,
  type AntiSerializationInterlockResult,
  type ArtificialSerializationWarning,
  type CoordinatorPartition,
  type DecoupleOptions,
  type DecoupledGraphResult,
  type DynamicLanePartitioningResult,
  type DynamicLaneTaskInput,
  type HierarchyScalingPath,
  type HierarchyScalingResult,
  type MultiCoordinatorPartitionOptions,
  type MultiCoordinatorWavePartitionResult,
  type ParallelLaneAssignment,
  type ParallelMetrics,
  type ParsedEdgeInfo,
  type ParsedTaskInfo,
  type SubagentDispatchFormatOptions,
  type SubagentDispatchItem,
} from "./types.ts";

export { computeWorkSpanMetrics } from "./metrics.ts";
export { allocateParallelLanes, partitionDynamicLanes } from "./lane-allocator.ts";
export { decoupleDisjointTasks } from "./decoupler.ts";
export {
  evaluateHierarchyScaling,
  formatParallelSubagentsDispatchArray,
  inferStackOrDomain,
  isFastPathCompactionEligible,
  partitionWaveCoordinators,
} from "./hierarchy.ts";
export {
  assertAntiSerializationInterlock,
  detectArtificialSerialization,
  verifyAntiSerializationInterlock,
} from "./interlock.ts";
