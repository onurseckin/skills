/**
 * Authority Session Subdomain Test Facade.
 * Explicit named exports for session test fixtures, mock stores, and runners.
 */

export {
  enableInMemorySessionStore,
  disableInMemorySessionStore,
  clearInMemorySessionStore,
  isInMemorySessionStoreEnabled,
  getInMemorySessionStore,
  setInMemorySessionData,
  getInMemorySessionData,
  deleteInMemorySessionData,
  readPersistedSession,
  secureReadSession,
  formatSafeErrorCause,
  readOwnDataString,
  inferCanExecute,
  snapshotSession,
  restoreSnapshotIfUnchanged,
  withSessionAuthorityLock,
} from "../../../olt/scripts/src/authority/session/io.ts";

export {
  assertActiveCapsuleLease,
  registerSessionGrant,
  registerInMemorySessionGrant,
  stageSessionGrant,
  rollbackStagedSessionGrant,
  revokeSessionGrant,
  pruneStaleSessions,
  isSessionLedgerBacked,
} from "../../../olt/scripts/src/authority/session/grants.ts";

export {
  resolveActiveSession,
  autoDeriveCallerIdentity,
} from "../../../olt/scripts/src/authority/session/resolver.ts";

export {
  requireTurn1Registration,
} from "../../../olt/scripts/src/authority/session/turn1-interlock.ts";

export {
  resolveGlobalSessionsDir,
  resolveSessionRepositoryRoot,
  resolveCapsuleStateCandidate,
  assertSafeSessionComponent,
  assertSessionPid,
  sameInode,
} from "../../../olt/scripts/src/authority/session/paths.ts";

export {
  type SessionIdentity,
  type SessionSnapshot,
  type StagedSessionGrant,
  type RegisterSessionOptions,
  type ResolveSessionOptions,
} from "../../../olt/scripts/src/authority/session/types.ts";
