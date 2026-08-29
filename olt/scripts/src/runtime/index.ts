export type { AgentMetadata, AgentMetadataDependencies } from "./contracts.ts";
export {
  inferTierFromRole,
  inferCanExecuteShell,
  createAgentMetadata,
  metadataIntegrityError,
  isRecord,
  isNonEmptyString,
  assertSafeAgentId,
  isStringArray,
  parseReviewConfig,
  validateAgentMetadata,
} from "./metadata.ts";
export {
  getAgentMetadataPath,
  writeAgentMetadata,
  writeAgentMetadataUnlocked,
  serializeValidatedAgentMetadata,
  replaceAgentMetadataUnlocked,
  withAgentMetadataMutationLock,
} from "./session.ts";
export {
  defaultAgentMetadataDependencies,
  setAgentMetadataDependenciesForTesting,
  readAgentMetadataFileSecure,
  readAgentMetadataFile,
  readAgentMetadataAtRoot,
  readCapsuleRoots,
  findAgentMetadataLocation,
  readAgentMetadata,
} from "./cache.ts";
export {
  requiredNoFollowFlag,
  delay,
  sameInode,
  safeFailureCause,
  assertRealDirectory,
  openVerifiedDirectory,
  acquireExclusiveLock,
  assertActiveMetadataAuthority,
  assertRegularMetadataFile,
  assertExistingMetadataAuthorityFiles,
  fsyncDirectory,
  activeAgentMetadataParents,
  activeAgentMetadataParentInodes,
  activeAgentMetadataRoots,
  activeAgentMetadataRootInodes,
  activeAgentMetadataParentIdentity,
  activeAgentMetadataRootIdentity,
  activeAgentMetadataAuthority,
  readOwnDataString,
  isTrustedEnoent,
  formatSafeErrorCause,
} from "./util.ts";
export type { ReadScopeCheckResult } from "./read-scope-guard.ts";
export {
  ALWAYS_ACCESSIBLE_PATTERNS,
  normalizeScopePath,
  isPathInScopeList,
  isWithinNeighborhood,
  checkReadScopeAuthorization,
  expandReadScope,
} from "./read-scope-guard.ts";
