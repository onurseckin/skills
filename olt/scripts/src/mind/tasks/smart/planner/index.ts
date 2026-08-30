export type {
  AnchorSymbolKind,
  SmartTaskSourceType,
  ExactFileAnchor,
  ExactAnchorBriefing,
  ExactAnchorExtractionOptions,
  BuildExactAnchorBriefingOptions,
  ActiveHypothesis,
  RoadmapItem,
  MacroMetrics,
  CognitiveMemoryState,
  SubagentDispatchFormatOptions,
  SubagentDispatchItem,
  AntiSerializationInterlockResult,
  CoordinatorPartition,
  HierarchyScalingPath,
  HierarchyScalingResult,
  MultiCoordinatorPartitionOptions,
  MultiCoordinatorWavePartitionResult,
} from "./types.ts";

export {
  FALSE_SERIALIZATION_DEFECT,
  FAST_PATH_TASK_COUNT,
  MAX_LANES_PER_COORDINATOR,
  allocateParallelLanes,
  assertAntiSerializationInterlock,
  computeWorkSpanMetrics,
  decoupleDisjointTasks,
  detectArtificialSerialization,
  evaluateHierarchyScaling,
  formatParallelSubagentsDispatchArray,
  inferStackOrDomain,
  isFastPathCompactionEligible,
  partitionDynamicLanes,
  partitionWaveCoordinators,
  verifyAntiSerializationInterlock,
  CANONICAL_COGNITIVE_MEMORY_FILE,
  DEFAULT_COGNITIVE_MEMORY_FILE,
  resolveCanonicalCognitiveMemoryPath,
  resolveCognitiveMemoryPath,
} from "./types.ts";

export { readCognitiveMemory, writeCognitiveMemory, updateCognitiveMemory } from "./memory.ts";

export type {
  SmartTaskPlan,
  AntiBatchingValidationReport,
  SmartTaskSynthesisResult,
  WaveGroup,
  SmartWavePlanResult,
  RebalancedTaskPlanResult,
  ScopeCollision,
  MultiOrchestratorSubTreePlan,
  MultiOrchestratorPrePlanningResult,
  MultiOrchestratorPlanningOptions,
  ProductOwnerIntakeStream,
  ProductOwnerIntakeItem,
  ProductOwnerIntakeDecision,
  InfiniteProductOwnerState,
  InfiniteProductOwnerResult,
  AdmissionToDispatchAuditReport,
  AdmissionToDispatchResult,
  InfiniteProductOwnerOptions,
  AutonomousDualIntakeResult,
} from "./models.ts";

export {
  deriveTargetFiles,
  extractFileAnchors,
  formatZeroExplorationPrompt,
  buildExactAnchorBriefing,
  enrichTaskPlanWithExactAnchors,
  prepareExactAnchorBriefingForTask,
  dispatchTaskWithExactAnchors,
} from "./anti-batching.ts";

export {
  validateAntiBatchingRule,
  validateAntiBatchingIsolation,
  assertAntiBatchingRule,
  partitionGroupedFeedbacksStrictly,
} from "./partitioning.ts";

export {
  normalizeScopePath,
  pathsOverlap,
  partitionCandidatesStrictly,
  detectScopeOverlap,
  calculateScopeCollisions,
  detectScopeCollisions,
} from "./collisions.ts";

export { computeMacroMetrics } from "./metrics.ts";

export {
  planWaveExecution,
  evaluateSmartHierarchy,
  planMultiCoordinatorWaves,
  compileSmartTasksToWavePlan,
  partitionIntoDisjointWaves,
} from "./waves.ts";

export {
  rebalanceTasksWithBrentLimits,
  integrateMacroMetricsIntoMemory,
  rebalanceTaskQueueWithBrentLimits,
} from "./rebalance.ts";
