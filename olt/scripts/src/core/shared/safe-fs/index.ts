export {
  assertNoRepositoryBoundaryCrossed,
  assertSafeToDelete,
  refuse,
  assertNotDenylisted,
  assertWithinAllowedRoots,
} from "./interlock.ts";
export type {
  AuditSink,
  DestructiveAuditEvent,
  SafeDeleteOptions,
  SafeFsRefusalRule,
} from "./interlock.ts";

export {
  MIN_PATH_SEGMENTS,
  canonicalizeTarget,
  isSelfOrStrictAncestor,
  pathExists,
  realpathOfExistingAncestor,
  segmentCount,
} from "./path-safety.ts";

export {
  emitAudit,
  safeCpSync,
  safeMkdirSync,
  safeRenameSync,
  safeRmSync,
  safeWriteFileSync,
} from "./atomic.ts";
export type {
  SafeCopyOptions,
  SafeMkdirOptions,
  SafeRenameOptions,
  SafeWriteOptions,
} from "./atomic.ts";
