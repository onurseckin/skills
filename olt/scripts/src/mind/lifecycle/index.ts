// @ts-nocheck
export {
  MindCadenceEngine,
  CLOSING_FORBIDDEN_FOR_MIND,
  DEFAULT_CADENCE_BASE_INTERVAL_MS,
  DEFAULT_CADENCE_GRACE_MS,
  DEFAULT_CADENCE_MAX_INTERVAL_MS,
  PERPETUAL_NON_STOPPING_CADENCE,
  ZERO_SLEEP_DELAY_MS,
  createCadenceTrigger,
  createInitialCadenceState,
  enforceInfiniteMindCadence,
  evaluateAntiIdleRollover,
} from "./cadence/index.ts";
export type {
  CadenceEvent,
  CadenceEventListener,
  CadencePhase,
  CadenceState,
  CadenceStepInput,
  CadenceStepResult,
  CadenceTelemetry,
  CadenceTrigger,
  CadenceTriggerDispatcher,
  CadenceTriggerType,
  MindCadenceEngineOptions,
  RolloverDecision,
  RolloverEvaluationOptions,
  TriggerPriority,
} from "./cadence/index.ts";

export {
  ROUND_RESULTS,
  carryForwardFindingsAndRequirements,
  closeRoundInState,
  formatMindRoundCloseBrief,
  formatMindRoundOpenBrief,
  getAllRounds,
  getOpenRoundForObjective,
  isRoundResult,
  openRoundInState,
  reconcileRoundState,
  resolveCapsulePath,
  validateCandidateAdmitted,
  validateObjectiveStatement,
  validatePriorRoundCompleted,
  validateRoundBudget,
  validateRoundCloseArmingRail,
} from "./rounds/index.ts";
export type {
  CarryForwardOptions,
  CloseRoundInStateOptions,
  ObjectiveRecord,
  ObjectiveRecord as RoundObjectiveRecord,
  OpenRoundInStateOptions,
  RoundRecord,
  RoundResult,
} from "./rounds/index.ts";

export {
  CLOSING_FORBIDDEN_IDLE_MIND,
  DEFAULT_EVOLUTION_BASE_INTERVAL_MS,
  DEFAULT_EVOLUTION_MAX_INTERVAL_MS,
  DEFAULT_SCALING_THRESHOLDS,
  NON_STOPPING_RULE,
  balanceOrchestratorLoad,
  calculateHierarchyCapacity,
  enforcePerpetualNonStoppingCadence,
  evaluateHierarchyScaling,
  evaluatePerpetualCadence,
  executeSelfEvolutionStep,
  formatSelfEvolutionBrief,
  getEvolutionStats,
  readEvolutionHistory,
  recordEvolutionCycle,
  resolveEvolutionHistoryPath,
  runSelfEvolutionCycle,
  synthesizeDynamicPlanRevisions,
} from "./evolution/index.ts";
export type {
  EvolutionHistoryStats,
  EvolutionLedgerEntry,
  HierarchyCapacityMetrics,
  HierarchyScalingDecision,
  HierarchyScalingDirection,
  LoadBalancingAssignment,
  LoadBalancingPlan,
  OrchestratorNodeInfo,
  OrchestratorNodeStatus,
  PerpetualCadenceEvaluation,
  ScalingThresholds,
  SelfEvolutionCadenceState,
  SelfEvolutionCycleOptions,
  SelfEvolutionCycleResult,
  SelfEvolutionMode,
  SupervisoryRoleTier,
} from "./evolution/index.ts";

export {
  COGNITIVE_AUDIT_DIMENSIONS,
  DEFAULT_DIMENSIONAL_WEIGHTS,
  DEFAULT_HYPER_AUDIT_INTERVAL_MS,
  HYPER_COGNITION_VERSION,
  MAX_COGNITIVE_SCORE,
  MIND_NEVER_IDLE_MANTRA,
  MIN_COGNITIVE_SCORE,
  PROACTIVE_QUESTION_CATALOG,
  computeCognitiveScoreVector,
  createHyperCognitionEngine,
  evaluateCadenceHyperPulse,
  executeProactiveSelfQuestioningCycle,
  formatHyperCognitionBrief,
  generateOptimizationProposals,
  harvestPlanEnhancementsDuringPulse,
  runAutonomousAuditLoop,
  validateHyperCognitiveReport,
} from "./cognition/index.ts";
export type {
  CadenceHyperAction,
  CognitiveAuditDimension,
  CognitiveAuditFinding,
  CognitiveAuditResult,
  CognitiveAuditSeverity,
  CognitiveScoreVector,
  DimensionalWeights,
  DiscoveredSubtask,
  HyperCognitionEngine,
  HyperCognitionEngineOptions,
  HyperCognitivePulseReport,
  HyperPulseInput,
  MindPulseContext,
  OptimizationProposal,
  PlanEnhancementHarvest,
  ProactiveQuestionCycle,
  ProactiveQuestionSpec,
  QuestionCycleInput,
  SystemStateMetrics,
} from "./cognition/index.ts";

