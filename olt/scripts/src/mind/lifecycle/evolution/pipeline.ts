import { join } from "node:path";
import { readTaskQueue } from "../../tasks/queue/index.ts";
import { readFeedbackQueue } from "../../feedback/queue/index.ts";
import {
  DEFAULT_EVOLUTION_BASE_INTERVAL_MS,
  DEFAULT_EVOLUTION_MAX_INTERVAL_MS,
  PERPETUAL_NON_STOPPING_CADENCE,
  NON_STOPPING_RULE,
} from "./types.ts";
import { calculateExponentialBackoff, applyIntervalJitter } from "../interval/index.ts";
import type {
  OrchestratorNodeInfo,
  PerpetualCadenceEvaluation,
  SelfEvolutionCadenceState,
  SelfEvolutionCycleResult,
} from "./types.ts";
import { calculateHierarchyCapacity } from "./cadence.ts";

/**
 * Evaluates current Mind cadence state to decide whether self-evolution should engage.
 */
export function evaluatePerpetualCadence(params: {
  readonly taskQueuePath?: string | undefined;
  readonly feedbackQueuePath?: string | undefined;
  readonly state?: Partial<SelfEvolutionCadenceState> | undefined;
  readonly baseIntervalMs?: number | undefined;
  readonly maxIntervalMs?: number | undefined;
  readonly now?: string | number | Date | undefined;
  readonly runRoot?: string | undefined;
  readonly orchestrators?: readonly OrchestratorNodeInfo[] | undefined;
}): PerpetualCadenceEvaluation {
  const nowMs = params.now !== undefined ? new Date(params.now).getTime() : Date.now();
  const queueItems = readTaskQueue(params.taskQueuePath);
  const activeTasks = queueItems.filter(
    (t) =>
      t.status === "PENDING" ||
      t.status === "ADMITTED" ||
      t.status === "IN_PROGRESS" ||
      t.status === "RUNNING",
  );

  const feedbacks = readFeedbackQueue(params.feedbackQueuePath);
  const pendingFeedbacks = feedbacks.filter((f) => f.status === "PENDING");

  const baseInterval = params.baseIntervalMs ?? DEFAULT_EVOLUTION_BASE_INTERVAL_MS;
  const maxInterval = params.maxIntervalMs ?? DEFAULT_EVOLUTION_MAX_INTERVAL_MS;
  const streak = params.state?.quiescenceStreak ?? 0;

  const rawBackoff = calculateExponentialBackoff(baseInterval, maxInterval, streak);
  const nextIntervalMs = applyIntervalJitter(rawBackoff);
  const nextWakeAt = new Date(nowMs + nextIntervalMs).toISOString();
  const runArg = params.runRoot ? ` --run ${params.runRoot}` : "";

  const hierarchyMetrics = calculateHierarchyCapacity({
    taskQueue: queueItems,
    orchestrators: params.orchestrators,
  });

  if (activeTasks.length > 0) {
    return {
      cadence: PERPETUAL_NON_STOPPING_CADENCE,
      mode: "QUEUE_ACTIVE",
      canEvolve: false,
      reason: `Queue has ${activeTasks.length} active task(s) in progress; proceeding with task execution`,
      queueActive: true,
      pendingFeedbackCount: pendingFeedbacks.length,
      activeTasksCount: activeTasks.length,
      nextWakeAt,
      nextIntervalMs,
      nextInstruction: `bun harness.ts queue:wave${runArg}`,
      closing_permitted: false,
      hierarchyMetrics,
    };
  }

  if (pendingFeedbacks.length > 0) {
    return {
      cadence: PERPETUAL_NON_STOPPING_CADENCE,
      mode: "MODE_B_FEEDBACK_INTAKE",
      canEvolve: true,
      reason: `Found ${pendingFeedbacks.length} pending feedback item(s); initiating Mode B feedback intake`,
      queueActive: false,
      pendingFeedbackCount: pendingFeedbacks.length,
      activeTasksCount: 0,
      nextWakeAt,
      nextIntervalMs,
      nextInstruction: `bun harness.ts mind:self-evolve${runArg}`,
      closing_permitted: false,
      hierarchyMetrics,
    };
  }

  return {
    cadence: PERPETUAL_NON_STOPPING_CADENCE,
    mode: "MODE_A_AUTONOMIC_DISCOVERY",
    canEvolve: true,
    reason: "Task and feedback queues are clear; engaging Mode A autonomic task discovery",
    queueActive: false,
    pendingFeedbackCount: 0,
    activeTasksCount: 0,
    nextWakeAt,
    nextIntervalMs,
    nextInstruction: `bun harness.ts mind:self-evolve${runArg}`,
    closing_permitted: false,
    hierarchyMetrics,
  };
}

/**
 * Formats a concise markdown brief of self-evolution cycle execution.
 */
export function formatSelfEvolutionBrief(result: SelfEvolutionCycleResult): string {
  const lines: string[] = [
    `### Self-Evolution Cycle: ${result.cycleId}`,
    `- **Mode**: \`${result.mode}\``,
    `- **Generation**: ${result.generation} (Cycle ${result.cycleNumber})`,
    `- **Synthesized Tasks**: ${result.synthesizedTasks.length}`,
    `- **Candidate Proposals**: ${result.candidateProposals.length}`,
    `- **Plan Revisions**: ${result.planRevisions.length}`,
    `- **Enqueued Tasks**: ${result.enqueuedTasks.length}`,
    `- **Admitted Feedback**: ${result.admittedFeedbackIds.length}`,
    `- **Hierarchy Scaling**: \`${result.scalingDecision.action}\` (T1: ${result.hierarchyMetrics.activeTier1Count}, T2: ${result.hierarchyMetrics.activeTier2Count})`,
    `- **Duration**: ${result.durationMs}ms`,
    `- **Next Recommended Command**: \`${result.nextRecommendedCommand}\``,
  ];

  if (result.synthesizedTasks.length > 0) {
    lines.push("", "#### Synthesized Tasks:");
    for (const task of result.synthesizedTasks.slice(0, 5)) {
      lines.push(`- **${task.id}**: ${task.label}`);
    }
  }

  return lines.join("\n");
}
