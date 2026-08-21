import { recoverStale, type RecoveryOptions } from "../workflow/lease/recover-stale.ts";
import {
  systemClock,
  type Clock,
  type TransactionPort,
  type WorkflowState,
} from "../workflow/types.ts";

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
      () => {},
    );
  }
  return { events, state };
}