export {
  MIND_HARD_ZEROS,
  MIND_PROACTIVE_BANDWIDTH_ACTIVITIES,
  MIND_STRATEGIC_ALTITUDE,
  diagnoseMacroDag,
  evaluateStrategicCandidateAdmission,
  executeProactiveMindCognition,
  formatStrategicCognitionBrief,
  groomBacklog,
  planProactiveRoadmap,
  verifyMindRoleStrategicInvariants,
} from "./purpose/index.ts";
export type {
  BacklogGroomingItem,
  BacklogGroomingOptions,
  BacklogGroomingResult,
  MacroDagBottleneck,
  MacroDagDiagnosticOptions,
  MacroDagDiagnosticResult,
  MacroDagTaskNode,
  MindProactiveBandwidthActivity,
  ProactiveMindCognitionOptions,
  ProactiveMindCognitionResult,
  ProactiveRoadmapPlan,
  ProactiveRoadmapPlanningOptions,
  ProactiveWavePlan,
  ProactiveWaveTask,
  StrategicCandidate,
  StrategicCandidateAdmissionOptions,
  StrategicCandidateAdmissionResult,
  StrategicCandidateEvaluation,
} from "./purpose/index.ts";

export {
  writeLastPulse,
  readLastPulse,
  reconcileLastPulse,
  resolveLastPulsePath,
  pulseProducedActivity,
  DEFAULT_CONSECUTIVE_CRASH_THRESHOLD,
  reclaimDeadPulse,
  type LastPulseRecord,
  type ReclaimDeadPulseResult,
} from "./pulse/index.ts";

export {
  executeMindObserve,
  formatMindObserveBrief,
  resolveCanonicalObservationsPath,
  resolveObservationsPath,
} from "./observe/index.ts";

export {
  enforceIsolatedTaskDispatch,
  deployHierarchy,
  atomicAdmissionToDispatch,
} from "./deploy/index.ts";

export {
  mindTaskDiscoveryCommand,
  mindSelfEvolveCommand,
  mindStrategicCognitionCommand,
  MIND_TASK_DISCOVERY_COMMAND_SPEC,
  MIND_SELF_EVOLVE_COMMAND_SPEC,
  MIND_STRATEGIC_COGNITION_COMMAND_SPEC,
} from "../core/index.ts";

export {
  CANONICAL_WATCHDOG_FILE,
  DEFAULT_WATCHDOG_FILE,
  resolveCanonicalWatchdogStorePath,
  resolveWatchdogStorePath,
  loadMindWatchdogStore,
  saveMindWatchdogStore,
  auditProcessLiveness,
  createDefaultWatchdogStore,
} from "./watchdog/index.ts";

export type {
  HeartbeatOptions,
  RegisterWatchdogOptions,
  TerminateOptions as WatchdogTerminateOptions,
  WatchdogRecord,
  WatchdogStatus,
  WatchdogStore,
} from "./watchdog/index.ts";

export {
  computeManifestSha256Pin,
  computeMerkleGenesisBinding,
  resolveManifestPath,
  syncOrchestratorToManifest,
  validateCapsuleManifestBinding,
} from "./manifest-sync.ts";
export type {
  ManifestSyncOptions,
  ManifestSyncResult,
  ManifestValidateOptions,
  ManifestValidateResult,
} from "./manifest-sync.ts";

export {
  DEFAULT_ORCHESTRATOR_LEDGER_FILE,
  DEFAULT_ORCHESTRATOR_LOCK_FILE,
  VALID_LIFECYCLE_STATUSES,
  VALID_HOST_TYPES,
  withOrchestratorLedgerLock,
  loadOrchestratorLedger,
  registerOrchestratorSpawn,
  deregisterOrchestrator,
  updateOrchestratorHeartbeat,
} from "./orchestration/index.ts";
export type {
  OrchestratorLifecycleStatus,
  OrchestratorHostType,
  OrchestratorRegistrationRecord,
  NewOrchestratorRecordInput,
} from "./orchestration/index.ts";

export {
  detectGhostOrchestrators,
  reconcileOrchestratorRoster,
  terminateDetachedOrchestrator,
} from "./ghost-reconciler.ts";
export type {
  DetectGhostOptions,
  GhostActionTaken,
  GhostOrchestratorFinding,
  GhostReason,
  LiveSubagentInfo,
  ReconcileRosterOptions,
  RosterReconciliationResult,
  TerminateOptions,
} from "./ghost-reconciler.ts";

export type {
  CanDispatchResult,
  ExternalThrottleEvent,
  GovernorStatus,
  ResourceGovernorLimits,
  ResourceGovernorOptions,
  ResourceGovernorState,
  ResourceHeadroom,
  ResourceType,
} from "./resource-governor.ts";

export {
  ResourceGovernor,
  calculateRemainingHeadroom,
  calculateUtilizationRatio,
  createResourceGovernor,
  isStateStricter,
} from "./resource-governor.ts";

export type {
  AutoWakeProbeConfig,
  FrozenTimer,
  PausableTask,
  RestorationResult,
  SuspendedAnimationSnapshot,
  SuspendedTaskNode,
} from "./suspended-animation.ts";

export {
  AutoWakeProber,
  SuspendedAnimationEngine,
  archiveSnapshotFile,
  canonicalJsonStringify,
  cleanupSnapshotFile,
  computeExponentialBackoffDelay,
  computeSnapshotChecksum,
  createSuspendedAnimationEngine,
  readSnapshotFromDisk,
  resolveSuspendedStatePath,
  validateTaskDagAcyclicity,
  verifySnapshotIntegrity,
  writeSnapshotToDisk,
} from "./suspended-animation.ts";

export type {
  CharterResolutionResult,
  MindInitFlowOptions,
  MindInitFlowResult,
  MindInitOptions,
  MindInitResult,
} from "./mind-init-flow.ts";

export {
  AutonomousMindInitializer,
  CANONICAL_BEDROCK_INVARIANTS_LIST,
  DEFAULT_STANDARD_CHARTER_YAML,
  executeAutonomousMindInit,
  resolveOrGenerateCharter,
} from "./mind-init-flow.ts";

