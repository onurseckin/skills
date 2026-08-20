import { isAgentGrantRecord, type AgentGrantRecord } from "../../contracts/agents.ts";
import { isJsonObject, type JsonObject } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";

export const AGENT_LEDGER_KEY = "agents";

/**
 * Capsules written before the ledger existed carry no `agents` key at all; that is an empty ledger,
 * not a defect. A key that is present but malformed can only come from a hand-edited state file, so
 * it is an integrity failure rather than something to repair silently.
 */
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

/**
 * The run-wide cost control. Every grant ever issued counts, released ones included, because the
 * budget is on agents deployed rather than agents alive; breadth and depth are charged identically,
 * which is what the old depth cap failed to do. Refused, never silently truncated: the coordinator
 * has to see that the run ran out of budget and decide what to do about it.
 */
export function assertAgentBudget(
  ledger: readonly AgentGrantRecord[],
  additional: number,
  maxAgents: number,
): void {
  if (ledger.length + additional <= maxAgents) return;
  throw new HarnessError(
    "INVALID_STATE",
    `max_agents budget of ${maxAgents} is exhausted: ${ledger.length} grants already issued and this needs ${additional} more; raise max_agents or narrow the work`,
  );
}

/**
 * Task ids a grant may bind to. Branch sub-tasks are execution-time subdivisions that never enter
 * `state.tasks`, so a sub-agent dispatched onto one is still bindable; anything else is refused
 * rather than recorded as a reference to a task that does not exist.
 */
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
