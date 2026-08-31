/**
 * Authority Tokens & Thread Identity Subdomain Test Facade.
 * Explicit named exports for thread identification, tier mappings, naming standards, and host bindings.
 */

export {
  identifyExecutionContext,
  formatThreadIdentificationBrief,
  detectHostApp,
  buildCapabilitiesProfile,
  parseTierValue,
  roleToTier,
  agentIdToRole,
  agentIdToTier,
  validateTierSpawning,
  parseStandardAgentId,
  isStandardAgentId,
  recommendStandardAgentId,
  validateAgentNamingConvention,
  recordDefect,
  TIER_NAMES,
  MAIN_THREAD_ADVISORY,
  type ExecutionTier,
  type ThreadExecutionContext,
  type DefectRecord,
  type ParsedStandardAgentId,
} from "../../../olt/scripts/src/authority/thread/index.ts";

export {
  normalizeRoleKey,
  resolveAgentHostConfiguration,
} from "../../../olt/scripts/src/authority/host-bindings.ts";

export {
  verifyMilestoneEvidence,
  verifyEventsHashChain,
  inspectCommandReceipts,
  inspectMilestoneEvents,
} from "../../../olt/scripts/src/authority/evidence/index.ts";
