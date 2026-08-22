import { HarnessError } from "../errors/harness-error.ts";
import {
  drainPendingFeedbacks,
  readFeedbackQueue,
  type FeedbackCategory,
  type FeedbackItem,
} from "./feedback-queue.ts";
import { auditBlunderLog } from "./blunders.ts";
import {
  enqueueTasksBatch,
  getQueueStats,
  readTaskQueue,
  type NewTaskQueueInput,
  type TaskPriority,
  type TaskQueueItem,
  type TaskQueueStats,
} from "./task-queue.ts";

export type SmartTaskSourceType =
  | "feedback_intake"
  | "self_evolution"
  | "blunder_remediation"
  | "direct_prompt"
  | "external_intake";

export interface SmartTaskPlan {
  readonly id: string;
  readonly label: string;
  readonly write_scope: readonly string[];
  readonly gate: string;
  readonly charter_goals: readonly string[];
  readonly acceptance_criteria: readonly string[];
  readonly dependencies: readonly string[];
  readonly source_type: SmartTaskSourceType;
  readonly priority?: TaskPriority | undefined;
  readonly rationale: string;
}

export interface SmartTaskSynthesisResult {
  readonly mode: "feedback_intake" | "self_evolution" | "external_intake" | "queue_active";
  readonly tasks: readonly SmartTaskPlan[];
  readonly summary: string;
  readonly source_items_count: number;
  readonly enqueued_count?: number | undefined;
}

export interface WaveGroup {
  readonly wave_number: number;
  readonly task_ids: readonly string[];
  readonly tasks: readonly SmartTaskPlan[];
}

export interface SmartWavePlanResult {
  readonly total_waves: number;
  readonly total_tasks: number;
  readonly waves: readonly WaveGroup[];
}

export interface AutonomousDualIntakeResult {
  readonly mode: "Mode_A_Self_Evolution" | "Mode_B_External_Intake" | "Queue_Active";
  readonly synthesized_plans: readonly SmartTaskPlan[];
  readonly enqueued_tasks: readonly TaskQueueItem[];
  readonly queue_stats: TaskQueueStats;
  readonly summary: string;
  readonly admitted_feedback_ids: readonly string[];
}

/**
 * Autonomous Task Synthesizer implementing Dual-Intake:
 * - Mode A: Empty queue -> Autonomous Self-Evolution (Blunder remediation + Invariant hardening)
 * - Mode B: Pending items -> Feedback / External Directive Expansion
 */
