export {
  isArchivedItemType,
  __setArchivedObjectivesPersistenceTestHook,
  resolveCanonicalArchivedObjectivesPath,
  resolveArchivedObjectivesPath,
  ARCHIVED_ITEM_TYPES,
  BOILERPLATE_CAPSULE_SUBDIRECTORIES,
  DEFAULT_ARCHIVED_OBJECTIVES_FILE,
} from "./types.ts";
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
} from "./types.ts";

export { validateArchivedObjectiveRecord, readArchivedObjectives } from "./generational.ts";

export { writeArchivedObjectives } from "./compactor.ts";

export { appendArchivedObjectives, isItemCompleted, extractItemGeneration } from "./reader.ts";

export { pruneAndArchiveGenerationalState, isEffectivelyEmptyDirectory } from "./writer.ts";

export { pruneCapsuleBoilerplate, assertCapsuleCopyComplete, archiveCapsule } from "./validator.ts";

export { consolidateCapsules } from "./pruner.ts";
