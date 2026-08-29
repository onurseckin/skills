export { initRun, type InitRunOptions, type InitRunResult } from "./capsule/capsule.ts";
export { loadRun, loadRunProjection } from "./capsule/load.ts";
export { recoverProjection } from "./recovery/recovery.ts";
export { transact, transactIdempotent } from "./events/transaction.ts";
export {
  isCommittedWithRecoveryPending,
  transactionRecoveryStatus,
  type CommittedWithRecoveryPendingError,
  type TransactionPhase,
} from "./events/event-append.ts";
export { verifyIntegrity } from "./integrity/integrity.ts";
export { verifyCapsuleDeep } from "./integrity/layout-integrity.ts";
export {
  BRAINSTORMING_PATH,
  BRAINSTORMING_SCHEMA,
  BRAINSTORMING_VERSION,
  brainstormingProjection,
  materializeProjections,
  materializedProjections,
} from "./projections/materialized-projections.ts";
export {
  indexFreshness,
  loadIndex,
  refreshIndex,
  writeIndex,
  type IndexFreshness,
} from "./capsule/capsule-index.ts";
export {
  appendCapsuleDefect,
  loadCapsuleDefects,
  compactCapsuleDefects,
  resolveCapsuleDefect,
} from "./recovery/defect-store.ts";
export {
  readCaptures,
  recordCaptures,
  type CaptureRecord,
} from "./capsule/captures.ts";
export {
  blobContentDigest,
  blobRelativePath,
  linkBlobIntoView,
  listBlobs,
  putBlobFile,
  type BlobDescriptor,
  type BlobPutResult,
  type ViewLink,
  type ViewLinker,
  type ViewStorage,
} from "./layout/blobs.ts";
export {
  normalizeRunId,
} from "./capsule/run-id.ts";
export {
  runFilePath,
  safeRepoPath,
  isInsideCapsule,
  resolveCapsulesDir,
} from "./capsule/paths.ts";
export {
  detectContentFormat,
  normalizeContent,
  contentDigest,
  contentEquals,
  type ContentFormat,
  type ContentNormalizationMethod,
  type ContentDigestResult,
  type ContentEqualsResult,
  type NormalizeContentResult,
} from "./content-normalization/index.ts";
export {
  canonicalizeJson,
} from "./content-normalization/json-canonical.ts";
export {
  canonicalizeYaml,
} from "./content-normalization/yaml-canonical.ts";
export {
  canonicalizeEcmaScriptWhitespace,
} from "./content-normalization/ecmascript-whitespace.ts";
export {
  CAPSULE_LAYOUT,
  LOCKS_DIRECTORY,
  isDeclaredCapsuleEntry,
  initialCapsuleDirectories,
  renderLayoutReadme,
  type LayoutRole,
  type LayoutEntry,
} from "./layout/layout.ts";
export {
  EVENT_SCHEMA,
  FORMAT_VERSION,
  MANIFEST_SCHEMA,
  RUNTIME_VERSION,
  STATE_SCHEMA,
  RUN_ID_PATTERN,
  SHA256_PATTERN,
  CAPSULE_ID_PATTERN,
  RESERVED_STATE_KEYS,
  CHECKPOINT_INTERVAL,
  isCheckpointSequence,
  limits,
  type StoreLimits,
} from "./layout/constants.ts";
export {
  pruneCapsuleBoilerplate,
  archiveCapsule,
  consolidateCapsules,
  isEffectivelyEmptyDirectory,
  BOILERPLATE_CAPSULE_SUBDIRECTORIES,
  type PruneBoilerplateOptions,
  type PruneBoilerplateResult,
  type ArchiveCapsuleOptions,
  type ArchiveCapsuleResult,
  type ConsolidateCapsulesOptions,
  type ConsolidateCapsulesResult,
} from "../../mind/archival.ts";
