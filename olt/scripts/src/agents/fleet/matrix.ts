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
  }
  return Object.freeze(map);
})();

export function normalizeAgentRole(role: string): string {
  const contract = FLEET_CONTRACT_REGISTRY[role.toLowerCase().trim()];
  if (contract) return contract.id;
  return role.toLowerCase().trim();
}

export function getAgentContract(role: string): AgentOperationalContract | undefined {
  if (!role) return undefined;
  return FLEET_CONTRACT_REGISTRY[role.toLowerCase().trim()];
}

export function requireAgentContract(role: string): AgentOperationalContract {
  const contract = getAgentContract(role);
  if (!contract) {
    throw new Error(
      `Unknown agent archetype or role: '${role}'. Available archetypes: ${ALL_31_AGENT_ARCHETYPES.join(", ")}`,
    );
  }
  return contract;
}

export function listAgentsByTier(tier: AgentTier): readonly AgentOperationalContract[] {
  return CONTRACTS_LIST.filter((c) => c.tier === tier);
}

export function listAgentsByCategory(
  category: AgentTierCategory,
): readonly AgentOperationalContract[] {
  return CONTRACTS_LIST.filter((c) => c.category === category);
}

export function getAllAgentArchetypes(): readonly string[] {
  return ALL_31_AGENT_ARCHETYPES;
}

export function isHeadfulReviewer(role: string): boolean {
  const contract = getAgentContract(role);
  return Boolean(contract?.isHeadfulReviewer);
}

export function isHeadlessDebugger(role: string): boolean {
  const contract = getAgentContract(role);
  return Boolean(contract?.isHeadlessDebugger);
}

export function isSourceCodeBlind(role: string): boolean {
  const contract = getAgentContract(role);
  return Boolean(contract?.isSourceCodeBlind);
}

export function validateAgentToolCall(
  role: string,
  toolName: string,
  commandName?: string,
): { allowed: boolean; violation?: string } {
  const contract = getAgentContract(role);
  if (!contract) {
    return {
      allowed: false,
      violation: `Agent role '${role}' not registered in fleet matrix.`,
    };
  }

  const { toolBoundaries, permissions } = contract;

  const isCodeWriteTool = [
    "write_to_file",
    "replace_file_content",
    "edit_file",
    "create_file",
    "delete_file",
  ].includes(toolName);
  if (isCodeWriteTool && !toolBoundaries.canWriteCode) {
    return {
      allowed: false,
      violation: `Agent '${contract.name}' (${contract.category}) has ZERO_SOURCE_EDITS invariant. Tool '${toolName}' forbidden.`,
    };
  }

  const isCommandExecTool = ["run_command", "shell", "run:exec", "execute_command"].includes(
    toolName,
  );
  if (isCommandExecTool && !toolBoundaries.canExecuteCommands) {
    return {
      allowed: false,
      violation: `Agent '${contract.name}' is a cognitive validator with ZERO command execution privileges. Tool '${toolName}' forbidden.`,
    };
  }

  if (toolBoundaries.forbiddenTools.includes(toolName)) {
    return {
      allowed: false,
      violation: `Tool '${toolName}' is explicitly forbidden for '${contract.name}'.`,
    };
  }

  if (commandName && permissions.forbiddenCommands.includes(commandName)) {
    return {
      allowed: false,
      violation: `Command '${commandName}' is explicitly forbidden for '${contract.name}'.`,
    };
  }

  return { allowed: true };
}

export function validateAgentSpawn(
  parentRole: string,
  childRole: string,
): { allowed: boolean; violation?: string } {
  const parentContract = getAgentContract(parentRole);
  if (!parentContract) {
    return { allowed: false, violation: `Parent role '${parentRole}' not found in fleet matrix.` };
  }

  const childContract = getAgentContract(childRole);
  if (!childContract) {
    return { allowed: false, violation: `Child role '${childRole}' not found in fleet matrix.` };
  }

  if (!parentContract.toolBoundaries.canSpawnSubagents) {
    return {
      allowed: false,
      violation: `Parent '${parentContract.name}' (Tier ${parentContract.tier}) does not have subagent spawn authority.`,
    };
  }

  if (parentContract.permissions.allowedSpawns.length > 0) {
    const isExplicitlyAllowed =
      parentContract.permissions.allowedSpawns.includes(childContract.id) ||
      parentContract.permissions.allowedSpawns.includes(childContract.role);

    if (!isExplicitlyAllowed) {
      return {
        allowed: false,
        violation: `Agent '${parentContract.name}' is not authorized to spawn '${childContract.name}'. Allowed spawns: ${parentContract.permissions.allowedSpawns.join(", ")}`,
      };
    }
  }

  return { allowed: true };
}
