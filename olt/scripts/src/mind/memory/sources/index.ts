export type {
  EvidenceClass,
  MindSourceId,
  MindSourceDefinition,
  MindObservationRecord,
} from "./types.ts";

export {
  MIND_DISCOVERY_SOURCES,
  SOURCE_LOOKUP,
  findSourceDefinition,
  getSourceDefinition,
  isMindSourceId,
  resolveSourceToRegistryCommand,
  getSourceEmpiricalCommand,
} from "./types.ts";

export type { CommandResolutionResult, QuiescentSourcesCheck } from "./scanner.ts";

export {
  getSourceRevalidationGate,
  mapDiscoveryCategoryToSourceId,
  mapSourceIdToDiscoveryCategory,
  resolveCommandRecord,
  validateQuiescentSources,
  resolveCanonicalObservationsPath,
  resolveObservationsPath,
} from "./scanner.ts";
