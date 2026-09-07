import { agentIdToTier, roleToTier, type ExecutionTier } from "../../authority/thread/index.ts";
import type { SubagentTier } from "./types.ts";

export function resolveSeatExecutionTier(agentId: string, tier: SubagentTier): ExecutionTier {
  const fromAgentId = agentIdToTier(agentId);
  if (fromAgentId !== null) return fromAgentId;
  return roleToTier(String(tier));
}

export function isAmbientExecutionTier(tier: ExecutionTier): boolean {
  return tier === 0 || tier === 1 || tier === 2;
}

export function isWorkerExecutionTier(tier: ExecutionTier): boolean {
  return tier === 3;
}
