export type {
  AgentBindingType,
  AgentNamingStandardDefinition,
  AgentNamingValidationResult,
  CapabilitiesProfile,
  DefectRecord,
  ExecutionContextOptions,
  HostProfile,
  StandardAgentIdParsedComponents,
  StandardAgentRole,
  ThreadIdentification,
} from "./types.ts";

export { AGENT_NAMING_STANDARDS, MAIN_THREAD_ADVISORY, TIER_NAMES } from "./constants.ts";

export {
  agentIdToRole,
  agentIdToTier,
  parseTierValue,
  roleToTier,
  validateTierSpawning,
  type ExecutionTier,
  type TierSpawningValidationResult,
} from "./tier/index.ts";

export { recordDefect, safeDefectId, safeErrorDetail } from "./role-mapping.ts";

export {
  buildCapabilitiesProfile,
  detectHostApp,
  formatThreadIdentificationBrief,
  identifyExecutionContext,
} from "./context.ts";

export {
  isStandardAgentId,
  parseStandardAgentId,
  recommendStandardAgentId,
  validateAgentNamingConvention,
} from "./naming.ts";

export {
  inferRoleFromAgentId,
  isCoordinatorRole,
  isOrchestratorRole,
  isSupervisoryRole,
  matchesBoundaryPrefix,
  matchesBoundarySuffix,
  normalizeRoleName,
} from "./role-inference.ts";
