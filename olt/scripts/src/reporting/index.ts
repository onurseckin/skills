export type {
  ViewportMetrics,
  VisualMetricsReport,
  ScreenshotRecord,
  ScreenshotIngestOptions,
  ScreenshotQueryOptions,
} from "./screenshot-types.ts";
export { getVisualReport, queryScreenshots } from "./screenshot-store.ts";
export { discoverScreenshotCandidates, scanDirectoryForImages } from "./screenshot-scanner.ts";
export { ingestScreenshots, ingestVisualReport } from "./screenshot-ingestion.ts";

export type {
  BrowserRunViewport,
  BrowserRunRecord,
  BrowserRunQueryOptions,
  BrowserRunIngestOptions,
} from "./browser-run-types.ts";
export { queryBrowserRuns, readBrowserRun, writeBrowserRunRecord } from "./browser-run-store.ts";
export { MAX_BROWSER_REPORT_BYTES, readBrowserRunReport } from "./browser-run-report.ts";
export { ingestBrowserRun } from "./browser-run-ingestion.ts";
export { normalizeVisualReport } from "./visual-report.ts";
export { commandEvidenceView, commandRecordPath } from "./command-evidence.ts";
export { packetEvidenceIssues } from "./packet-evidence.ts";

export type { CatalogueCounts, CapsuleCatalogue, StatusBriefParams } from "./status.ts";
export { capsuleCatalogue, formatStatusBrief, runStatus } from "./status.ts";

export {
  MANDATORY_COGNITIVE_PUSHBACKS,
  MIN_ADVERSARIAL_PROBES,
  StateMachineAuditor,
  auditBehavioralHealth,
  auditPolicyDoctor,
  checkAntiBatchingIsolation,
  checkAntiMockMutation,
  checkAstPurity,
  checkGitIndexIntegrity,
  checkMailboxHealth,
  checkPlanningDag,
  checkPolicyDoctor,
  checkPreCompletionDiagnostics,
  checkPushbackQuotas,
  checkRepositoryHygiene,
  formatDoctorReport,
  formatSocraticAuditSection,
  runDoctor,
  runDoctorDiagnostics,
} from "./doctor.ts";

export {
  refreshHandoff,
  refreshHandoffOnEscalation,
  renderHandoff,
  writeHandoff,
} from "./handoff.ts";
export { agentRows, liveWaveLine, topologyRows } from "./handoff-sections.ts";
export { renderPreplanHandoff } from "./preplan-handoff.ts";
export { workflowView } from "./workflow-view.ts";

export type {
  TaskView,
  GateView,
  CommandView,
  BranchSubTaskView,
  BranchView,
  NextActions,
} from "./action-types.ts";
export {
  CRITIC_TOKEN,
  LEASE_TOKEN,
  SUB_TASK_TOKEN,
  VALIDATION_TOKEN,
  gateArgv,
  mergeActions,
  repositoryOf,
} from "./action-types.ts";

export { leasedActions, validationActions } from "./active-actions.ts";
export { branchActions, openBranchActions } from "./branch-actions.ts";
export { completionActions } from "./completion-actions.ts";
export { nextActions } from "./next-actions.ts";
export { taskActions } from "./task-actions.ts";

export type { ArgvFlag } from "./registry-argv.ts";
export { placeholder, pushArgv, registryArgv } from "./registry-argv.ts";

export {
  assignSugiyamaRanks,
  barycentricSort,
  boundLayerWidthCoffmanGraham,
  buildOrthogonalRouteSegments,
  buildSugiyamaDagReport,
  countLayerCrossings,
  detectCyclesTarjan,
  detectIllegalBypasses,
  expandSubagentSubgraphs,
  extractFeedbackArcSet,
  formatCoordinates,
  formatImplementerValidatorTracking,
  formatNodeBadges,
  formatStatusBadge,
  formatSubagentAllocation,
  generateSugiyamaDagReport,
  getNodeStatusGlyph,
  getStatusBadge,
  getStatusGlyph,
  minimizeCrossingsBarycenter,
  renderSugiyamaDag,
  renderSugiyamaNodeBox,
  renderRoundedNodeBox,
  reverseCycleEdges,
  validateDiagnosticHealth,
} from "./sugiyama-dag/index.ts";

export {
  buildDynamicDagState,
  buildLivingTracerReport,
  buildStepTraceEntries,
  computeStepTracerSummary,
  formatDuration,
  formatSeq,
  renderAsciiTimeline,
  renderDynamicDagAscii,
  replayTelemetryEvent,
  traceCapsuleRun,
} from "./living-tracer/index.ts";

