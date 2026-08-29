import {
  readTaskQueue,
  enqueueTasksBatch,
  type NewTaskQueueInput,
  type TaskQueueItem,
} from "../../queue/index.ts";
import {
  readFeedbackQueue,
  updateOrPruneFeedbackItems,
  type FeedbackItem,
} from "../../../feedback/index.ts";
import {
  assertAntiBatchingRule,
  partitionGroupedFeedbacksStrictly,
} from "../planner/partitioning.ts";
import { HarnessError } from "../../../../core/errors/index.ts";
import type {
  AdmissionToDispatchResult,
  AdmissionToDispatchAuditReport,
} from "../planner/models.ts";
import {
  verifyAdmissionToDispatchInvariants,
  stageTasksForMultiOrchestratorExecution,
} from "./invariants.ts";

export interface AtomicDispatchOptions {
  readonly capsulesDir?: string | undefined;
  readonly queuePath?: string | undefined;
  readonly feedbackItems?: readonly FeedbackItem[] | undefined;
  readonly charterGoals?: readonly string[] | undefined;
  readonly maxTasks?: number | undefined;
  readonly orchestratorIds?: readonly string[] | undefined;
}

export function executeAtomicAdmissionToDispatch(
  options: AtomicDispatchOptions = {},
): AdmissionToDispatchResult {
  const maxTasks = options.maxTasks ?? 10;
  const targetFeedbacks =
    options.feedbackItems && options.feedbackItems.length > 0
      ? options.feedbackItems
      : readFeedbackQueue(options.capsulesDir).filter((f) => f.status === "PENDING");

  if (targetFeedbacks.length === 0) {
    const auditReport = verifyAdmissionToDispatchInvariants(options);
    return {
      synthesized_tasks: [],
      enqueued_tasks: [],
      admitted_feedbacks: [],
      audit_report: auditReport,
      summary: "No pending feedback items to admit or dispatch.",
    };
  }

  const selected = targetFeedbacks.slice(0, maxTasks);
  const tasks = partitionGroupedFeedbacksStrictly(selected, {
    charterGoals: options.charterGoals,
  });

  assertAntiBatchingRule(tasks);

  let finalTasks = tasks;
  if (options.orchestratorIds && options.orchestratorIds.length > 0) {
    const staged = stageTasksForMultiOrchestratorExecution(tasks, {
      orchestratorIds: options.orchestratorIds,
    });
    finalTasks = staged.staged_tasks;
  }

  const batchInputs: NewTaskQueueInput[] = finalTasks.map((t) => ({
    id: t.id,
    title: t.label,
    description: t.rationale,
    priority: t.priority ?? "HIGH",
    write_scope: t.write_scope,
    gate: t.gate,
    charter_goals: t.charter_goals,
    acceptance_criteria: t.acceptance_criteria,
    dependencies: t.dependencies,
    source_type: "feedback_intake",
    assigned_tier: t.assigned_tier,
    assigned_role: t.assigned_role,
    metadata: t.metadata,
  }));

  const taskByFeedbackId = new Map<string, string>();
  for (const task of finalTasks) {
    if (task.feedback_id) taskByFeedbackId.set(task.feedback_id, task.id);
  }
  const preparedAt = new Date().toISOString();

  updateOrPruneFeedbackItems((feedback) => {
    const taskId = taskByFeedbackId.get(feedback.id);
    if (!taskId) return feedback;
    return {
      ...feedback,
      metadata: {
        ...(feedback.metadata ?? {}),
        feedback_dispatch_state: "PREPARED",
        feedback_dispatch_task_id: taskId,
        feedback_dispatch_prepared_at: preparedAt,
      },
    };
  }, options.capsulesDir);

  const enqueuedTasks = enqueueTasksBatch(batchInputs, options.queuePath);

  const nowIso = new Date().toISOString();
  const admittedMap = new Map<string, string>();
  for (const t of finalTasks) {
    if (t.feedback_id) {
      admittedMap.set(t.feedback_id, t.id);
    }
  }

  const newlyAdmitted = updateOrPruneFeedbackItems(
    (fb) => {
      const matchedTaskId = admittedMap.get(fb.id);
      if (!matchedTaskId) return fb;
      return {
        ...fb,
        status: "ADMITTED",
        processed_at: nowIso,
        metadata: {
          ...(fb.metadata ?? {}),
          dispatched_task_id: matchedTaskId,
          atomic_dispatched_at: nowIso,
          feedback_dispatch_state: "COMMITTED",
          feedback_dispatch_task_id: matchedTaskId,
          feedback_dispatch_committed_at: nowIso,
        },
      };
    },
    options.capsulesDir,
    (items) => items.filter((item) => admittedMap.has(item.id) && item.status === "ADMITTED"),
  ) as readonly FeedbackItem[];

  const auditReport = verifyAdmissionToDispatchInvariants(options);
  if (!auditReport.zero_paused_admitted) {
    throw new HarnessError(
      "INTEGRITY",
      `Atomic admission-to-dispatch invariant violated: ${auditReport.violations.join("; ")}`,
    );
  }

  return {
    synthesized_tasks: finalTasks,
    enqueued_tasks: enqueuedTasks,
    admitted_feedbacks: newlyAdmitted,
    audit_report: auditReport,
    summary: `Atomically admitted and dispatched ${newlyAdmitted.length} feedback item(s) to ${enqueuedTasks.length} task queue node(s) with 0 paused admitted items.`,
  };
}

