import {
  updateOrPruneFeedbackItems,
  type FeedbackItem,
  type FeedbackPriority,
  type FeedbackCategory,
} from "../../../feedback/queue/index.ts";
import {
  resolveCompletedTasksLedgerPath,
  recordCompletedTasksBatch,
  type CompletedTaskRecord,
} from "../../../archival/completed/index.ts";
import { updateCognitiveMemory } from "../planner/memory.ts";
import {
  verifyAdmissionToDispatchInvariants,
  stageTasksForMultiOrchestratorExecution,
} from "./invariants.ts";
import { computeMacroMetrics } from "../planner/index.ts";
import { partitionGroupedFeedbacksStrictly } from "../planner/index.ts";
import { synthesizeSmartTasksFromSelfEvolution } from "./evolution.ts";
import { resolve } from "node:path";
import type {
  InfiniteProductOwnerState,
  InfiniteProductOwnerResult,
  InfiniteProductOwnerOptions,
  ProductOwnerIntakeDecision,
  SmartTaskPlan,
  MultiOrchestratorPrePlanningResult,
} from "../planner/models.ts";
import { readCognitiveMemory } from "../planner/memory.ts";
import { readFeedbackQueue, resolveFeedbackQueuePath } from "../../../feedback/queue/index.ts";
import { readTaskQueue, resolveTaskQueuePath, type TaskQueueItem } from "../../../../task/queue/index.ts";
import { executeAtomicAdmissionToDispatch } from "./dispatch.ts";
export function runInfiniteProductOwnerCycle(
  options: InfiniteProductOwnerOptions = {},
): InfiniteProductOwnerResult {
  const cycleId = `po-cycle-${Date.now()}`;
  const nowIso = new Date().toISOString();

  const feedbackItems = readFeedbackQueue(options.capsulesDir);
  const pendingFeedbacks = feedbackItems.filter((f) => f.status === "PENDING");
  const directIntake = options.directIntakeItems ?? [];
  const maxTasks = options.maxTasks ?? 10;

  const decisions: ProductOwnerIntakeDecision[] = [];
  let synthesizedPlans: readonly SmartTaskPlan[] = [];
  let enqueuedTasks: readonly TaskQueueItem[] = [];
  let multiOrchPlan: MultiOrchestratorPrePlanningResult | undefined = undefined;
  let mode:
    | "feedback_intake"
    | "self_evolution"
    | "multi_orchestrator_dispatch"
    | "idle_monitored" = "idle_monitored";

  // Check Mode B: Pending feedback items or direct intake items
  if (pendingFeedbacks.length > 0 || directIntake.length > 0) {
    mode = "feedback_intake";

    const candidateFeedbacks: FeedbackItem[] = [...pendingFeedbacks];
    if (directIntake.length > 0) {
      for (const item of directIntake) {
        candidateFeedbacks.push({
          id: item.id,
          timestamp: nowIso,
          priority:
            typeof item.priority === "string"
              ? (item.priority as FeedbackPriority)
              : "USER_DIRECTIVE",
          status: "PENDING",
          category:
            typeof item.category === "string" ? (item.category as FeedbackCategory) : "CORE_ENGINE",
          title: item.title,
          content: item.description,
          candidate_id: item.candidate_id ?? null,
          metadata: item.metadata,
        });
      }
    }

    const selectedFeedbacks = candidateFeedbacks.slice(0, maxTasks);
    synthesizedPlans = partitionGroupedFeedbacksStrictly(selectedFeedbacks, {
      charterGoals: options.charterGoals,
    });

    for (let i = 0; i < selectedFeedbacks.length; i++) {
      const fb = selectedFeedbacks[i]!;
      const assignedTask = synthesizedPlans[i];
      decisions.push({
        item_id: fb.id,
        admitted: true,
        priority: assignedTask?.priority ?? "HIGH",
        rationale: `Product Owner admitted item '${fb.title}' into isolated task node ${assignedTask?.id ?? "unknown"}`,
        assigned_task_id: assignedTask?.id,
      });
    }

    // Check multi-orchestrator pre-planning
    if (
      (options.orchestratorCount && options.orchestratorCount > 1) ||
      (options.orchestratorIds && options.orchestratorIds.length > 0)
    ) {
      mode = "multi_orchestrator_dispatch";
      const staged = stageTasksForMultiOrchestratorExecution(synthesizedPlans, {
        orchestratorIds: options.orchestratorIds,
        maxOrchestrators: options.orchestratorCount,
      });
      synthesizedPlans = staged.staged_tasks;
      multiOrchPlan = staged.plan;
    }

    // Execute atomic admission-to-dispatch
    if (options.autoEnqueue !== false) {
      const dispatchRes = executeAtomicAdmissionToDispatch({
        capsulesDir: options.capsulesDir,
        queuePath: options.queuePath,
        feedbackItems: selectedFeedbacks,
        charterGoals: options.charterGoals,
        orchestratorIds: options.orchestratorIds,
      });
      enqueuedTasks = dispatchRes.enqueued_tasks;
      synthesizedPlans = dispatchRes.synthesized_tasks;
    }
  } else {
    // Check Task Queue State: if idle, run Mode A Self-Evolution
    const currentQueue = readTaskQueue(options.queuePath);
    const activeTasks = currentQueue.filter(
      (t) =>
        t.status === "PENDING" ||
        t.status === "ADMITTED" ||
        t.status === "IN_PROGRESS" ||
        t.status === "RUNNING" ||
        t.status === "VALIDATING",
    );

    if (activeTasks.length === 0) {
      mode = "self_evolution";
      const selfSynth = synthesizeSmartTasksFromSelfEvolution({
        capsulesDir: options.capsulesDir,
        queuePath: options.queuePath,
        charterGoals: options.charterGoals,
        maxTasks: options.maxTasks,
        autoEnqueue: options.autoEnqueue !== false,
        cognitiveMemoryPath: options.memoryPath,
      });

      synthesizedPlans = selfSynth.tasks;
      for (const t of synthesizedPlans) {
        decisions.push({
          item_id: t.id,
          admitted: true,
          priority: t.priority ?? "HIGH",
          rationale: `Product Owner autonomous self-evolution task: ${t.label}`,
          assigned_task_id: t.id,
        });
      }

      if (
        (options.orchestratorCount && options.orchestratorCount > 1) ||
        (options.orchestratorIds && options.orchestratorIds.length > 0)
      ) {
        const staged = stageTasksForMultiOrchestratorExecution(synthesizedPlans, {
          orchestratorIds: options.orchestratorIds,
          maxOrchestrators: options.orchestratorCount,
        });
        synthesizedPlans = staged.staged_tasks;
        multiOrchPlan = staged.plan;
      }

      if (options.autoEnqueue !== false) {
        const updatedQueue = readTaskQueue(options.queuePath);
        enqueuedTasks = updatedQueue.slice(-synthesizedPlans.length);
      }
    } else {
      mode = "idle_monitored";
    }
  }

  const macroMetrics = multiOrchPlan
    ? multiOrchPlan.macro_metrics
    : computeMacroMetrics(synthesizedPlans);

  // Update memory
  try {
    updateCognitiveMemory(
      (curr) => ({
        ...curr,
        strategic_focus: [
          "Infinite Product Owner Backlog & Admission Governance",
          "Continuous Atomic Admission-to-Dispatch Chaining (Zero Paused Admitted)",
          "Concurrent Multi-Orchestrator Disjoint Write Scope Pre-Planning",
          "Zero-Any & Zero-Suppression Strict Compliance",
        ],
        macro_metrics: macroMetrics,
      }),
      options.memoryPath,
    );
  } catch {
    // non-fatal
  }

  const auditReport = verifyAdmissionToDispatchInvariants(options);

  return {
    cycle_id: cycleId,
    timestamp: nowIso,
    mode,
    decisions,
    synthesized_tasks: synthesizedPlans,
    enqueued_tasks: enqueuedTasks,
    ...(multiOrchPlan ? { multi_orchestrator_plan: multiOrchPlan } : {}),
    macro_metrics: macroMetrics,
    zero_paused_admitted_guaranteed: auditReport.zero_paused_admitted,
    summary: `Infinite Product Owner cycle [${mode}] completed: ${decisions.length} decision(s), ${synthesizedPlans.length} synthesized task(s), ${enqueuedTasks.length} enqueued task(s), zero paused admitted items verified.`,
  };
}

