export * as guard from "./guard/index.ts";
export * as metadata from "./metadata/index.ts";
export * as session from "./session/index.ts";

export {
  checkReadScopeAuthorization,
  expandReadScope,
  isPathInScopeList,
  isWithinNeighborhood,
} from "./guard/index.ts";

export {
  createAgentMetadata,
  findAgentMetadataLocation,
  getAgentMetadataPath,
  readAgentMetadata,
  setAgentMetadataDependenciesForTesting,
  writeAgentMetadata,
} from "./metadata/index.ts";

export {
  clearInMemoryAgentMetadata,
  deleteInMemoryAgentMetadata,
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
  getInMemoryAgentMetadata,
  getInMemoryAgentMetadataStore,
  isInMemoryAgentMetadataEnabled,
  replaceAgentMetadataUnlocked,
  serializeValidatedAgentMetadata,
  setInMemoryAgentMetadata,
  withAgentMetadataMutationLock,
  writeAgentMetadataUnlocked,
} from "./session/index.ts";