export function synthesizeAutonomousTasks(options: {
  readonly capsulesDir?: string | undefined;
  readonly queuePath?: string | undefined;
  readonly charterGoals?: readonly string[] | undefined;
  readonly maxTasks?: number | undefined;
  readonly autoEnqueue?: boolean | undefined;
} = {}): SmartTaskSynthesisResult {
  const maxTasks = options.maxTasks ?? 5;
  const feedbackItems = readFeedbackQueue(options.capsulesDir);
  const pendingFeedback = feedbackItems.filter((f) => f.status === "PENDING");

  // Mode B: If pending user feedback items exist, prioritize and expand them
  if (pendingFeedback.length > 0) {
    const selected = pendingFeedback.slice(0, maxTasks);
    const tasks: SmartTaskPlan[] = [];
    const seenScopes = new Set<string>();

    for (let i = 0; i < selected.length; i++) {
      const fb = selected[i]!;
      const scope = deriveWriteScopeForCategory(fb.category, fb.id);
      const gate = deriveGateForCategory(fb.category, scope);
      const priority = mapFeedbackPriorityToTaskPriority(fb.priority);
      const taskId = `task-${i + 1}-${sanitizeSlug(fb.id)}`;

      // Establish sequential dependencies if scopes collide
      const dependencies: string[] = [];
      for (const s of scope) {
        if (seenScopes.has(s) && i > 0) {
          dependencies.push(tasks[i - 1]!.id);
          break;
        }
        seenScopes.add(s);
      }

      tasks.push({
        id: taskId,
        label: fb.title,
        write_scope: scope,
        gate,
        charter_goals: options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G1"],
        acceptance_criteria: [
          `Satisfy user directive/feedback: ${fb.title}`,
          `Pass mandatory gate: ${gate}`,
          `Enforce 0 TypeScript any and 0 compiler/linter suppressions`,
        ],
        dependencies,
        source_type: "feedback_intake",
        priority,
        rationale: `Ingested from feedback queue [${fb.priority}]: ${fb.content.slice(0, 150)}`,
      });
    }

    let enqueuedCount = 0;
    if (options.autoEnqueue) {
      const batchInputs: NewTaskQueueInput[] = tasks.map((t) => ({
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
      }));
      const enqueued = enqueueTasksBatch(batchInputs, options.queuePath);
      enqueuedCount = enqueued.length;

      // Drain and update pending feedbacks
      drainPendingFeedbacks(
        { markAs: "ADMITTED", limit: selected.length },
        options.capsulesDir,
      );
    }

    return {
      mode: "feedback_intake",
      tasks,
      summary: `Synthesized ${tasks.length} task(s) from pending user feedback queue.`,
      source_items_count: pendingFeedback.length,
      ...(enqueuedCount > 0 ? { enqueued_count: enqueuedCount } : {}),
    };
  }

  // Mode A: Self-evolution tasks from blunder remediation & architectural audit
  const targetRoots = options.capsulesDir ? [options.capsulesDir] : [".capsules/"];
  const blunderAudit = auditBlunderLog(targetRoots);
  const openBlunders = blunderAudit.blunders.filter((b) => b.status === "open");

  const selfTasks: SmartTaskPlan[] = [];

  if (openBlunders.length > 0) {
    const blunder = openBlunders[0]!;
    const blunderScope = deriveWriteScopeForCategory("CORE_ENGINE", blunder.id);
    const blunderGate = deriveGateForCategory("CORE_ENGINE", blunderScope);

    selfTasks.push({
      id: `task-1-blunder-${sanitizeSlug(blunder.id)}`,
      label: `Automated Blunder Remediation (${blunder.category})`,
      write_scope: blunderScope,
      gate: blunderGate,
      charter_goals: options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G2"],
      acceptance_criteria: [
        `Remediate open blunder ${blunder.id}: ${blunder.observation.slice(0, 100)}`,
        `Pass gate: ${blunderGate}`,
        `Verify regression immunity in unit test suite`,
      ],
      dependencies: [],
      source_type: "blunder_remediation",
      priority: "CRITICAL",
      rationale: `Autonomous remediation for open blunder ${blunder.id}: ${blunder.observation}`,
    });
  }

  // Add invariant hardening task
  const hardeningScope = [
    "orchestrating-long-tasks/scripts/src/mind/smart-task-manager.ts",
    "orchestrating-long-tasks/scripts/src/mind/task-queue.ts",
    "tests/unit/mind/smart-task-manager.test.ts",
    "tests/unit/mind/task-queue.test.ts",
  ];
  selfTasks.push({
    id: `task-${selfTasks.length + 1}-invariant-hardening`,
    label: "Continuous Invariant Hardening & Zero-Suppression Assurance",
    write_scope: hardeningScope,
    gate: "bun test tests/unit/mind && bun run typecheck",
    charter_goals: options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G1"],
    acceptance_criteria: [
      "0 TypeScript any across all modules",
      "0 compiler or linter suppressions",
      "All unit tests pass with exit code 0",
    ],
    dependencies: selfTasks.length > 0 ? [selfTasks[0]!.id] : [],
    source_type: "self_evolution",
    priority: "HIGH",
    rationale: "Continuous invariant hardening maintaining zero compiler suppressions and deterministic typed schemas.",
  });

  // Add autonomic continuous optimization task
  selfTasks.push({
    id: `task-${selfTasks.length + 1}-autonomic-optimization`,
    label: "Continuous Architecture & Invariant Hardening",
    write_scope: [
      "orchestrating-long-tasks/scripts/src/mind/",
      "tests/unit/mind/",
    ],
    gate: "bun test tests/unit/mind && bun run typecheck",
    charter_goals: options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G3"],
    acceptance_criteria: [
      "Autonomic self-evolution cycle maintaining loop cadence and clean metrics",
      "Pass all mind unit tests cleanly",
    ],
    dependencies: [selfTasks[selfTasks.length - 1]!.id],
    source_type: "self_evolution",
    priority: "MEDIUM",
    rationale: "Autonomic self-evolution cycle maintaining 0 any, 0 suppressions, and continuous loop cadence.",
  });

  const selectedSelfTasks = selfTasks.slice(0, maxTasks);

  let enqueuedCount = 0;
  if (options.autoEnqueue) {
    const batchInputs: NewTaskQueueInput[] = selectedSelfTasks.map((t) => ({
      id: t.id,
      title: t.label,
      description: t.rationale,
      priority: t.priority ?? "MEDIUM",
      write_scope: t.write_scope,
      gate: t.gate,
      charter_goals: t.charter_goals,
      acceptance_criteria: t.acceptance_criteria,
      dependencies: t.dependencies,
      source_type: t.source_type,
    }));
    const enqueued = enqueueTasksBatch(batchInputs, options.queuePath);
    enqueuedCount = enqueued.length;
  }

  return {
    mode: "self_evolution",
    tasks: selectedSelfTasks,
    summary: `Autonomous self-evolution synthesized ${selectedSelfTasks.length} task(s) on empty queue.`,
    source_items_count: openBlunders.length,
    ...(enqueuedCount > 0 ? { enqueued_count: enqueuedCount } : {}),
  };
}

