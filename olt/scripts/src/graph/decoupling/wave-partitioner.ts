export {
  FAST_PATH_TASK_COUNT,
  MAX_LANES_PER_COORDINATOR,
  type CoordinatorPartition,
  type HierarchyScalingPath,
  type HierarchyScalingResult,
  type MultiCoordinatorPartitionOptions,
  type MultiCoordinatorWavePartitionResult,
} from "../parallel-decoupler/types.ts";

export {
  evaluateHierarchyScaling,
  inferStackOrDomain,
  isFastPathCompactionEligible,
  partitionWaveCoordinators,
} from "../parallel-decoupler/hierarchy.ts";
