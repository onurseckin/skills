/**
 * Agent Identity & Naming Facade.
 */
export {
  AGENT_NAMING_STANDARDS,
  parseStandardAgentId,
  recommendAgentId,
  validateAgentNamingStandard,
  roleToTier,
  agentIdToTier,
} from "../../../olt/scripts/src/authority/naming.ts";

export {
  detectHostApp,
  buildCapabilitiesProfile,
  parseTier,
  roleToExecutionTier,
  agentIdToRoleAndTier,
  whoamiCommand,
} from "../../../olt/scripts/src/cli/whoami.ts";
