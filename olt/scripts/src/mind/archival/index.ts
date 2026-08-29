export {
  isArchivedItemType,
  __setArchivedObjectivesPersistenceTestHook,
  resolveCanonicalArchivedObjectivesPath,
  resolveArchivedObjectivesPath,
  ARCHIVED_ITEM_TYPES,
  BOILERPLATE_CAPSULE_SUBDIRECTORIES,
  DEFAULT_ARCHIVED_OBJECTIVES_FILE,
} from "./archival-chunk1.ts";
export type {
  ArchivedItemType,
  ArchivedObjectiveRecord,
  PruneBoilerplateOptions,
  PruneBoilerplateResult,
  ArchiveCapsuleOptions,
  ArchiveCapsuleResult,
  ConsolidateCapsulesOptions,
  ConsolidateCapsulesResult,
  PruneAndArchiveOptions,
  PruneAndArchiveResult,
} from "./archival-chunk1.ts";

export {
  validateArchivedObjectiveRecord,
  readArchivedObjectives,
} from "./archival-chunk2.ts";

export {
  writeArchivedObjectives,
} from "./archival-chunk3.ts";

export {
  appendArchivedObjectives,
  isItemCompleted,
  extractItemGeneration,
} from "./archival-chunk4.ts";

export {
  pruneAndArchiveGenerationalState,
  isEffectivelyEmptyDirectory,
} from "./archival-chunk5.ts";

export {
  pruneCapsuleBoilerplate,
  assertCapsuleCopyComplete,
  archiveCapsule,
} from "./archival-chunk6.ts";

export {
  consolidateCapsules,
} from "./archival-chunk7.ts";
