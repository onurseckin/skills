export type {
  AgentOperationalContract,
  AgentTier,
  AgentTierCategory,
  CertifiedDeliverable,
  OpticalDimension,
  SyntheticState,
  ToolBoundaryDefinition,
} from "./types.ts";

export type { AgentArchetypeId } from "./archetypes.ts";

export { MANDATORY_VIEWPORTS_4, OPTICAL_DIMENSIONS_8, SYNTHETIC_STATES_4 } from "./types.ts";

export {
  ALL_31_AGENT_ARCHETYPES,
  FORBIDDEN_EXEC_TOOLS,
  FORBIDDEN_WRITE_TOOLS,
  TIER_0_1_GOVERNANCE_AGENTS,
  TIER_2_ORCHESTRATION_AGENTS,
  TIER_3_EXECUTION_AGENTS,
  TIER_3_QUALITY_AGENTS,
  defineContract,
} from "./archetypes.ts";

export { CONTRACTS_TIER_0_1 } from "./contracts-tier0-1.ts";
export { CONTRACTS_TIER_2 } from "./contracts-tier2.ts";
export { CONTRACTS_TIER_3_EXEC } from "./contracts-tier3-exec.ts";
export { CONTRACTS_TIER_3_QUALITY_UI } from "./contracts-tier3-quality-ui.ts";
export { CONTRACTS_TIER_3_QUALITY_CRITICS } from "./contracts-tier3-quality-critics.ts";

export {
  CONTRACTS_LIST,
  FLEET_CONTRACT_REGISTRY,
  getAllAgentArchetypes,
  getAgentContract,
  listAgentsByCategory,
  listAgentsByTier,
  normalizeAgentRole,
  requireAgentContract,
} from "./matrix.ts";

export {
  isHeadfulReviewer,
  isHeadlessDebugger,
  isSourceCodeBlind,
  validateAgentSpawn,
  validateAgentToolCall,
} from "./validation.ts";
