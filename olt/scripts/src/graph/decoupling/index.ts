export {
  ARTIFICIAL_SERIALIZATION_WARNING,
  FALSE_SERIALIZATION_DEFECT,
  assertAntiSerializationInterlock,
  detectArtificialSerialization,
  verifyAntiSerializationInterlock,
  type AntiSerializationInterlockResult,
  type ArtificialSerializationWarning,
  type SubagentDispatchFormatOptions,
  type SubagentDispatchItem,
} from "./anti-serialization.ts";

export {
  allocateParallelLanes,
  computeWorkSpanMetrics,
  partitionDynamicLanes,
  type DynamicLanePartitioningResult,
  type DynamicLaneTaskInput,
  type ParallelLaneAssignment,
  type ParallelMetrics,
} from "./lane-allocator.ts";

export {
  FAST_PATH_TASK_COUNT,
  MAX_LANES_PER_COORDINATOR,
  evaluateHierarchyScaling,
  inferStackOrDomain,
  isFastPathCompactionEligible,
  partitionWaveCoordinators,
  type CoordinatorPartition,
  type HierarchyScalingPath,
  type HierarchyScalingResult,
  type MultiCoordinatorPartitionOptions,
  type MultiCoordinatorWavePartitionResult,
} from "./wave-partitioner.ts";
