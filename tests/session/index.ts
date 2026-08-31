/**
 * Session Domain Test & Logic Facades.
 * Explicit named exports - zero wildcard export *.
 */
export {
  resolveActiveSession,
  autoDeriveCallerIdentity,
  registerSessionGrant,
  registerInMemorySessionGrant,
  createSessionAuthResolver,
  SessionAuthResolver,
} from "./auth/index.ts";

export {
  readPersistedSession,
  secureReadSession,
  assertSafeSessionComponent,
  type SessionIdentity,
} from "./tokens/index.ts";

export {
  enableInMemorySessionStore,
  disableInMemorySessionStore,
  clearInMemorySessionStore,
  isInMemorySessionStoreEnabled,
  getInMemorySessionStore,
  setInMemorySessionData,
  getInMemorySessionData,
  deleteInMemorySessionData,
  snapshotSession,
  restoreSnapshotIfUnchanged,
  withSessionAuthorityLock,
  clearInMemoryAgentMetadata,
  deleteInMemoryAgentMetadata,
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
  getInMemoryAgentMetadata,
  getInMemoryAgentMetadataStore,
  isInMemoryAgentMetadataEnabled,
  setInMemoryAgentMetadata,
  withAgentMetadataMutationLock,
  writeAgentMetadata,
  writeAgentMetadataUnlocked,
  PooledBrowserInstance,
  PooledCaptureBrowserDriver,
  PooledCaptureBrowserProvider,
} from "./lifecycle/index.ts";

export {
  BrowserPoolManager,
  isInstanceExpired,
  DefaultFallbackBrowserProvider,
  DefaultFallbackBrowserDriver,
  runLiveCaptureWorkflow,
  createSyntheticPngBuffer,
  resolveCaptureOutputDir,
  filterScreens,
  resolveViewportsForScreen,
  captureContext,
  computeStateHash,
  computeMerkleRoot,
  verifySnapshotIntegrity,
} from "./runners/index.ts";

export {
  requireTurn1Registration,
  assertActiveCapsuleLease,
  stageSessionGrant,
  rollbackStagedSessionGrant,
  revokeSessionGrant,
  pruneStaleSessions,
  isSessionLedgerBacked,
  resolveGlobalSessionsDir,
  resolveSessionRepositoryRoot,
  resolveCapsuleStateCandidate,
  assertSessionPid,
  sameInode,
  formatSafeErrorCause,
  readOwnDataString,
  inferCanExecute,
} from "./operations/index.ts";