export function executeAtomicDispatch(
  options: AtomicDispatchOptions = {},
): AdmissionToDispatchResult {
  return executeAtomicAdmissionToDispatch(options);
}

export function executeProductOwnerAdmissionAndDispatch(
  options: AtomicDispatchOptions = {},
): AdmissionToDispatchResult {
  return executeAtomicAdmissionToDispatch(options);
}

export function reconcileAdmissionToDispatchState(
  options: {
    readonly capsulesDir?: string | undefined;
    readonly queuePath?: string | undefined;
    readonly charterGoals?: readonly string[] | undefined;
  } = {},
): {
  readonly reconciled_feedbacks_count: number;
  readonly newly_enqueued_tasks_count: number;
  readonly audit_report: AdmissionToDispatchAuditReport;
} {
  const allFeedbacks = readFeedbackQueue(options.capsulesDir);
  const tasks = readTaskQueue(options.queuePath);
  const taskMap = new Map<string, TaskQueueItem>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
    const fbId = t.metadata?.["feedback_id"];
    if (typeof fbId === "string") {
      taskMap.set(fbId, t);
    }
  }

  const preparedWithTask = allFeedbacks.filter((feedback) => {
    const taskId = feedback.metadata?.["feedback_dispatch_task_id"];
    return (
      feedback.metadata?.["feedback_dispatch_state"] === "PREPARED" &&
      typeof taskId === "string" &&
      taskMap.has(taskId)
    );
  });
  if (preparedWithTask.length > 0) {
    const preparedIds = new Set(preparedWithTask.map((feedback) => feedback.id));
    const committedAt = new Date().toISOString();
    updateOrPruneFeedbackItems((feedback) => {
      if (!preparedIds.has(feedback.id)) return feedback;
      const taskId = String(feedback.metadata?.["feedback_dispatch_task_id"]);
      return {
        ...feedback,
        status: "ADMITTED",
        processed_at: committedAt,
        metadata: {
          ...(feedback.metadata ?? {}),
          dispatched_task_id: taskId,
          atomic_dispatched_at: committedAt,
          feedback_dispatch_state: "COMMITTED",
          feedback_dispatch_committed_at: committedAt,
        },
      };
    }, options.capsulesDir);
    const auditReport = verifyAdmissionToDispatchInvariants(options);
    return {
      reconciled_feedbacks_count: preparedWithTask.length,
      newly_enqueued_tasks_count: 0,
      audit_report: auditReport,
    };
  }

  const audit = verifyAdmissionToDispatchInvariants(options);
  if (audit.zero_paused_admitted) {
    return {
      reconciled_feedbacks_count: 0,
      newly_enqueued_tasks_count: 0,
      audit_report: audit,
    };
  }

  const orphanedFeedbacks = allFeedbacks.filter(
    (f) =>
      f.status === "ADMITTED" &&
      !taskMap.has(f.id) &&
      (!f.metadata?.["dispatched_task_id"] ||
        !taskMap.has(String(f.metadata["dispatched_task_id"]))),
  );

  if (orphanedFeedbacks.length === 0) {
    return {
      reconciled_feedbacks_count: 0,
      newly_enqueued_tasks_count: 0,
      audit_report: audit,
    };
  }

  const dispatchResult = executeAtomicAdmissionToDispatch({
    capsulesDir: options.capsulesDir,
    queuePath: options.queuePath,
    feedbackItems: orphanedFeedbacks,
    charterGoals: options.charterGoals,
  });

  return {
    reconciled_feedbacks_count: orphanedFeedbacks.length,
    newly_enqueued_tasks_count: dispatchResult.enqueued_tasks.length,
    audit_report: dispatchResult.audit_report,
  };
}
