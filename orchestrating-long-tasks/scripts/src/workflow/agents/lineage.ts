import type { AgentGrantRecord, AgentGrantStatus } from "../../contracts/agents.ts";
import type { AgentRole } from "../../contracts/packets.ts";

export interface AgentLineageNode {
  agent_id: string;
  role: AgentRole;
  parent_agent_id: null | string;
  parent_task_id: null | string;
  status: AgentGrantStatus;
  /** Hops of delegation below the shallowest agent working the task; that agent is 0. */
  depth: number;
  /** Parent chain up to the root grant, nearest first. */
  ancestors: string[];
}

export interface TaskLineage {
  task_id: string;
  agents: AgentLineageNode[];
}

/**
 * Walks parents to the root. A hand-edited ledger could describe a cycle, so the walk stops on a
 * repeat instead of hanging.
 */
export function ancestorChain(ledger: readonly AgentGrantRecord[], agentId: string): string[] {
  const byId = new Map(ledger.map((grant) => [grant.id, grant]));
  const chain: string[] = [];
  const seen = new Set<string>([agentId]);
  let parent = byId.get(agentId)?.parent_agent_id ?? null;
  while (parent !== null && !seen.has(parent)) {
    chain.push(parent);
    seen.add(parent);
    parent = byId.get(parent)?.parent_agent_id ?? null;
  }
  return chain;
}

export function childrenOf(
  ledger: readonly AgentGrantRecord[],
  agentId: string,
): AgentGrantRecord[] {
  return ledger.filter((grant) => grant.parent_agent_id === agentId);
}

function lineageNode(
  ledger: readonly AgentGrantRecord[],
  grant: AgentGrantRecord,
  depth: number,
): AgentLineageNode {
  return {
    agent_id: grant.id,
    role: grant.role,
    parent_agent_id: grant.parent_agent_id,
    parent_task_id: grant.parent_task_id,
    status: grant.status,
    depth,
    ancestors: ancestorChain(ledger, grant.id),
  };
}

/**
 * Who worked a task and under whom: the agents dispatched directly onto it, then everything they
 * dispatched in turn. A descendant counts as having worked the task because its authority runs
 * through the agent that holds the task, whatever id its own grant binds to.
 */
export function taskLineage(ledger: readonly AgentGrantRecord[], taskId: string): TaskLineage {
  const agents: AgentLineageNode[] = [];
  const visited = new Set<string>();
  const direct = ledger.filter((grant) => grant.parent_task_id === taskId);
  const directIds = new Set(direct.map((grant) => grant.id));
  // An agent bound to the task whose dispatcher is also bound to it is not a root of this lineage:
  // it is reached as that dispatcher's child, which is what keeps depth meaning hops of delegation.
  let frontier = direct.filter(
    (grant) => grant.parent_agent_id === null || !directIds.has(grant.parent_agent_id),
  );
  for (let depth = 0; frontier.length > 0; depth += 1) {
    const next: AgentGrantRecord[] = [];
    for (const grant of frontier) {
      if (visited.has(grant.id)) continue;
      visited.add(grant.id);
      agents.push(lineageNode(ledger, grant, depth));
      next.push(...childrenOf(ledger, grant.id));
    }
    frontier = next;
  }
  return { task_id: taskId, agents };
}
