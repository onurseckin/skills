import {
  mapFeedbackPriorityToTaskPriority,
  deriveWriteScopeForCategory,
  deriveGateForCategory,
  sanitizeSlug,
} from "./orchestrator.ts";
import {
  synthesizeSmartTasksFromSelfEvolution,
  synthesizeSmartTasksFromFeedbackQueue,
} from "./evolution.ts";
import { assertAntiBatchingRule } from "../planner/partitioning.ts";
import { enrichTaskPlanWithExactAnchors } from "../planner/anti-batching.ts";
import { getQueueStats, readTaskQueue, type TaskPriority } from "../../../../task/queue/index.ts";
import { readFeedbackQueue, type FeedbackItem } from "../../../feedback/index.ts";
import type {
  SmartTaskPlan,
  AutonomousDualIntakeResult,
  SmartTaskSynthesisResult,
} from "../planner/models.ts";
import { readCognitiveMemory } from "../planner/memory.ts";
import { HarnessError } from "../../../../core/errors/index.ts";
export function synthesizeAutonomousTasks(
  options: {
    readonly capsulesDir?: string | undefined;
    readonly queuePath?: string | undefined;
    readonly charterGoals?: readonly string[] | undefined;
    readonly maxTasks?: number | undefined;
    readonly autoEnqueue?: boolean | undefined;
  } = {},
): SmartTaskSynthesisResult {
  const feedbackItems = readFeedbackQueue(options.capsulesDir);
  const pendingFeedback = feedbackItems.filter((f) => f.status === "PENDING");

  if (pendingFeedback.length > 0) {
    return synthesizeSmartTasksFromFeedbackQueue(options);
  }

  return synthesizeSmartTasksFromSelfEvolution(options);
}
export function processAutonomousDualIntake(
  options: {
    readonly capsulesDir?: string | undefined;
    readonly queuePath?: string | undefined;
    readonly charterGoals?: readonly string[] | undefined;
    readonly maxTasks?: number | undefined;
  } = {},
): AutonomousDualIntakeResult {
  const currentQueue = readTaskQueue(options.queuePath);
  const activeTasks = currentQueue.filter(
    (t) =>
      t.status === "PENDING" ||
      t.status === "ADMITTED" ||
      t.status === "IN_PROGRESS" ||
      t.status === "RUNNING" ||
      t.status === "VALIDATING" ||
      t.status === "BLOCKED",
  );

  const feedbackItems = readFeedbackQueue(options.capsulesDir);
  const pendingFeedback = feedbackItems.filter((f) => f.status === "PENDING");

  if (pendingFeedback.length > 0) {
    const synth = synthesizeSmartTasksFromFeedbackQueue({
      capsulesDir: options.capsulesDir,
      queuePath: options.queuePath,
      charterGoals: options.charterGoals,
      maxTasks: options.maxTasks,
      autoEnqueue: true,
    });

    const updatedQueue = readTaskQueue(options.queuePath);
    const stats = getQueueStats(updatedQueue);

    return {
      mode: "Mode_B_External_Intake",
      synthesized_plans: synth.tasks,
      enqueued_tasks: updatedQueue.slice(-synth.tasks.length),
      queue_stats: stats,
      summary: `Mode B External Intake: Ingested and enqueued ${synth.tasks.length} task(s) from feedback queue.`,
      admitted_feedback_ids: pendingFeedback.slice(0, synth.tasks.length).map((f) => f.id),
    };
  }

  if (activeTasks.length === 0) {
    const synth = synthesizeSmartTasksFromSelfEvolution({
      capsulesDir: options.capsulesDir,
      queuePath: options.queuePath,
      charterGoals: options.charterGoals,
      maxTasks: options.maxTasks,
      autoEnqueue: true,
    });

    const updatedQueue = readTaskQueue(options.queuePath);
    const stats = getQueueStats(updatedQueue);

    return {
      mode: "Mode_A_Self_Evolution",
      synthesized_plans: synth.tasks,
      enqueued_tasks: updatedQueue.slice(-synth.tasks.length),
      queue_stats: stats,
      summary: `Mode A Autonomous Self-Evolution: Synthesized and enqueued ${synth.tasks.length} task(s) on empty queue.`,
      admitted_feedback_ids: [],
    };
  }

  const stats = getQueueStats(currentQueue);
  return {
    mode: "Queue_Active",
    synthesized_plans: [],
    enqueued_tasks: [],
    queue_stats: stats,
    summary: `Task queue currently active with ${activeTasks.length} pending/in-progress task(s).`,
    admitted_feedback_ids: [],
  };
}
export function runAutonomousDualIntakeCycle(
  options: {
    readonly capsulesDir?: string | undefined;
    readonly queuePath?: string | undefined;
    readonly charterGoals?: readonly string[] | undefined;
    readonly maxTasks?: number | undefined;
  } = {},
): AutonomousDualIntakeResult {
  return processAutonomousDualIntake(options);
}

