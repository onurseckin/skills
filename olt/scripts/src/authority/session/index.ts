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
  resolveCapsuleStateCandidate,
  resolveGlobalSessionsDir,
  resolveSessionRepositoryRoot,
  sameInode,
} from "./paths.ts";

export {
  atomicSessionWrite,
  clearInMemorySessionStore,
  deleteInMemorySessionData,
  disableInMemorySessionStore,
  enableInMemorySessionStore,
  formatSafeErrorCause,
  getInMemorySessionData,
  getInMemorySessionStore,
  inferCanExecute,
  isInMemorySessionStoreEnabled,
  readOwnDataString,
  readPersistedSession,
  restoreSnapshotIfUnchanged,
  secureReadSession,
  setInMemorySessionData,
  snapshotSession,
  withSessionAuthorityLock,
} from "./io.ts";

export {
  assertActiveCapsuleLease,
  pruneStaleSessions,
  registerInMemorySessionGrant,
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
