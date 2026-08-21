import { recoverStale, type RecoveryOptions } from "../workflow/lease/recover-stale.ts";
import {
  abandonedCompletenessCritic,
  abandonedTaskValidations,
  taskAttemptTurnState,
} from "../workflow/lease/turn-state.ts";
import {
  systemClock,
  type Clock,
  type TransactionPort,
  type WorkflowState,
} from "../workflow/types.ts";

export interface DeadAgentEvent {
  readonly kind: "task-lease" | "branch-sub-lease" | "validation" | "completeness-critic";
  readonly taskId?: string;
  readonly agentId?: string;
  readonly reason: "expired_lease_no_submission";
  readonly newStatus: string;
}

export interface DeadAgentReclaimResult {
  readonly events: readonly DeadAgentEvent[];
  readonly state: WorkflowState;
}

export const DEAD_AGENT_RECLAIMED_KIND = "supervisor-dead-agent-reclaimed";

function abandonedTaskLeaseAgents(
  state: WorkflowState,
  now: Date,
  graceMs: number,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const task of Object.values(state.tasks)) {
    if (task.lease !== undefined && taskAttemptTurnState(task, now, graceMs) === "abandoned") {
      map.set(task.id, task.lease.agent_id);
    }
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

function validationKey(entry: { validator_id: string; domain: string; attempt: number }): string {
  return `${entry.validator_id}::${entry.domain}::${entry.attempt}`;
}

export function reclaimDeadAgents(
  port: TransactionPort,
  actor: string,
  clock: Clock = systemClock,
  options: RecoveryOptions = {},
): DeadAgentReclaimResult {
  const now = clock.now();
  const graceMs = (options.graceSeconds ?? 30) * 1_000;
  const fixedClock: Clock = { now: () => now };

  const before = port.read();
  const agentsBefore = abandonedTaskLeaseAgents(before, now, graceMs);
  const subLeasedBefore = leasedSubTaskIds(before);
  const validationsBefore = new Map(
    Object.values(before.tasks)
      .map((task) => [task.id, abandonedTaskValidations(task, now, graceMs)] as const)
      .filter(([, entries]) => entries.length > 0),
  );
  const criticBefore = abandonedCompletenessCritic(before, now, graceMs);

  const state = recoverStale(port, actor, fixedClock, options);

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
  for (const [taskId, entries] of validationsBefore) {
    const afterTask = state.tasks[taskId];
    const stillOpen = new Set(
      (afterTask?.validations ?? [])
        .filter((entry) => entry.verdict === undefined)
        .map(validationKey),
    );
    for (const entry of entries) {
      if (stillOpen.has(validationKey(entry))) continue;
      events.push({
        kind: "validation",
        taskId,
        agentId: entry.validator_id,
        reason: "expired_lease_no_submission",
        newStatus: afterTask?.status ?? "unknown",
      });
    }
  }
  if (criticBefore) {
    const after = state.completion_critic;
    if (
      after !== undefined &&
      after.critic_id === criticBefore.critic_id &&
      after.attempt === criticBefore.attempt &&
      after.status === "expired"
    ) {
      events.push({
        kind: "completeness-critic",
        agentId: criticBefore.critic_id,
        reason: "expired_lease_no_submission",
        newStatus: "expired",
      });
    }
  }
  for (const event of events) {
    port.transact(
      actor,
      DEAD_AGENT_RECLAIMED_KIND,
      {
        kind: event.kind,
        ...(event.taskId === undefined ? {} : { task_id: event.taskId }),
        ...(event.agentId === undefined ? {} : { agent_id: event.agentId }),
        new_status: event.newStatus,
      },
      () => {},
    );
  }
  return { events, state };
}
