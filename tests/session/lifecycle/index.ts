/**
 * Session Lifecycle & In-Memory Store Facade.
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
  snapshotSession,
  restoreSnapshotIfUnchanged,
  withSessionAuthorityLock,
} from "../../../olt/scripts/src/authority/session/io.ts";

export {
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
} from "../../../olt/scripts/src/runtime/session.ts";

export {
  PooledBrowserInstance,
  PooledCaptureBrowserDriver,
  PooledCaptureBrowserProvider,
} from "../../../olt/scripts/src/capture/runners/browser-pool-manager.ts";
