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
} from "./inflight-types.ts";

export {
  DEFAULT_MAX_FILE_SIZE_BYTES,
  DEFAULT_MAX_TOTAL_UNTRACKED_BYTES,
  computeSha256,
  isBinaryBuffer,
  normalizeRepoRoot,
  parseDiffSummary,
  parseGitStashes,
  parseGitStatusOutput,
  parsePorcelainStatusCode,
} from "./inflight-parsers.ts";

export { listSnapshotFiles, loadSnapshotFile, saveSnapshotFile } from "./inflight-storage.ts";

export {
  InFlightIngestionEngine,
  createInFlightSnapshot,
  inspectInFlightWork,
  listInFlightSnapshots,
  loadInFlightSnapshot,
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
} from "./intent-types.ts";

export { toCanonicalDomainCategory } from "./intent-types.ts";

export {
  classifyCategoryFromSnapshot,
  classifyDomainFromFiles,
  extractSymbolsFromText,
} from "./intent-classifier.ts";

export {
  deriveTestScopeFromWriteScope,
  generateAcceptanceCriteria,
  synthesizeIntentRationale,
  synthesizeIntentStatement,
  synthesizeIntentTitle,
} from "./intent-synthesizer.ts";

export {
  UserIntentExtractionEngine,
  extractUserIntent,
  integrateUserIntentIntoRoadmap,
  structureUserIntentAsBacklogDeliverable,
} from "./intent-engine.ts";
