export { proposeBatch } from "./dispatch/propose-batch.ts";
export {
  schedulingMetrics,
  generateTaskDagBadge,
  generateWaveLaneBadges,
  formatWorkSpanBadge,
  type SchedulingMetrics,
} from "./topology/metrics.ts";
export { computeWorkSpanMetrics, computeResourceDisjointness } from "./topology/dynamic-metrics.ts";
export {
  type WorkSpanMetrics,
  type ResourceDisjointnessMetrics,
} from "./topology/dynamic-types.ts";
export {
  resourceConflict,
  scopeConflict,
  hasActiveOwnership,
  ownershipConflicts,
} from "./conflict/conflicts.ts";
export { computeTopology, type TopologyConfig, type TopologyInputs } from "./topology/topology.ts";
export { recordTopology } from "./topology/persist-topology.ts";
export { readySet, type ReadyEntry, type ReadySetSelection } from "./dispatch/ready-set.ts";
export {
  partitionOrchestratorDomains,
  calculateValidatorAllocations,
  calculateCriticConcurrency,
} from "./topology/dynamic-allocations.ts";
export { synthesizeDynamicTopology } from "./topology/dynamic-synthesize.ts";
export {
  type OrchestratorPartition,
  type CrossOrchestratorBarrier,
  type ValidatorDemand,
  type DynamicTopologySynthesis,
  type DynamicTopologyWave,
  type DynamicTopologyOptions,
} from "./topology/dynamic-types.ts";
export {
  evaluateHierarchicalDecision,
  assertHierarchicalCompliance,
  HIERARCHICAL_TIERS,
  type AgentRoleHierarchy,
  type HierarchicalAction,
  type HierarchicalDecisionContext,
  type HierarchicalDecisionResult,
} from "./conflict/decision-tree.ts";
export {
  SchedulerEngine,
  createSchedulerEngine,
  auditDoctorGate,
  auditGraphHealth,
  auditSupervisory5PointHealth,
  auditSupervisoryWatchdog,
  assertDoctorGatePassed,
  determineTopLeader,
  dispatchSupervisoryHealthProbe,
  formatSupervisoryHealthMarkdown,
  probeAgentRegistryAccuracy,
  probeCircularDependencies,
  probeDoctorErrorResolution,
  probeGateCoverageViolations,
  probeOrphanedTasks,
  probePlanEnhancementNeeds,
  probeRoleBoundaryAdherence,
  probeScopeCollisionHazards,
  probeStaleLeases,
  probeWorkSpanParallelizationHealth,
  recoverStaleTasks,
  type AgentRegistryAccuracyAudit,
  type CircularDependenciesProbeResult,
  type DoctorErrorResolutionAudit,
  type GateCoverageProbeResult,
  type GraphHealthAuditReport,
  type GraphHealthIssue,
  type OrphanedTasksProbeResult,
  type PlanEnhancementAudit,
  type RoleBoundaryAdherenceAudit,
  type ScopeCollisionHazard,
  type ScopeCollisionProbeResult,
  type StaleLeaseInfo,
  type StaleLeasesProbeResult,
  type Supervisory5PointHealthReport,
  type Supervisory5PointOptions,
  type SupervisoryProbeDispatchResult,
  type SupervisoryTopLeader,
  type SupervisoryWatchdogAuditReport,
  type TaskRecoveryRecord,
  type TaskRecoveryResult,
  type WorkSpanHealthAudit,
  type ScheduledTaskDispatch,
  type BlockedTaskInfo,
  type ScheduledWaveResult,
  type SchedulerEngineOptions,
} from "./core/index.ts";
export {
  computeReceiptHash,
  formatDiagnosticReceiptsMarkdown,
  generateAsciiDagBadges,
  generateReceiptBadge,
  generateReceiptSummaryBadge,
  runInspectorDagView,
  runInspectorDoctor,
  runInspectorHealth,
  runInspectorUnifiedReport,
  runScriptBackedDiagnostics,
  type CliDiagnosticReceipt,
  type DiagnosticInspectorName,
  type DiagnosticReceiptStatus,
  type ScriptBackedDiagnosticsOptions,
  type ScriptBackedDiagnosticsResult,
} from "./diagnostics/index.ts";
export {
  executePulseTick,
  executePulseTickWithDiagnostics,
  runPulseLoop,
} from "./feedback/pulse-core.ts";
export {
  type PulseLoopOptions,
  type PulseLoopResult,
  type PulseTickOptions,
  type PulseTickResult,
} from "./feedback/pulse-types.ts";
export {
  deriveCounterfactualRequirement,
  normalizeCriticFinding,
  selectImplementerValidatorPair,
  detectDeterministicRepeat,
  compileRepairDag,
  routeCriticFeedback,
  evaluateRepairCycleConvergence,
  type ReviewerRole,
  type CriticFindingInput,
  type CriticFindingDetail,
  type ImplementerValidatorBinding,
  type PairAssignmentStrategy,
  type ClosedLoopRepairPayload,
  type CompiledRepairDagNode,
  type CompiledRepairDag,
  type RouteCriticFeedbackOptions,
  type RouteCriticFeedbackResult,
} from "./diagnostics/critic/index.ts";
export {
  classifyTaskDomain,
  derivePrimaryValidatorDomain,
  dispatchMultiDomainValidators,
  evaluateMultiDomainBatch,
  isMultiDomainDispatchEligible,
  isDualValidationRequired,
  getRequiredValidatorDomains,
  MULTI_DOMAIN_PARALLELISM_THRESHOLD,
  proposeMultiDomainWave,
  resolveParallelismFactor,
  type MultiDomainBatchOptions,
  type MultiDomainBatchResult,
  type MultiDomainBlockedTaskInfo,
  type MultiDomainTaskDispatch,
  type MultiDomainValidatorDispatchOptions,
  type MultiDomainValidatorDispatchResult,
  type MultiDomainWaveOptions,
  type MultiDomainWaveResult,
  type TaskDomain,
} from "./dispatch/multi-domain-dispatch.ts";
export { SkillAuditorPolicy, MetaAuditorPolicy } from "./diagnostics/skill-auditor-policy.ts";
export { scheduleUnlimitedDepthDAG } from "./topology/unlimited/unlimited-core.ts";
export {
  pairValidatorsStrictly,
  assertUnboundedConcurrencySafety,
  validateDepthInvariants,
} from "./topology/unlimited/unlimited-pairing.ts";
export {
  taskRecord,
  conflicting,
  derivedRationale,
  computeCriticalPathDepth,
} from "./topology/unlimited/unlimited-utils.ts";
export {
  type UnlimitedDepthSchedulerConfig,
  type ValidatorPairingRecord,
  type UnboundedWavePartition,
  type DepthMetrics,
  type CriticalPathDepthResult,
  type DepthInvariantValidationResult,
  type PairValidatorsOptions,
  type UnlimitedDepthScheduleResult,
} from "./topology/unlimited/unlimited-types.ts";
