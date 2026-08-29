import { isAgentGrantRecord, type AgentGrantRecord } from "../../core/contracts/index.ts";
import { isJsonObject, type JsonObject } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";

export const AGENT_LEDGER_KEY = "agents";

export function readAgentLedger(state: JsonObject): AgentGrantRecord[] {
  const raw = state[AGENT_LEDGER_KEY];
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new HarnessError("INTEGRITY", "state.agents must be an array of agent grant records");
  }
  return raw.map((entry, index) => {
    if (!isAgentGrantRecord(entry)) {
      throw new HarnessError("INTEGRITY", `state.agents[${index}] is not an agent grant record`);
    }
    return entry;
  });
}

export function writeAgentLedger(draft: JsonObject, ledger: readonly AgentGrantRecord[]): void {
  draft[AGENT_LEDGER_KEY] = [...ledger];
}

export function findGrant(
  ledger: readonly AgentGrantRecord[],
  agentId: string,
): AgentGrantRecord | undefined {
  return ledger.find((grant) => grant.id === agentId);
}

export function requireGrant(
  ledger: readonly AgentGrantRecord[],
  agentId: string,
): AgentGrantRecord {
  const grant = findGrant(ledger, agentId);
  if (!grant) {
    throw new HarnessError(
      "INVALID_STATE",
      `agent ${agentId} holds no grant; register it with agent:register first`,
    );
  }
  return grant;
}

export function replaceGrant(
  ledger: readonly AgentGrantRecord[],
  updated: AgentGrantRecord,
): AgentGrantRecord[] {
  return ledger.map((grant) => (grant.id === updated.id ? updated : grant));
}

export function assertAgentBudget(
  ledger: readonly AgentGrantRecord[],
  additional: number,
  maxAgents: number,
): void {
  const activeGrants = ledger.filter((grant) => grant.status === "active");
  if (activeGrants.length + additional <= maxAgents) return;
  throw new HarnessError(
    "INVALID_STATE",
    `max_agents budget of ${maxAgents} is exhausted: ${activeGrants.length} active grants and this needs ${additional} more; release completed agents or narrow the work`,
  );
}

export function knownTaskIds(state: JsonObject): Set<string> {
  const ids = new Set<string>();
  const tasks = state.tasks;
  if (isJsonObject(tasks)) for (const id of Object.keys(tasks)) ids.add(id);
  const branches = state.branches;
  if (Array.isArray(branches)) {
    for (const branch of branches) {
      if (!isJsonObject(branch) || !Array.isArray(branch.sub_tasks)) continue;
      for (const subTask of branch.sub_tasks) {
        if (isJsonObject(subTask) && typeof subTask.id === "string") ids.add(subTask.id);
      }
    }
  }
  return ids;
}

export function releaseGrantInLedger(
  ledger: readonly AgentGrantRecord[],
  agentId: string,
  reason: string,
  releasedAt?: string,
): AgentGrantRecord[] {
  const at = releasedAt ?? new Date().toISOString();
  return ledger.map((grant) => {
    if (grant.id !== agentId || grant.status !== "active") return grant;
    return {
      ...grant,
      status: "released",
      released_at: at,
      release_reason: reason,
    };
  });
}

export function releaseAllActiveGrants(
  ledger: readonly AgentGrantRecord[],
  reason: string,
  releasedAt?: string,
): AgentGrantRecord[] {
  const at = releasedAt ?? new Date().toISOString();
  return ledger.map((grant) => {
    if (grant.status !== "active") return grant;
    return {
      ...grant,
      status: "released",
      released_at: at,
      release_reason: reason,
    };
  });
}