export type { DynamicDagViewOptions } from "./dag-view.ts";
export {
  dynamicDagStateToSugiyama,
  renderBranchExpansionHierarchy,
  renderDynamicDagView,
  renderSubagentRelationship,
} from "./dag-view.ts";

export type {
  SocraticDimension,
  SocraticQuestionEvaluation,
  SocraticAuditReport,
} from "./socratic-validator.ts";
export { SOCRATIC_DIMENSIONS, evaluateSocraticSelfQuestioning } from "./socratic-validator.ts";

export type { LeaseRecordView } from "./lease-agent-extractor.ts";
export {
  extractLeaseAgentId,
  extractLeaseAttempt,
  extractLeaseRole,
} from "./lease-agent-extractor.ts";

export type { ReplayContext, DynamicTaskState } from "./living-tracer/index.ts";

export type {
  SugiyamaDagReport,
  SugiyamaWaveMetrics,
  LeaseRecord,
  UnifiedReport,
  UnifiedReportView,
  UnifiedSectionData,
} from "./unified/index.ts";
export {
  buildAgentMatrixRows,
  buildAgentMatrixTable,
  buildDecisionsTable,
  buildImplementerValidatorTrackingTable,
  buildLeasesTable,
  buildTaskTopologyTable,
  buildUnifiedReport,
  buildUnifiedReportMarkdown,
  formatLeaseDecisions,
  generateDecisionsReport,
  generateLeasesReport,
  generateUnifiedReport,
  segmentTaskLifecycle,
} from "./unified/index.ts";

export {
  DARK_THEME,
  HIGH_CONTRAST_THEME,
  LIGHT_THEME,
  exportAllVisualDagFormats,
  exportDagToAscii,
  exportDagToSvg,
  exportVisualDag,
} from "./dag-exporters/index.ts";

export {
  deliverEventsToWebhook,
  formatEventToNdjson,
  readCapsuleEvents,
  renderAsciiEventStreamTable,
} from "./event-stream/index.ts";

export type { TelemetryEvent } from "./telemetry-stream.ts";
export {
  clearInMemoryTelemetrySink,
  disableInMemoryTelemetrySink,
  emitTelemetryEvent,
  enableInMemoryTelemetrySink,
  getInMemoryTelemetrySink,
  isInMemoryTelemetrySinkEnabled,
  readTelemetryStream,
  resolveTelemetryFilePath,
} from "./telemetry-stream.ts";

export {
  ACTION_EXECUTION_STATUSES,
  OmnipresentTelemetryCollector,
  buildTimeTelemetryReport,
  validateTimeTelemetryHealth,
} from "./time-telemetry/index.ts";

export {
  DoubleBufferedCanvas,
  ReactiveRenderLoop,
  TuiController,
  TuiStateStore,
  renderDashboardOverview,
} from "./tui/index.ts";

export type {
  DashboardTaskState,
  DashboardAgentState,
  DashboardOptions,
  DashboardMetrics,
  DashboardReport,
} from "./dashboard.ts";
export {
  calculateDashboardMetrics,
  generateDashboardReport,
  renderAgentMatrixSection,
  renderDashboardAscii,
  renderDashboardHeader,
  renderMicroCycleTelemetry,
  renderTaskSummaryTable,
} from "./dashboard.ts";

export type {
  NotificationPayload,
  NotificationPlatform,
  NotificationProcessSpawner,
  NotificationProcessSpawnResult,
  NotificationResult,
  PhaseCompletionNotificationOptions,
  DispatchEventRecord,
  DispatcherRegistryOptions,
  INotificationDispatcher,
  NotificationPriority,
  PlatformNotificationDeliveryResult,
  PlatformNotificationOptions,
  RateLimiterOptions,
} from "./notifications/index.ts";

export {
  DEFAULT_DARWIN_NOTIFICATION_SOUND,
  DEFAULT_LINUX_NOTIFICATION_SOUND,
  DarwinNotificationDispatcher,
  HeadlessNotificationDispatcher,
  LinuxNotificationDispatcher,
  NotificationDispatcherRegistry,
  WindowsNotificationDispatcher,
  buildPhaseNotificationPayload,
  defaultDispatcherRegistry,
  defaultNotificationSpawner,
  displaySystemNotification,
  formatElapsedDuration,
  isTestEnvironment,
  notifyPhaseCompletion,
  playCompletionChime,
  sendSystemNotification,
} from "./notifications/index.ts";
