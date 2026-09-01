/**
 * Agent Identity & Naming Facade.
 */
export {
  AGENT_NAMING_STANDARDS,
  parseStandardAgentId,
  recommendStandardAgentId as recommendAgentId,
  validateAgentNamingConvention as validateAgentNamingStandard,
  roleToTier,
  agentIdToTier,
  detectHostApp,
  buildCapabilitiesProfile,
  parseTierValue as parseTier,
  roleToTier as roleToExecutionTier,
  agentIdToRole as agentIdToRoleAndTier,
} from "../../../olt/scripts/src/authority/thread/index.ts";

export { whoamiCommand } from "../../../olt/scripts/src/cli/commands/whoami.ts";
