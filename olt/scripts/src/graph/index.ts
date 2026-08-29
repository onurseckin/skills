export {
  applyPlan,
  type PlanningMutation,
  type PlanningSnapshot,
  type PlanningStore,
} from "./apply-plan.ts";
export {
  enumerateGlobMatches,
  globToRegExp,
  partitionByGlob,
  slugifyScope,
  type AutoPartitionEntry,
  type AutoPartitionGrouping,
} from "./auto-partition.ts";
export { compileGraphDocument, compilePlanMarkdown, type CompiledGraphResult } from "./compiler.ts";
export {
  EDGE_TYPES,
  MAX_EFFORT,
  NODE_TYPES,
  PLANNABLE_TASK_STATUSES,
  RUNTIME_TASK_FIELDS,
  TASK_STATUSES,
} from "./constants.ts";
export {
  computeConcurrencyMetrics,
  computeDagCriticalPath,
  formatDynamicDagAscii,
  reconstructDynamicDagState,
  replanFromFindings,
  type ActiveAgentState,
  type ConcurrencyMetricsResult,
  type DagCriticalPathResult,
  type DynamicDagState,
  type DynamicTaskOrigin,
  type DynamicTaskState,
  type ReplanFindingInput,
  type ReplanFromFindingsInput,
  type ReplanFromFindingsResult,
} from "./dag-expansion.ts";
export {
  analyzeQueueStalls,
  breakCycles,
  calculateBrentsTheorem,
  computeCriticalPathDrag,
  computeTaskSlack,
  computeTopologicalWaves,
  computeWorkSpan,
  detectFanOutBottlenecks,
  findCycles,
  isAcyclic,
  renderForensicUnicodeReport,
  renderMermaidDag,
  type BrentsBoundResult,
  type CriticalPathDrag,
  type CycleBreakCandidate,
  type DependencyEdge,
  type FanOutBottleneck,
  type ForensicTaskNode,
  type ForensicWave,
  type QueueStallAnalysis,
  type TaskSlack,
  type WorkSpanMetrics,
} from "./dag-forensics.ts";
export { dependencyMap } from "./dependency-map.ts";
export {
  createImplementerValidatorPair,
  detectTransitiveBypasses,
  expandDeeper,
  expandDynamicPlan,
  expandWider,
  type BypassViolation,
  type CognitiveGuidance,
  type DeeperExpansionRequest,
  type DynamicExpansionOptions,
  type DynamicExpansionPlan,
  type DynamicExpansionResult,
  type ImplementerValidatorConfig,
  type SubtaskDecomposition,
  type SuggestedEdge,
  type TaskRolePair,
  type TransitiveBypassCheckResult,
  type WiderExpansionRequest,
} from "./dynamic-expansion.ts";
export {
  directTestCommandIsWeak,
  hasDashPrefixedArgument,
  hasNonProofMode,
  hasOpaquePathOption,
  hasUnsafeOperands,
  isRepoLocalExecutable,
  isUnsafeGatePath,
  unsafeOperand,
} from "./gate-argv-policy.ts";
export {
  discoverGatePaths,
  gateBreadthWarning,
  looksWholeSuite,
  namesATarget,
  scopeIsNarrow,
} from "./gate-breadth.ts";
export { commandIsWeak } from "./gate-command-policy.ts";
export {
  DEFAULT_BASE_REF,
  appendGateProof,
  latestGateProof,
  nodeSpawnGate,
  proveGateFalsifiable,
  readGateProofs,
  type GateProofRecord,
  type GateProveDependencies,
  type GateProveInput,
  type GateProveOutcome,
  type GateProveResult,
  type GateSpawn,
  type GateSpawnResult,
} from "./gate-proof.ts";
export { runtimeCommandIsStrong } from "./gate-runtime-grammar.ts";
export { verificationToolCommandIsStrong } from "./gate-tool-grammar.ts";
export {
  ARTIFICIAL_SERIALIZATION_WARNING,
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
  type SubagentDispatchFormatOptions,
  type SubagentDispatchItem,
} from "./parallel-decoupler.ts";
export { graphParts, type GraphParts } from "./parts.ts";
export {
  AUDIT_INVARIANT_IDS,
  advisoryFindings,
  auditPlan,
  blockingFindings,
  isAuditInvariantId,
  type AuditFinding,
  type AuditInvariantId,
  type AuditNotEvaluated,
  type AuditSeverity,
  type AuditTaskInput,
  type PlanAuditResult,
} from "./plan-audit.ts";
export {
  executionActive,
  gateContractActive,
  producedArtifacts,
  requirementContract,
  taskContract,
  taskGates,
} from "./plan-contract.ts";
export { projectPlan } from "./project-plan.ts";
export { readPlanObject, type ReadPlanOptions } from "./read-plan.ts";
export { guardPlanRevision } from "./revision-guard.ts";
export {
  analyzeScopeIndependence,
  checkScopeOverlap,
  computeConcurrencyWaves,
  normalizeScopePath,
  type ConcurrencyWave,
  type ScopeAnalysisResult,
  type ScopeCollision,
  type SerializationWarning,
  type TaskScopeInput,
} from "./scope-analyzer.ts";
export { expandScopeEntry, expandWriteScope } from "./scope-expansion.ts";
export {
  analyzeTopologyDeclaration,
  assertTopologyJustified,
  type TopologyDeclarationEdge,
  type TopologyDeclarationResult,
  type UnjustifiedEdge,
} from "./topology-declaration.ts";
export {
  dependencyData,
  describeCycle,
  downstreamMap,
  topologicalOrder,
  type DependencyMap,
} from "./topology.ts";
export {
  compileUnifiedHighLeveragePlan,
  detectCapsuleContext,
  expandDynamicPlanUnified,
  type CapsuleContext,
  type ExecutableTopology,
  type UnifiedPlanInput,
  type UnifiedPlanResult,
} from "./unified-plan.ts";
export { validateEdges } from "./validate-edges.ts";
export { validateGates } from "./validate-gates.ts";
export { validateGraph, type GraphValidationOptions } from "./validate-graph.ts";
export { validateNodes, type NodeValidation } from "./validate-nodes.ts";
export { validateRoles } from "./validate-roles.ts";
export { validateTasks } from "./validate-tasks.ts";