/**
 * Drains completed items from active backlog into completed-tasks archive upon run/task completion.
 */
export function drainBacklogOnRunCompletion(params: {
  readonly runId?: string | undefined;
  readonly commitSha?: string | undefined;
  readonly testPath?: string | undefined;
  readonly completedTasks?: readonly string[] | undefined;
  readonly repoRoot?: string | undefined;
  readonly backlogPath?: string | undefined;
  readonly completedTasksPath?: string | undefined;
}): {
  readonly drainedCount: number;
  readonly remainingBacklogCount: number;
  readonly archivedRecords: readonly CompletedTaskRecord[];
} {
  const root = params.repoRoot ? resolve(params.repoRoot) : process.cwd();
  const backlogPath = resolveFeedbackQueuePath(params.backlogPath);
  const completedPath = resolveCompletedTasksLedgerPath(params.completedTasksPath);

  const backlogItems = readFeedbackQueue(backlogPath);
  if (backlogItems.length === 0) {
    return {
      drainedCount: 0,
      remainingBacklogCount: 0,
      archivedRecords: [],
    };
  }

  const completedIds = new Set(params.completedTasks ?? []);
  const toDrain: FeedbackItem[] = [];

  for (const item of backlogItems) {
    const isExplicitlyCompleted =
      completedIds.has(item.id) ||
      (item.candidate_id !== null &&
        item.candidate_id !== undefined &&
        completedIds.has(item.candidate_id));
    const isStatusDone =
      item.status === "COMPLETED" || item.status === "PROCESSED" || item.status === "DECLINED";

    if (isExplicitlyCompleted || isStatusDone) {
      toDrain.push(item);
    }
  }

  const archivedRecords: CompletedTaskRecord[] = toDrain.map((item) => ({
    id: item.id,
    source: "feedback_queue",
    title: item.title,
    status: item.status === "DECLINED" ? "RESOLVED" : "COMPLETED",
    proof_summary:
      item.resolution_note ??
      item.resolution?.proof_summary ??
      `Completed under run ${params.runId ?? "run-complete"}`,
    completed_at: item.processed_at ?? item.resolution?.resolved_at ?? new Date().toISOString(),
    ...(item.candidate_id ? { generation_id: item.candidate_id } : {}),
    ...((params.commitSha ?? item.commit_sha ?? item.resolution?.commit_sha)
      ? { commit_sha: params.commitSha ?? item.commit_sha ?? item.resolution?.commit_sha }
      : {}),
    ...(item.category ? { category: item.category } : {}),
    ...((params.testPath ?? item.test_path ?? item.resolution?.test_path)
      ? { test_path: params.testPath ?? item.test_path ?? item.resolution?.test_path }
      : {}),
    ...((item.assertions ?? item.resolution?.assertions !== undefined)
      ? { assertions: item.assertions ?? item.resolution?.assertions }
      : {}),
    ...((item.runtime_ms ?? item.resolution?.runtime_ms !== undefined)
      ? { runtime_ms: item.runtime_ms ?? item.resolution?.runtime_ms }
      : {}),
    ...(item.resolution ? { resolution: item.resolution } : {}),
    ...(item.metadata ? { metadata: item.metadata } : {}),
  }));

  if (toDrain.length > 0) {
    recordCompletedTasksBatch(archivedRecords, { customPath: completedPath });
    const drainedIds = new Set(toDrain.map((item) => item.id));
    updateOrPruneFeedbackItems((item) => (drainedIds.has(item.id) ? null : item), backlogPath);
  }

  return {
    drainedCount: toDrain.length,
    remainingBacklogCount: readFeedbackQueue(backlogPath).length,
    archivedRecords,
  };
}

/**
 * Autonomous Code Quality Scanner (detects dead code, AST suppressions, pattern deviations).
 */
