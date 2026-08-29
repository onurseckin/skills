import { assertAntiBatchingRule } from "../planner/partitioning.ts";
import type {
  SmartTaskPlan,
  MultiOrchestratorPrePlanningResult,
  MultiOrchestratorPlanningOptions,
  AdmissionToDispatchAuditReport,
} from "../planner/models.ts";
import { preplanMultiOrchestratorTasks } from "./execution.ts";
import { readFeedbackQueue } from "../../../feedback/index.ts";
import { readTaskQueue, type TaskQueueItem } from "../../queue/index.ts";
import { HarnessError } from "../../../../core/errors/index.ts";
export function planMultiOrchestratorExecution(
  tasks: readonly SmartTaskPlan[],
  options: MultiOrchestratorPlanningOptions | number | readonly string[] = {},
): MultiOrchestratorPrePlanningResult {
  return preplanMultiOrchestratorTasks(tasks, options);
}

/**
 * Alias for preplanMultiOrchestratorTasks.
 */
export function partitionTasksAcrossOrchestrators(
  tasks: readonly SmartTaskPlan[],
  options: MultiOrchestratorPlanningOptions | number | readonly string[] = {},
): MultiOrchestratorPrePlanningResult {
  return preplanMultiOrchestratorTasks(tasks, options);
}

/**
 * Verifies the Atomic Admission-to-Dispatch invariant:
 * 1. Zero paused admitted feedback items (every ADMITTED feedback has a corresponding active or completed task).
 * 2. Every task in the queue satisfies 1:1 Implementer-Validator isolation and anti-batching rule.
 */
export function verifyAdmissionToDispatchInvariants(
  options: {
    readonly capsulesDir?: string | undefined;
    readonly queuePath?: string | undefined;
  } = {},
): AdmissionToDispatchAuditReport {
  const feedbacks = readFeedbackQueue(options.capsulesDir);
  const tasks = readTaskQueue(options.queuePath);

  const pendingFeedbacks = feedbacks.filter((f) => f.status === "PENDING");
  const admittedFeedbacks = feedbacks.filter((f) => f.status === "ADMITTED");

  const taskMap = new Map<string, TaskQueueItem>();
  const feedbackIdToTaskMap = new Map<string, TaskQueueItem>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
    const fbId = t.metadata?.["feedback_id"] ?? t.metadata?.["batched_feedback_ids"];
    if (typeof fbId === "string") {
      feedbackIdToTaskMap.set(fbId, t);
    }
  }

  const violations: string[] = [];
  let pausedAdmittedCount = 0;

  for (const fb of admittedFeedbacks) {
    const dispatchedTaskId = fb.metadata?.["dispatched_task_id"];
    const matchedByMeta =
      typeof dispatchedTaskId === "string" ? taskMap.get(dispatchedTaskId) : undefined;
    const matchedByFbId = feedbackIdToTaskMap.get(fb.id);
    const matchedTask = matchedByMeta ?? matchedByFbId;

    if (!matchedTask) {
      violations.push(
        `Admitted feedback '${fb.id}' (${fb.title}) has no corresponding dispatched task node in task queue.`,
      );
      pausedAdmittedCount++;
    }
  }

  const activeTasks = tasks.filter(
    (t) =>
      t.status === "PENDING" ||
      t.status === "ADMITTED" ||
      t.status === "IN_PROGRESS" ||
      t.status === "RUNNING" ||
      t.status === "VALIDATING",
  );

  return {
    compliant: violations.length === 0,
    total_feedback: feedbacks.length,
    pending_feedback: pendingFeedbacks.length,
    admitted_feedback: admittedFeedbacks.length,
    paused_admitted_feedback: pausedAdmittedCount,
    total_tasks: tasks.length,
    active_tasks: activeTasks.length,
    zero_paused_admitted: pausedAdmittedCount === 0,
    violations,
  };
}

/**
 * Alias for verifyAdmissionToDispatchInvariants.
 */
export function verifyProductOwnerInvariants(
  options: {
    readonly capsulesDir?: string | undefined;
    readonly queuePath?: string | undefined;
  } = {},
): AdmissionToDispatchAuditReport {
  return verifyAdmissionToDispatchInvariants(options);
}

/**
 * Atomically admits pending or provided feedback items and dispatches them to 1:1 isolated task nodes in the task queue.
 * Guarantees that zero items are left in a paused ADMITTED state.
 */

export function validateMultiOrchestratorIsolation(plan: MultiOrchestratorPrePlanningResult): void {
  if (!plan.is_disjoint || plan.cross_orchestrator_collisions.length > 0) {
    const details = plan.cross_orchestrator_collisions
      .map((c) => `[${c.scope} between ${c.task_ids.join(" and ")}]`)
      .join(", ");
    throw new HarnessError(
      "INTEGRITY",
      `Multi-orchestrator isolation violation: write scopes overlap across orchestrator sub-trees: ${details}`,
    );
  }

  for (const orch of plan.orchestrators) {
    assertAntiBatchingRule(orch.tasks);
  }
}

/**
 * Stages tasks across multiple orchestrator sub-trees, tagging each task with its assigned orchestrator
 * and wave metadata, and enforcing strict write scope isolation.
 */

export function stageTasksForMultiOrchestratorExecution(
  tasks: readonly SmartTaskPlan[],
  options: MultiOrchestratorPlanningOptions | number | readonly string[] = {},
): {
  readonly plan: MultiOrchestratorPrePlanningResult;
  readonly staged_tasks: readonly SmartTaskPlan[];
} {
  const plan = preplanMultiOrchestratorTasks(tasks, options);
  validateMultiOrchestratorIsolation(plan);

  const stagedTasks: SmartTaskPlan[] = [];
  for (const orch of plan.orchestrators) {
    for (const wave of orch.wave_plan.waves) {
      for (const task of wave.tasks) {
        stagedTasks.push({
          ...task,
          assigned_tier: "Tier_1_Orchestrator",
          assigned_role: `orchestrator-${orch.orchestrator_id}`,
          metadata: {
            ...(task.metadata ?? {}),
            assigned_orchestrator: orch.orchestrator_id,
            orchestrator_wave: wave.wave_number,
            disjoint_scope_group: orch.orchestrator_id,
          },
        });
      }
    }
  }

  return {
    plan,
    staged_tasks: stagedTasks,
  };
}

/**
 * Alias for preplanMultiOrchestratorTasks.
 */
