export {
  agentRegisterCommand,
  agentReportCommand,
  agentReleaseCommand,
  agentListCommand,
} from "./agent-ops.ts";
export { authorityDecideCommand } from "./authority-ops.ts";
export type {
  DefectStatus,
  RGBColor,
  ApcaBadgeInfo,
  ApcaContrastCompliance,
  AuditedDefect,
  DefectAuditSummary,
  DefectAuditCommandResult,
} from "./defect-audit.ts";
export {
  calculateApcaLightnessContrast,
  getApcaBadgeInfo,
  renderApcaContrastBadge,
  discoverDefectFiles,
  renderAsciiDefectTable,
  formatDefectAuditReport,
  defectAuditCommand,
} from "./defect-audit.ts";
export {
  branchOpenCommand,
  branchClaimCommand,
  branchSubmitCommand,
  branchCollectCommand,
  branchAbandonCommand,
  branchStatusCommand,
} from "./branch-ops.ts";
export { evaluateManifestFile, findManifestsInDir, captureEvalCommand } from "./capture-eval.ts";
export {
  generateInitialConfigYaml,
  generateInitialConfigJson,
  captureInitCommand,
} from "./capture-init.ts";
export {
  CAPTURE_RUN_MISSING_PROVIDER_MESSAGE,
  CAPTURE_RUN_MISSING_PROVIDER_FIX,
  captureRunCommand,
} from "./capture-run.ts";
export { coordinatorPushbackCommand } from "./coordinator-pushback.ts";
export type { FileCoverageRecord, CoverageAuditSummary } from "./coverage-check.ts";
export {
  parseCoverageTable,
  loadBunfigCoverageThreshold,
  coverageCheckCommand,
} from "./coverage-check.ts";
export {
  criticStartCommand,
  criticReviewCommand,
  criticRejectCommand,
  criticRemediateCommand,
} from "./critic-ops.ts";
export type {
  DagViewOptions,
  DagWaveMetrics,
  DagNodeSummary,
  ActiveAgentInfo,
  ParallelizationRecommendation,
  WaveInfo,
  DependencyForensicItem,
  SerializationAnalysisItem,
  MultiCoordinatorOpportunity,
  DagViewReport,
  DagViewResult,
} from "./dag-view.ts";
export {
  activeAgentBadge,
  renderAsciiDag,
  renderNodeBox,
  renderVisualDag,
  statusBadge,
  statusGlyph,
  findLatestCapsuleIn,
  resolveCapsuleRun,
  analyzeDependencyForensics,
  analyzeSerialization,
  analyzeMultiCoordinatorOpportunities,
  analyzeParallelization,
  dagViewCommand,
  executeDagViewCommand,
} from "./dag-view.ts";
export {
  dagRenderCommand,
  executeDagRenderCommand,
  dagTraceCommand,
  executeDagTraceCommand,
} from "./dag.ts";
export {
  doctorCommand,
  healthCommand,
  recoverCommand,
  repairProjectionCommand,
} from "./diagnostics-ops.ts";
export { PATH_SAFETY_AND_INTEGRITY_ENTRIES } from "./explain-data-path-integrity.ts";
export { PLATFORM_AND_LOCK_ENTRIES } from "./explain-data-platform.ts";
export { INVALID_STATE_AND_ARGUMENT_ENTRIES } from "./explain-data-state-argument.ts";
export type { ExplainExample, ExplainCause, ExplainEntry } from "./explain-data-types.ts";
export { example, cause } from "./explain-data-types.ts";
export { EXPLAIN_ENTRIES } from "./explain-data.ts";
export { resolveExampleLine, explainCommand } from "./explain-ops.ts";
export type {
  FeedbackListResult,
  FeedbackIngestResult,
  FeedbackDrainResult,
} from "./feedback-ops.ts";
export {
  feedbackListCommand,
  feedbackIngestCommand,
  feedbackDrainCommand,
} from "./feedback-ops.ts";
export { gateProveCommand } from "./gate-prove.ts";
export { exportGraphJsonCommand } from "./graph-export.ts";
export {
  findingGetCommand,
  reportGetCommand,
  evidenceGetCommand,
  evidenceScreenshotsCommand,
} from "./inspection-ops.ts";
export { installCommand, installationStatusCommand } from "./install-ops.ts";
export type { MemoryQueryCommandResult } from "./memory-ops.ts";
export { memoryQueryCommand } from "./memory-ops.ts";
export type { MetaAuditCommandResult } from "./meta-audit.ts";
export {
  renderForensicsIncidentTable,
  renderEfficiencyMetricsTable,
  formatMetaAuditReport,
  metaAuditCommand,
} from "./meta-audit.ts";
export type { MindAdmitResult } from "./mind-admit.ts";
export { formatMindAdmitBrief, mindAdmitCommand, mindDeclineCommand } from "./mind-admit.ts";
export type { MindAuditStartResult, MindAuditReportResult } from "./mind-audit.ts";
export {
  formatMindAuditStartBrief,
  mindAuditStartCommand,
  formatMindAuditReportBrief,
  mindAuditReportCommand,
} from "./mind-audit.ts";
export type { MindCandidate, MindCandidateResult } from "./mind-candidate.ts";
export { formatMindCandidateBrief, mindCandidateCommand } from "./mind-candidate.ts";
export { mindEscalateCommand } from "./mind-escalate.ts";
export { mindHaltCommand } from "./mind-halt.ts";
export type { MindInitResult } from "./mind-init.ts";
export { formatMindInitBrief, mindInitCommand } from "./mind-init.ts";
export type { MindObserveResult } from "./mind-observe.ts";
export { formatMindObserveBrief, mindObserveCommand } from "./mind-observe.ts";
export type { MindPulseOpenResult } from "./mind-pulse-open.ts";
export { formatMindPulseOpenBrief, mindPulseOpenCommand } from "./mind-pulse-open.ts";
export type {
  MindPulseTelemetryBudget,
  MindPulseWorkSpanMetrics,
  MindPulseActiveAgentCoordinate,
  MindPulseWaveLaneInfo,
  MindCognitiveTelemetry,
  MindPulseResult,
} from "./mind-pulse.ts";
export {
  CLOSING_FORBIDDEN_FOR_MIND,
  computeMindCognitiveTelemetry,
  formatMindPulseActiveBrief,
  formatMindPulseOpenedBrief,
  mindPulseCommand,
  formatPulseDirective,
} from "./mind-pulse.ts";
export type { MindQuiesceResult } from "./mind-quiesce.ts";
export { formatMindQuiesceBrief, mindQuiesceCommand } from "./mind-quiesce.ts";
export type { MindRotateCommandResult } from "./mind-rotate.ts";
export { formatMindRotateBrief, mindRotateCommand } from "./mind-rotate.ts";
export type { MindRoundOpenResult, MindRoundCloseResult } from "./mind-round.ts";
export { mindRoundOpenCommand, mindRoundCloseCommand } from "./mind-round.ts";
export { mindWakeCommand } from "./mind-wake.ts";
export { deriveRunId, firstAvailableRunId } from "./orchestrate-slug.ts";
export { orchestrateCommand } from "./orchestrate.ts";
export type { OrchestratorCommandContext } from "./orchestrator-ops.ts";
export {
  DEFAULT_WATCH_INTERVAL_SECONDS,
  orchestratorSuperviseCommand,
  orchestratorRunCommand,
} from "./orchestrator-ops.ts";
export { orphanDisposeCommand } from "./orphan-ops.ts";
export { capsulePlanningStore, planClaimCommand, planApplyCommand } from "./plan-apply.ts";
export type { AuditAcceptance } from "./plan-audit.ts";
export {
  parseAuditAcceptance,
  recordPlanAudit,
  recordAuditAcceptance,
  planAuditCommand,
} from "./plan-audit.ts";
export { planCompileCommand } from "./plan-compile.ts";
export type {
  GateSource,
  PlannedTaskBinding,
  PlanBindings,
  ResolvedGate,
  GateRequest,
} from "./plan-replan-bindings.ts";
export {
  parseGateArgv,
  readPlanBindings,
  parentTasks,
  resolveClusterGate,
  resolveClusterFindingRequirement,
} from "./plan-replan-bindings.ts";
export type { ReplanFindingsInput } from "./plan-replan-findings.ts";
export { UNREPORTED_REMEDIATION, collectReplanFindings } from "./plan-replan-findings.ts";
export { planReplanCommand } from "./plan-replan.ts";
export { planValidateStartCommand, planReviewCommand } from "./plan-validate.ts";
export { planInitCommand, planEnhanceCommand, planAddCommand, planStatusCommand } from "./plan.ts";
export { queueNextCommand, queueListCommand, queueWaveCommand, queuePopCommand } from "./queue.ts";
export {
  resolutionProofs,
  assertNoResolutions,
  assertOpenFindingsAnswered,
} from "./review-resolutions.ts";
export { roleCheatSheetCommand } from "./role-cheat-sheet.ts";
export {
  resolvePhaseCompletionResult,
  appendReleaseFailureWarning,
  runCompleteCommand,
  runConsolidateCommand,
  runArchiveCommand,
  runStatusCommand,
  runExecCommand,
} from "./run-ops.ts";
export { runInitCommand } from "./run-init.ts";
export type { ScopeExpandResult } from "./scope-expand.ts";
export { scopeExpandCommand } from "./scope-expand.ts";
export type { ShellExecutionResult } from "./shell.ts";
export {
  setShellCommandDependenciesForTesting,
  persistStandaloneReceipt,
  shellCommand,
} from "./shell.ts";
export type {
  SmartTaskSynthesizeResult,
  SmartTaskIngestResult,
  SmartTaskQueueListResult,
  SmartTaskQueuePopResult,
  SmartTaskQueueCompleteResult,
  SmartTaskQueueFailResult,
  SmartTaskQueueReclaimResult,
  SmartTaskCycleResult,
} from "./smart-task-ops.ts";
export {
  smartTaskSynthesizeCommand,
  smartTaskIngestCommand,
  smartTaskQueueListCommand,
  smartTaskQueuePopCommand,
  smartTaskQueueCompleteCommand,
  smartTaskQueueFailCommand,
  smartTaskQueueReclaimCommand,
  smartTaskCycleCommand,
} from "./smart-task-ops.ts";
export type { StreamEventsResult } from "./stream-events.ts";
export { streamEventsCommand } from "./stream-events.ts";
export { summaryExportCommand, summaryViewCommand } from "./summary-ops.ts";
export { taskAbandonCommand } from "./task-abandon.ts";
export { taskAssignRepairerCommand } from "./task-assign-repairer.ts";
export { taskBriefCommand } from "./task-brief.ts";
export type {
  TypeCheckDiagnostic,
  TypeCheckResult,
  LintCheckResult,
  TaskCheckSummary,
  ResolveTargetFilesOptions,
} from "./task-check.ts";
export {
  SUPPORTED_EXTENSIONS,
  isSupportedSourceFile,
  collectSourceFilesRecursively,
  resolveTargetFiles,
  findNearestTsconfig,
  performIncrementalTypecheck,
  performAstLintCheck,
  formatTaskCheckMarkdown,
  computeTaskCheckVerdict,
  taskCheckCommand,
} from "./task-check.ts";
export { taskClaimCommand, taskHeartbeatCommand } from "./task-claim.ts";
export { taskSubmitCommand, taskReleaseCommand } from "./task-ops.ts";
export { taskProbeCommand } from "./task-probe.ts";
export { taskRejectCommand } from "./task-reject.ts";
export type { ReviewPolicy } from "./task-review-support.ts";
export {
  buildProbeDemand,
  buildReviewFinding,
  failingVerdictInput,
  nextFindingRound,
  parseSeverity,
  resolveFindingRequirement,
  repoRootOf,
  reviewPolicyFor,
  collectTaskScreenshots,
  collectCompanionManifests,
  runDualChannelAudit,
  dualChannelRefusalMessage,
  persistProbeReport,
  persistReviewReport,
  resolveCheckIds,
  gateProofCommand,
  finalizePassingTask,
} from "./task-review-support.ts";
export { assertValidReviewer, taskReviewCommand } from "./task-review.ts";
export { taskValidateStartCommand } from "./task-validation-start.ts";
export { testSummaryCommand } from "./test-summary.ts";
export type {
  TodoListResult,
  TodoAddResult,
  TodoDrainResult,
  TodoSealResult,
  TodoCleanResult,
} from "./todo-ops.ts";
export {
  todoListCommand,
  todoAddCommand,
  todoDrainCommand,
  todoSealCommand,
  todoCleanCommand,
  mindQueueListCommand,
  mindQueueAddCommand,
  mindQueueDrainCommand,
  mindQueueSealCommand,
  mindQueueCleanCommand,
} from "./todo-ops.ts";
export {
  reportUnifiedCommand,
  reportDagCommand,
  reportGraphCommand,
  reportGraphJsonCommand,
  reportHealthCommand,
  reportLeasesCommand,
  reportDecisionsCommand,
} from "./unified-reporting.ts";
export { usageReportCommand } from "./usage-report.ts";
export { quotaCheckCommand } from "./quota-check.ts";
export {
  watchdogStatusCommand,
  watchdogCleanupCommand,
  watchdogPhaseCleanupCommand,
  watchdogVerifyCommand,
  watchdogProbeCommand,
} from "./watchdog-ops.ts";
export type { TaskLeaseSummary, TaskValidationSummary } from "./whoami.ts";
export {
  worktreeCreateCommand,
  worktreeLandCommand,
  worktreeListCommand,
  worktreeCleanCommand,
  worktreeStatusCommand,
  worktreeReclaimCommand,
} from "./worktree-ops.ts";
export { quotaFreezeCommand } from "./quota-freeze.ts";
export { quotaResumeCommand } from "./quota-resume.ts";
export {
  policyGetCommand,
  policySetCommand,
  policyInitCommand,
  policyCheckDriftCommand,
} from "./policy-ops.ts";
export { factoryPreplanCommand, factoryStatusCommand } from "./factory-ops.ts";
export { notifyPhaseCommand, notifyTestCommand } from "./notify-ops.ts";
export type { MsgSendResult } from "./msg-send.ts";
export { msgSendCommand } from "./msg-send.ts";
export type { MsgRecvResult } from "./msg-recv.ts";
export { msgRecvCommand } from "./msg-recv.ts";
export type { MsgPollResult } from "./msg-poll.ts";
export { msgPollCommand } from "./msg-poll.ts";
export type { MailboxSummary, MsgListResult } from "./msg-list.ts";
export { msgListCommand } from "./msg-list.ts";
export {
  taskAddCommand,
  executeTaskAdd,
  taskListCommand,
  executeTaskList,
  taskLeaseCommand,
  taskCompleteCommand,
  taskFailCommand,
  taskPruneCommand,
} from "./task-queue-ops.ts";
export {
  roleListCommand,
  executeRoleList,
  roleProfileCommand,
  executeRoleProfile,
} from "./role-ops.ts";
export {
  hygieneAuditCommand,
  executeHygieneAudit,
  hygieneFixCommand,
  executeHygieneFix,
} from "./hygiene-ops.ts";
export { defectRecordCommand, defectResolveCommand, defectListCommand } from "./defect-ops.ts";
