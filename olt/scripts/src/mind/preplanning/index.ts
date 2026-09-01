export type {
  AssemblyStation,
  AssemblyStationStatus,
  BacklogItemStatus,
  BrentConcurrencyPlan,
  BrentPartition,
  ClusterOptions,
  ConcurrencyAuditResult,
  DefectStatus,
  DomainCategory,
  GitStagingInvariantRecord,
  HostSchedulerConfig,
  HostSchedulerId,
  MindAuditorStagnationReport,
  PlanGenerationOptions,
  PreplanningRunResult,
  RawBacklogItem,
  RawDefectItem,
  StagnationAuditResult,
  StragglerAssessment,
  ThematicCluster,
  ThinkingLevel,
} from "./types.ts";
export {
  CANONICAL_DOMAINS,
  classifyDomain,
  clusterBacklogAndDefects,
  computeClusterId,
  filterEligibleBacklogItems,
  filterEligibleDefects,
  generateClusterId,
  generatePlanPath,
  loadBacklogItems,
  loadDefectItems,
} from "./backlog-clusterer.ts";
export {
  assertValidBlueprintStructure,
  deriveDisjointTaskScope,
  generateAndWritePlan,
  generatePlanBlueprint,
  generatePlanMarkdown,
  writePlanFile,
} from "./plan-factory.ts";
export {
  resolveLedgerPath,
  transitionBacklogItemsToPlanned,
  transitionDefectsToPlanned,
  updateBridgeState,
  updateBridgeStateBatch,
} from "./bridge-state.ts";
export {
  type DaemonOptions,
  type PreplannerOptions,
  isPreplanningNeeded,
  runContinuousPreplanningTick,
  runPreplanningTick,
  startPreplanningDaemon,
} from "./continuous-preplanner.ts";

export type {
  DiffSummary,
  FileChangeStatus,
  GitStashEntry,
  InFlightEngineOptions,
  InFlightSnapshot,
  InFlightSnapshotOptions,
  InFlightSnapshotSummary,
  InFlightWorkInspection,
  LoadSnapshotOptions,
  SaveSnapshotOptions,
  UncommittedFileEntry,
} from "./inflight-ingestion.ts";

export {
  InFlightIngestionEngine,
  createInFlightSnapshot,
  inspectInFlightWork,
  listInFlightSnapshots,
  loadInFlightSnapshot,
  parseDiffSummary,
  parseGitStashes,
  parseGitStatusOutput,
  saveInFlightSnapshot,
} from "./inflight-ingestion.ts";

export type {
  BacklogOptions,
  IntentCategory,
  IntentDomain,
  IntentExtractionOptions,
  PriorityOneDeliverable,
  RoadmapAction,
  UserIntentRecord,
  UserIntentRoadmapIntegration,
} from "./intent-extraction.ts";

export {
  UserIntentExtractionEngine,
  extractUserIntent,
  integrateUserIntentIntoRoadmap,
  structureUserIntentAsBacklogDeliverable,
  toCanonicalDomainCategory,
} from "./intent-extraction.ts";

