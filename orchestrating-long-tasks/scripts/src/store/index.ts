export { initRun, type InitRunOptions } from "./capsule.ts";
export { loadRun } from "./load.ts";
export { recoverProjection } from "./recovery.ts";
export { transact } from "./transaction.ts";
export { verifyIntegrity } from "./integrity.ts";
export { verifyCapsuleDeep } from "./layout-integrity.ts";
export { indexFreshness, loadIndex } from "./capsule-index.ts";
export {
  appendCapsuleBlunder,
  loadCapsuleBlunders,
  compactCapsuleBlunders,
  resolveCapsuleBlunder,
} from "./blunder-store.ts";
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
} from "../mind/archival.ts";

