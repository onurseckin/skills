export { proposeBatch } from "./dispatch/propose-batch.ts";
export {
  schedulingMetrics,
  generateTaskDagBadge,
  generateWaveLaneBadges,
  formatWorkSpanBadge,
} from "./topology/metrics.ts";
export type { SchedulingMetrics } from "./topology/metrics.ts";
export { computeWorkSpanMetrics, computeResourceDisjointness } from "./topology/dynamic-metrics.ts";
export type { WorkSpanMetrics, ResourceDisjointnessMetrics } from "./topology/dynamic-types.ts";
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
export type {
  OrchestratorPartition,
  CrossOrchestratorBarrier,
  ValidatorDemand,
  DynamicTopologySynthesis,
  DynamicTopologyWave,
  DynamicTopologyOptions,
} from "./topology/dynamic-types.ts";
export {
  evaluateHierarchicalDecision,
  assertHierarchicalCompliance,
  HIERARCHICAL_TIERS,
} from "./conflict/decision-tree.ts";
export type {
  AgentRoleHierarchy,
  HierarchicalAction,
  HierarchicalDecisionContext,
  HierarchicalDecisionResult,
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
} from "./core/index.ts";

export type {
  AgentRegistryAccuracyAudit,
  CircularDependenciesProbeResult,
  DoctorErrorResolutionAudit,
  GateCoverageProbeResult,
  GraphHealthAuditReport,
  GraphHealthIssue,
  OrphanedTasksProbeResult,
  PlanEnhancementAudit,
  RoleBoundaryAdherenceAudit,
  ScopeCollisionHazard,
  ScopeCollisionProbeResult,
  StaleLeaseInfo,
  StaleLeasesProbeResult,
  Supervisory5PointHealthReport,
  Supervisory5PointOptions,
  SupervisoryProbeDispatchResult,
  SupervisoryTopLeader,
  SupervisoryWatchdogAuditReport,
  TaskRecoveryRecord,
  TaskRecoveryResult,
  WorkSpanHealthAudit,
  ScheduledTaskDispatch,
  BlockedTaskInfo,
  ScheduledWaveResult,
  SchedulerEngineOptions,
} from "./core/index.ts";
export {
  computeReceiptHash,
  generateReceiptBadge,
  generateReceiptSummaryBadge,
  generateAsciiDagBadges,
  formatDiagnosticReceiptsMarkdown,
  runInspectorDoctor,
  runInspectorHealth,
  runInspectorDagView,
  runInspectorUnifiedReport,
  runScriptBackedDiagnostics,
  deriveCounterfactualRequirement,
  normalizeCriticFinding,
  selectImplementerValidatorPair,
  detectDeterministicRepeat,
  compileRepairDag,
  routeCriticFeedback,
  evaluateRepairCycleConvergence,
  type DiagnosticInspectorName,
  type DiagnosticReceiptStatus,
  type CliDiagnosticReceipt,
  type ScriptBackedDiagnosticsOptions,
  type ScriptBackedDiagnosticsResult,
  type ReviewerRole,
  type CriticFindingInput,
  type CriticFindingDetail,
  type PairAssignmentStrategy,
  type ImplementerValidatorBinding,
  type ClosedLoopRepairPayload,
  type CompiledRepairDagNode,
  type CompiledRepairDag,
  type RouteCriticFeedbackOptions,
  type RouteCriticFeedbackResult,
} from "./diagnostics/index.ts";
export {
  executePulseTick,
  executePulseTickWithDiagnostics,
  runPulseLoop,
} from "./feedback/pulse-core.ts";
export type {
  PulseLoopOptions,
  PulseLoopResult,
  PulseTickOptions,
  PulseTickResult,
} from "./feedback/pulse-types.ts";
export { ParallelWaveDispatchEnforcer, type WaveTopology } from "./dispatch/parallel-enforcer.ts";
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
} from "./dispatch/multi-domain-dispatch.ts";
export type {
  MultiDomainBatchOptions,
  MultiDomainBatchResult,
  MultiDomainBlockedTaskInfo,
  MultiDomainTaskDispatch,
  MultiDomainValidatorDispatchOptions,
  MultiDomainValidatorDispatchResult,
  MultiDomainWaveOptions,
  MultiDomainWaveResult,
  TaskDomain,
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
export type {
  UnlimitedDepthSchedulerConfig,
  ValidatorPairingRecord,
  UnboundedWavePartition,
  DepthMetrics,
  CriticalPathDepthResult,
  DepthInvariantValidationResult,
  PairValidatorsOptions,
  UnlimitedDepthScheduleResult,
} from "./topology/unlimited/unlimited-types.ts";
export {
  resolveAgentSchedulerConfig,
  resolveSchedulerIntervalSeconds,
  resolveSchedulerCron,
  isSchedulerEnabled,
  DEFAULT_HOST_INTERVAL_SECONDS,
} from "./host-cadence.ts";
export {
  CognitiveDirectiveGenerator,
  formatDirectiveMarkdown,
  generateCognitiveDirective,
  generateCognitiveSchedulerPrompt,
  generateProbingDirective,
  COGNITIVE_DIRECTIVE_DIMENSIONS,
  SOCRATIC_CATALOG,
  selectSocraticQuestions,
  assessStagnationState,
  generateAntiStagnationTriggers,
  generateCognitiveSteps,
  extractContextAnchors,
  type AntiStagnationTrigger,
  type CognitiveDirectiveDimension,
  type CognitiveProbingDirective,
  type CognitivePromptOptions,
  type CognitiveStep,
  type ContextAnchor,
  type SocraticQuestion,
  type StagnationAssessment,
} from "./prompt/index.ts";
