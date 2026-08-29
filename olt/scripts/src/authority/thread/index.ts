export type {
  AgentBindingType,
  AgentNamingStandardDefinition,
  AgentNamingValidationResult,
  CapabilitiesProfile,
  DefectRecord,
  ExecutionContextOptions,
  ExecutionTier,
  HostProfile,
  StandardAgentIdParsedComponents,
  StandardAgentRole,
  ThreadIdentification,
  TierSpawningValidationResult,
} from "./types.ts";

export { AGENT_NAMING_STANDARDS, MAIN_THREAD_ADVISORY, TIER_NAMES } from "./constants.ts";

export {
  agentIdToRole,
  agentIdToTier,
  parseTierValue,
  recordDefect,
  roleToTier,
  safeDefectId,
  safeErrorDetail,
} from "./role-mapping.ts";

export {
  buildCapabilitiesProfile,
  detectHostApp,
  formatThreadIdentificationBrief,
  identifyExecutionContext,
} from "./context.ts";

export { validateTierSpawning } from "./spawning.ts";

export {
  isStandardAgentId,
  parseStandardAgentId,
  recommendStandardAgentId,
  validateAgentNamingConvention,
} from "./naming.ts";
