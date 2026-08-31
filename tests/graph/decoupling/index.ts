export {
  assertAntiSerializationInterlock,
  computeWorkSpanMetrics,
  decoupleDisjointTasks,
  detectArtificialSerialization,
  evaluateHierarchyScaling,
  FALSE_SERIALIZATION_DEFECT,
  formatParallelSubagentsDispatchArray,
  inferStackOrDomain,
  isFastPathCompactionEligible,
  partitionDynamicLanes,
  partitionWaveCoordinators,
  verifyAntiSerializationInterlock,
} from "../../../olt/scripts/src/graph/parallel-decoupler.ts";
