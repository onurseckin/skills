export type {
  RegisterSessionOptions,
  ResolveSessionOptions,
  SessionIdentity,
  SessionSnapshot,
  StagedSessionGrant,
} from "./types.ts";

export {
  sessionLockCleanupFault,
  sessionPersistenceObserver,
  setSessionLockCleanupFailureForTesting,
  setSessionPersistenceObserverForTesting,
} from "./testing-hooks.ts";

export {
  assertRealDirectory,
  assertSafeSessionComponent,
  assertSessionPid,
  assertSingleLinkRegular,
  noFollow,
  openVerifiedDirectory,
  resolveGlobalSessionsDir,
  resolveSessionRepositoryRoot,
  sameInode,
} from "./paths.ts";

export {
  atomicSessionWrite,
  formatSafeErrorCause,
  inferCanExecute,
  readOwnDataString,
  readPersistedSession,
  restoreSnapshotIfUnchanged,
  secureReadSession,
  snapshotSession,
  withSessionAuthorityLock,
} from "./io.ts";

export {
  assertActiveCapsuleLease,
  pruneStaleSessions,
  registerSessionGrant,
  revokeSessionGrant,
  rollbackStagedSessionGrant,
  stageSessionGrant,
} from "./grants.ts";

export {
  autoDeriveCallerIdentity,
  isSessionLedgerBacked,
  resolveActiveSession,
} from "./resolver.ts";

export { requireTurn1Registration } from "./turn1-interlock.ts";