/**
 * Expands an external raw prompt or user directive into a structured SmartTaskPlan.
 */
export function expandExternalPromptToPlan(
  prompt: string,
  options: {
    readonly charterGoals?: readonly string[] | undefined;
    readonly baseId?: string | undefined;
    readonly priority?: TaskPriority | undefined;
    readonly writeScope?: readonly string[] | undefined;
    readonly gate?: string | undefined;
  } = {},
): SmartTaskPlan {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new HarnessError("INVALID_ARGUMENT", "Prompt cannot be empty for task expansion");
  }

  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
  const title = lines[0]!.slice(0, 80);
  const baseId = options.baseId !== undefined && options.baseId.trim().length > 0
    ? sanitizeSlug(options.baseId.trim())
    : `task-${sanitizeSlug(title.slice(0, 30))}`;
  const goals = options.charterGoals && options.charterGoals.length > 0 ? options.charterGoals : ["G1"];

  const scope = options.writeScope && options.writeScope.length > 0
    ? options.writeScope
    : ["orchestrating-long-tasks/scripts/src/", "tests/unit/"];

  const gate = options.gate && options.gate.trim().length > 0
    ? options.gate.trim()
    : deriveGateForCategory("CORE_ENGINE", scope);

  const criteria: string[] = [
    `Implement requirements declared in: ${title}`,
    `Pass gate verification: ${gate}`,
    "Maintain strict type safety (0 any, 0 suppressions)",
  ];

  return {
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
  };
}

/**
 * Expands an external prompt with multiple directives into a multi-step wave plan.
 */
export function expandExternalPromptToWavePlan(
  prompt: string,
  options: {
    readonly charterGoals?: readonly string[] | undefined;
    readonly baseIdPrefix?: string | undefined;
  } = {},
): SmartWavePlanResult {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new HarnessError("INVALID_ARGUMENT", "Prompt cannot be empty for wave expansion");
  }

  const lines = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  const prefix = options.baseIdPrefix ?? "wave-task";
  const goals = options.charterGoals && options.charterGoals.length > 0 ? options.charterGoals : ["G1"];

  const tasks: SmartTaskPlan[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const id = `${prefix}-${i + 1}-${sanitizeSlug(line.slice(0, 25))}`;
    const scope = [
      `orchestrating-long-tasks/scripts/src/mind/step-${i + 1}.ts`,
      `tests/unit/mind/step-${i + 1}.test.ts`,
    ];
    const gate = `bun test tests/unit/mind/step-${i + 1}.test.ts && bun run typecheck`;
    const dependencies = i > 0 ? [tasks[i - 1]!.id] : [];

    tasks.push({
      id,
      label: line.slice(0, 80),
      write_scope: scope,
      gate,
      charter_goals: goals,
      acceptance_criteria: [
        `Complete wave subtask: ${line}`,
        `Verify gate: ${gate}`,
      ],
      dependencies,
      source_type: "external_intake",
      priority: "HIGH",
      rationale: `Expanded step ${i + 1} from multi-step prompt: ${line}`,
    });
  }

  return compileSmartTasksToWavePlan(tasks);
}

/**
 * Compiles an array of SmartTaskPlans into ordered execution waves with disjoint write scopes.
 */
export function compileSmartTasksToWavePlan(tasks: readonly SmartTaskPlan[]): SmartWavePlanResult {
  if (tasks.length === 0) {
    return {
      total_waves: 0,
      total_tasks: 0,
      waves: [],
    };
  }

  const taskMap = new Map<string, SmartTaskPlan>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  // Compute depth for each task based on dependencies
  const depthMap = new Map<string, number>();

  function getDepth(taskId: string, visiting: Set<string>): number {
    if (depthMap.has(taskId)) {
      return depthMap.get(taskId)!;
    }
    if (visiting.has(taskId)) {
      throw new HarnessError("INTEGRITY", `Circular dependency detected involving task '${taskId}'`);
    }

    visiting.add(taskId);
    const task = taskMap.get(taskId);
    let maxDepDepth = 0;
    if (task) {
      for (const depId of task.dependencies) {
        if (taskMap.has(depId)) {
          const d = getDepth(depId, new Set(visiting));
          if (d + 1 > maxDepDepth) {
            maxDepDepth = d + 1;
          }
        }
      }
    }

    visiting.delete(taskId);
    const depth = maxDepDepth + 1;
    depthMap.set(taskId, depth);
    return depth;
  }

  for (const task of tasks) {
    getDepth(task.id, new Set());
  }

  // Group by depth
  const waveMap = new Map<number, SmartTaskPlan[]>();
  for (const task of tasks) {
    const depth = depthMap.get(task.id) ?? 1;
    const list = waveMap.get(depth) ?? [];
    list.push(task);
    waveMap.set(depth, list);
  }

  const sortedDepths = [...waveMap.keys()].sort((a, b) => a - b);
  const waves: WaveGroup[] = [];

  for (let i = 0; i < sortedDepths.length; i++) {
    const depth = sortedDepths[i]!;
    const waveTasks = waveMap.get(depth)!;
    waves.push({
      wave_number: i + 1,
      task_ids: waveTasks.map((t) => t.id),
      tasks: waveTasks,
    });
  }

  return {
    total_waves: waves.length,
    total_tasks: tasks.length,
    waves,
  };
}