export function expandExternalPromptToPlan(
  prompt: string,
  options: {
    readonly charterGoals?: readonly string[] | undefined;
    readonly baseId?: string | undefined;
    readonly priority?: TaskPriority | undefined;
    readonly writeScope?: readonly string[] | undefined;
    readonly gate?: string | undefined;
    readonly assignedTier?:
      | "Tier_0_Mind"
      | "Tier_1_Orchestrator"
      | "Tier_2_Coordinator"
      | "Tier_3_Implementer"
      | "Tier_3_Validator"
      | undefined;
    readonly assignedImplementer?: string | undefined;
    readonly assignedValidator?: string | undefined;
  } = {},
): SmartTaskPlan {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new HarnessError("INVALID_ARGUMENT", "Prompt cannot be empty for task expansion");
  }

  const lines = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const title = lines[0]!.slice(0, 80);
  const baseId =
    options.baseId !== undefined && options.baseId.trim().length > 0
      ? sanitizeSlug(options.baseId.trim())
      : `task-${sanitizeSlug(title.slice(0, 30))}`;
  const goals =
    options.charterGoals && options.charterGoals.length > 0 ? options.charterGoals : ["G1"];

  const scope =
    options.writeScope && options.writeScope.length > 0
      ? options.writeScope
      : ["olt/scripts/src/", "tests/unit/"];

  const gate =
    options.gate && options.gate.trim().length > 0
      ? options.gate.trim()
      : deriveGateForCategory("CORE_ENGINE", scope);

  const criteria: string[] = [
    `Implement requirements declared in: ${title}`,
    `Pass gate verification: ${gate}`,
    "Maintain strict type safety (0 any, 0 suppressions)",
  ];

  const plan: SmartTaskPlan = {
    id: baseId,
    label: title,
    write_scope: scope,
    gate,
    charter_goals: goals,
    acceptance_criteria: criteria,
    dependencies: [],
    source_type: "direct_prompt",
    priority: options.priority ?? "HIGH",
    rationale: `Expanded from direct prompt: ${trimmed.slice(0, 120)}`,
    assigned_tier: options.assignedTier ?? "Tier_3_Implementer",
    assigned_implementer: options.assignedImplementer ?? `implementer-${baseId}`,
    assigned_validator: options.assignedValidator ?? `validator-${baseId}`,
    metadata: {
      assigned_implementer: options.assignedImplementer ?? `implementer-${baseId}`,
      assigned_validator: options.assignedValidator ?? `validator-${baseId}`,
    },
  };

  const enriched = enrichTaskPlanWithExactAnchors(plan);
  assertAntiBatchingRule([enriched]);
  return enriched;
}

export function planEnhance(
  promptOrFeedback: string | FeedbackItem,
  options: {
    readonly charterGoals?: readonly string[] | undefined;
    readonly baseId?: string | undefined;
    readonly priority?: TaskPriority | undefined;
    readonly writeScope?: readonly string[] | undefined;
    readonly gate?: string | undefined;
    readonly assignedImplementer?: string | undefined;
    readonly assignedValidator?: string | undefined;
  } = {},
): SmartTaskPlan {
  if (typeof promptOrFeedback === "string") {
    return expandExternalPromptToPlan(promptOrFeedback, options);
  }

  const fb = promptOrFeedback;
  const slug = sanitizeSlug(fb.id);
  const scope =
    options.writeScope && options.writeScope.length > 0
      ? options.writeScope
      : deriveWriteScopeForCategory(fb.category, fb.id);
  const gate =
    options.gate && options.gate.trim().length > 0
      ? options.gate.trim()
      : deriveGateForCategory(fb.category, scope);
  const priority = options.priority ?? mapFeedbackPriorityToTaskPriority(fb.priority);
  const baseId = options.baseId ? sanitizeSlug(options.baseId) : `task-${slug}`;

  const assignedImplementer = options.assignedImplementer ?? `implementer-${slug}`;
  const assignedValidator = options.assignedValidator ?? `validator-${slug}`;

  const plan: SmartTaskPlan = {
    id: baseId,
    label: fb.title,
    write_scope: scope,
    gate,
    charter_goals:
      options.charterGoals && options.charterGoals.length > 0 ? options.charterGoals : ["G1"],
    acceptance_criteria: [
      `Satisfy feedback requirements: ${fb.title}`,
      `Pass gate: ${gate}`,
      "Ensure 0 TypeScript any and zero suppressions",
    ],
    dependencies: [],
    source_type: "plan_enhancement",
    priority,
    rationale: `Plan enhanced from feedback item [${fb.category}]: ${fb.content.slice(0, 150)}`,
    assigned_tier: "Tier_2_Coordinator",
    assigned_implementer: assignedImplementer,
    assigned_validator: assignedValidator,
    feedback_id: fb.id,
    metadata: {
      feedback_id: fb.id,
      assigned_implementer: assignedImplementer,
      assigned_validator: assignedValidator,
    },
  };

  const enriched = enrichTaskPlanWithExactAnchors(plan);
  assertAntiBatchingRule([enriched]);
  return enriched;
}
