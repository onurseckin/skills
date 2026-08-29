// Fallback resolver for production and test environments
// return join(resolveCapsulesDir(), "ARCHIVED_OBJECTIVES.jsonl");
export {
  ARCHIVED_ITEM_TYPES,
  BOILERPLATE_CAPSULE_SUBDIRECTORIES,
  DEFAULT_ARCHIVED_OBJECTIVES_FILE,
  __setArchivedObjectivesPersistenceTestHook,
  appendArchivedObjectives,
  archiveCapsule,
  assertCapsuleCopyComplete,
  consolidateCapsules,
  extractItemGeneration,
  isArchivedItemType,
  isEffectivelyEmptyDirectory,
  isItemCompleted,
  pruneAndArchiveGenerationalState,
  pruneCapsuleBoilerplate,
  readArchivedObjectives,
  resolveArchivedObjectivesPath,
  resolveCanonicalArchivedObjectivesPath,
  validateArchivedObjectiveRecord,
  writeArchivedObjectives,
} from "./archival/index.ts";

export type {
  ArchivedItemType,
  ArchivedObjectiveRecord,
  ArchiveCapsuleOptions,
  ArchiveCapsuleResult,
  ConsolidateCapsulesOptions,
  ConsolidateCapsulesResult,
  PruneAndArchiveOptions,
  PruneAndArchiveResult,
  PruneBoilerplateOptions,
  PruneBoilerplateResult,
} from "./archival/index.ts";
