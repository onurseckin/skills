import { recoverStale, type RecoveryOptions } from "../workflow/lease/recover-stale.ts";
import { systemClock, type Clock, type TransactionPort, type WorkflowState } from "../workflow/types.ts";

/**
 * A dead agent, discovered without anyone telling the supervisor about it (B28.2): the lease it held
 * expired and nothing ever submitted against it. `recoverStale` already does the reclaiming; this
 * module turns its before/after effect into a structured record a supervisor can act on and a
 * morning report (B28.4) can list by name.
 */
export interface DeadAgentEvent {
  readonly kind: "task-lease" | "branch-sub-lease";
  readonly taskId: string;
  readonly agentId?: string;
  readonly reason: "expired_lease_no_submission";
  readonly newStatus: string;
}

export interface DeadAgentReclaimResult {
  readonly events: readonly DeadAgentEvent[];
  readonly state: WorkflowState;
}

/**
 * The morning report (B28.4) needs a cumulative count across the whole run, including reclaims from
 * a supervisor that has since died and restarted. Diffing before/after only tells the CURRENT
 * process what it just found, so each reclaim is also recorded as its own event — the durable trail
 * a report reads back later, independent of which process was running when it happened.
 */
export const DEAD_AGENT_RECLAIMED_KIND = "supervisor-dead-agent-reclaimed";

function leasedTaskAgents(state: WorkflowState): Map<string, string> {
  const map = new Map<string, string>();
  for (const task of Object.values(state.tasks)) {
    if (task.lease !== undefined) map.set(task.id, task.lease.agent_id);
  }
  return map;
}

function leasedSubTaskIds(state: WorkflowState): Set<string> {
  const ids = new Set<string>();
  for (const branch of state.branches ?? []) {
    for (const subTask of branch.sub_tasks) {
      if (subTask.lease !== undefined) ids.add(subTask.id);
    }
  }
  return ids;
}

/**
 * Reclaims every stale lease and branch sub-lease in one pass and reports exactly which agents were
 * found dead, so a supervisor can decide what to do with each freed task instead of only knowing the
 * aggregate count. Safe to call on a schedule: a run with nothing stale returns an empty list.
 */
export function reclaimDeadAgents(
  port: TransactionPort,
  actor: string,
  clock: Clock = systemClock,
  options: RecoveryOptions = {},
): DeadAgentReclaimResult {
  const before = port.read();
  const agentsBefore = leasedTaskAgents(before);
  const subLeasedBefore = leasedSubTaskIds(before);

  const state = recoverStale(port, actor, clock, options);

  const events: DeadAgentEvent[] = [];
  for (const [taskId, agentId] of agentsBefore) {
    if (state.tasks[taskId]?.lease !== undefined) continue;
    events.push({
      kind: "task-lease",
      taskId,
      agentId,
      reason: "expired_lease_no_submission",
      newStatus: state.tasks[taskId]?.status ?? "unknown",
    });
  }
  const subLeasedAfter = leasedSubTaskIds(state);
  for (const taskId of subLeasedBefore) {
    if (subLeasedAfter.has(taskId)) continue;
    events.push({
      kind: "branch-sub-lease",
      taskId,
      reason: "expired_lease_no_submission",
      newStatus: "open",
    });
  }
  for (const event of events) {
    port.transact(
      actor,
      DEAD_AGENT_RECLAIMED_KIND,
      {
        task_id: event.taskId,
        kind: event.kind,
        ...(event.agentId === undefined ? {} : { agent_id: event.agentId }),
        new_status: event.newStatus,
      },
      () => {
        // Intentional no-op: recoverStale already applied the state change above. This call exists
        // only to leave a durable, per-agent record of it on the chain (see the constant's comment).
      },
    );
  }
  return { events, state };
}
