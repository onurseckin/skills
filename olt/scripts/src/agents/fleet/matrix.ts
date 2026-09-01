import type { AgentOperationalContract, AgentTier, AgentTierCategory } from "./types.ts";
import { ALL_31_AGENT_ARCHETYPES } from "./archetypes.ts";
import { CONTRACTS_TIER_0_1 } from "./contracts-tier0-1.ts";
import { CONTRACTS_TIER_2 } from "./contracts-tier2.ts";
import { CONTRACTS_TIER_3_EXEC } from "./contracts-tier3-exec.ts";
import { CONTRACTS_TIER_3_QUALITY_UI } from "./contracts-tier3-quality-ui.ts";
import { CONTRACTS_TIER_3_QUALITY_CRITICS } from "./contracts-tier3-quality-critics.ts";

export const CONTRACTS_LIST: readonly AgentOperationalContract[] = [
  ...CONTRACTS_TIER_0_1,
  ...CONTRACTS_TIER_2,
  ...CONTRACTS_TIER_3_EXEC,
  ...CONTRACTS_TIER_3_QUALITY_UI,
  ...CONTRACTS_TIER_3_QUALITY_CRITICS,
];

export const FLEET_CONTRACT_REGISTRY: Readonly<Record<string, AgentOperationalContract>> = (() => {
  const map: Record<string, AgentOperationalContract> = {};
  for (const contract of CONTRACTS_LIST) {
    map[contract.id] = contract;
    map[contract.role] = contract;
    for (const alias of contract.aliases) {
      map[alias] = contract;
    }
  }
  return Object.freeze(map);
})();

export function normalizeAgentRole(roleOrAlias: string): string {
  const contract = FLEET_CONTRACT_REGISTRY[roleOrAlias.toLowerCase().trim()];
  if (contract) return contract.id;
  return roleOrAlias.toLowerCase().trim();
}

export function getAgentContract(roleOrAlias: string): AgentOperationalContract | undefined {
  if (!roleOrAlias) return undefined;
  return FLEET_CONTRACT_REGISTRY[roleOrAlias.toLowerCase().trim()];
}

export function requireAgentContract(roleOrAlias: string): AgentOperationalContract {
  const contract = getAgentContract(roleOrAlias);
  if (!contract) {
    throw new Error(`Unknown agent archetype or role: '${roleOrAlias}'. Available archetypes: ${ALL_31_AGENT_ARCHETYPES.join(", ")}`);
  }
  return contract;
}

export function listAgentsByTier(tier: AgentTier): readonly AgentOperationalContract[] {
  return CONTRACTS_LIST.filter((c) => c.tier === tier);
}

export function listAgentsByCategory(category: AgentTierCategory): readonly AgentOperationalContract[] {
  return CONTRACTS_LIST.filter((c) => c.category === category);
}

export function getAllAgentArchetypes(): readonly string[] {
  return ALL_31_AGENT_ARCHETYPES;
}