/**
 * Runs a full Autonomous Dual-Intake Cycle:
 * - Checks queue state.
 * - If queue has active tasks, returns current status.
 * - If pending feedback exists, runs Mode B external intake and auto-enqueues.
 * - If queue is empty, runs Mode A self-evolution synthesis and auto-enqueues.
 */
export function runAutonomousDualIntakeCycle(options: {
  readonly capsulesDir?: string | undefined;
  readonly queuePath?: string | undefined;
  readonly charterGoals?: readonly string[] | undefined;
  readonly maxTasks?: number | undefined;
} = {}): AutonomousDualIntakeResult {
  const currentQueue = readTaskQueue(options.queuePath);
  const activeTasks = currentQueue.filter(
    (t) => t.status === "PENDING" || t.status === "IN_PROGRESS" || t.status === "BLOCKED",
  );

  const feedbackItems = readFeedbackQueue(options.capsulesDir);
  const pendingFeedback = feedbackItems.filter((f) => f.status === "PENDING");

  // Mode B: External Intake from pending feedback
  if (pendingFeedback.length > 0) {
    const synth = synthesizeAutonomousTasks({
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

  // If queue is completely idle (0 active tasks), run Mode A Self-Evolution
  if (activeTasks.length === 0) {
    const synth = synthesizeAutonomousTasks({
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

  // Queue is already active
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

export function deriveWriteScopeForCategory(category: string, id: string): readonly string[] {
  const slug = sanitizeSlug(id);
  switch (category) {
    case "DOCUMENTATION":
      return ["docs/", "orchestrating-long-tasks/references/"];
    case "AGENT_CONTRACTS":
      return ["orchestrating-long-tasks/agents/", "orchestrating-long-tasks/roles/", "orchestrating-long-tasks/references/"];
    case "CLI_TOOLING":
      return [
        `orchestrating-long-tasks/scripts/src/cli/commands/${slug}.ts`,
        `tests/unit/cli/${slug}.test.ts`,
      ];
    case "WATCHDOG":
      return [
        "orchestrating-long-tasks/scripts/src/authority/watchdog-manager.ts",
        "orchestrating-long-tasks/scripts/src/cli/commands/watchdog-ops.ts",
        "tests/unit/authority/watchdog-manager.test.ts",
      ];
    case "SCALING":
      return [
        "orchestrating-long-tasks/scripts/src/workflow/",
        "orchestrating-long-tasks/roles/",
        "tests/unit/workflow/",
      ];
    case "CORE_ENGINE":
    case "ARCHITECTURE":
    default:
      return [
        `orchestrating-long-tasks/scripts/src/mind/${slug}.ts`,
        `tests/unit/mind/${slug}.test.ts`,
      ];
  }
}

export function deriveGateForCategory(_category: string, writeScope: readonly string[]): string {
  const testFile = writeScope.find((s) => s.includes("test.ts") || s.includes("tests/"));
  if (testFile) {
    const cleaned = testFile.endsWith("/") ? testFile.slice(0, -1) : testFile;
    return `bun test ${cleaned} && bun run typecheck`;
  }
  return "bun test tests/unit && bun run typecheck";
}

export function sanitizeSlug(val: string): string {
  return val.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function mapFeedbackPriorityToTaskPriority(fbPriority: string): TaskPriority {
  switch (fbPriority) {
    case "CRITICAL_USER_FEEDBACK":
      return "CRITICAL";
    case "HIGH_ARCHITECTURAL_FEATURE":
      return "HIGH";
    case "USER_DIRECTIVE":
      return "HIGH";
    case "NORMAL":
      return "MEDIUM";
    case "LOW":
      return "LOW";
    default:
      return "MEDIUM";
  }
}
