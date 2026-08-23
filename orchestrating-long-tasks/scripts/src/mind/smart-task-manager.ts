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
  | "external_intake"
  | "plan_enhancement";

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
  readonly assigned_tier?:
    | "Tier_0_Mind"
    | "Tier_1_Orchestrator"
    | "Tier_2_Coordinator"
    | "Tier_3_Implementer"
    | "Tier_3_Validator"
    | undefined;
  readonly assigned_role?: string | undefined;
  readonly assigned_implementer?: string | undefined;
  readonly assigned_validator?: string | undefined;
  readonly feedback_id?: string | undefined;
  readonly candidate_id?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface AntiBatchingValidationReport {
  readonly compliant: boolean;
  readonly violations: readonly string[];
  readonly total_tasks: number;
  readonly isolated_task_count: number;
}

export interface SmartTaskSynthesisResult {
  readonly mode: "feedback_intake" | "self_evolution" | "external_intake" | "queue_active";
  readonly tasks: readonly SmartTaskPlan[];
  readonly summary: string;
  readonly source_items_count: number;
  readonly enqueued_count?: number | undefined;
  readonly anti_batching_enforced?: boolean | undefined;
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

export interface ScopeCollision {
  readonly scope: string;
  readonly task_ids: readonly string[];
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
 * Validates that all task plans strictly comply with the Anti-Batching Rule:
 * 1. No task merges multiple disparate feedback items or candidate directives.
 * 2. Every task has an independent, non-empty write scope.
 * 3. Every task has a dedicated Implementer and an independent Validator (1:1 isolation; no self-validation).
 */
export function validateAntiBatchingRule(
  plans: readonly SmartTaskPlan[],
): AntiBatchingValidationReport {
  const violations: string[] = [];
  let isolatedCount = 0;
  const seenTaskIds = new Set<string>();

  for (const plan of plans) {
    let planCompliant = true;

    // Check duplicate task IDs if ID is non-empty
    if (plan.id && plan.id.trim()) {
      if (seenTaskIds.has(plan.id.trim())) {
        violations.push(`Duplicate task ID '${plan.id}' detected in plan set.`);
        planCompliant = false;
      } else {
        seenTaskIds.add(plan.id.trim());
      }
    }

    // 1. Reject merged multi-item tasks
    const metadata = plan.metadata ?? {};
    const batchedFeedback = metadata["batched_feedback_ids"] ?? metadata["feedback_ids"];
    const batchedCandidates = metadata["batched_candidate_ids"] ?? metadata["candidate_ids"];

    if (Array.isArray(batchedFeedback) && batchedFeedback.length > 1) {
      violations.push(
        `Task '${plan.id}' illegally merges multiple feedback items ([${batchedFeedback.join(", ")}]) into a single task node.`,
      );
      planCompliant = false;
    }

    if (Array.isArray(batchedCandidates) && batchedCandidates.length > 1) {
      violations.push(
        `Task '${plan.id}' illegally merges multiple defect candidates ([${batchedCandidates.join(", ")}]) into a single task node.`,
      );
      planCompliant = false;
    }

    if (
      typeof plan.feedback_id === "string" &&
      (plan.feedback_id.includes(",") || plan.feedback_id.includes(";"))
    ) {
      violations.push(
        `Task '${plan.id}' declares multi-item feedback_id '${plan.feedback_id}', violating 1:1 partitioning.`,
      );
      planCompliant = false;
    }

    if (
      typeof plan.candidate_id === "string" &&
      (plan.candidate_id.includes(",") || plan.candidate_id.includes(";"))
    ) {
      violations.push(
        `Task '${plan.id}' declares multi-item candidate_id '${plan.candidate_id}', violating 1:1 partitioning.`,
      );
      planCompliant = false;
    }

    const lowerLabel = (plan.label ?? "").toLowerCase();
    const lowerRationale = (plan.rationale ?? "").toLowerCase();
    if (
      lowerLabel.includes("[batch") ||
      lowerLabel.includes("[multi-item") ||
      lowerRationale.includes("[batch") ||
      lowerRationale.includes("[multi-item")
    ) {
      violations.push(
        `Task '${plan.id}' title indicates batched execution '${plan.label}', which violates the anti-batching invariant.`,
      );
      planCompliant = false;
    }

    // 2. Reject empty or invalid write scopes
    if (!plan.write_scope || plan.write_scope.length === 0) {
      violations.push(
        `Task '${plan.id}' has empty write scope, violating independent file isolation.`,
      );
      planCompliant = false;
    } else {
      const hasEmptyScopeEntry = plan.write_scope.some((s) => !s || !s.trim());
      if (hasEmptyScopeEntry) {
        violations.push(`Task '${plan.id}' contains empty string entry in write scope.`);
        planCompliant = false;
      }
    }

    // 3. Enforce 1:1 Implementer & independent Validator isolation
    const impl =
      plan.assigned_implementer ??
      (typeof metadata["assigned_implementer"] === "string"
        ? metadata["assigned_implementer"]
        : undefined);
    const val =
      plan.assigned_validator ??
      (typeof metadata["assigned_validator"] === "string"
        ? metadata["assigned_validator"]
        : undefined);

    if (!impl || !impl.trim()) {
      violations.push(`Task '${plan.id}' is missing a dedicated Implementer assignment.`);
      planCompliant = false;
    }

    if (!val || !val.trim()) {
      violations.push(`Task '${plan.id}' is missing an independent Validator assignment.`);
      planCompliant = false;
    }

    if (impl && val && impl.trim().toLowerCase() === val.trim().toLowerCase()) {
      violations.push(
        `Task '${plan.id}' violates 1:1 isolation: implementer '${impl}' cannot act as independent validator for its own task.`,
      );
      planCompliant = false;
    }

    if (planCompliant) {
      isolatedCount += 1;
    }
  }

  return {
    compliant: violations.length === 0,
    violations,
    total_tasks: plans.length,
    isolated_task_count: isolatedCount,
  };
}

/**
 * Alias for validateAntiBatchingRule for backward compatibility.
 */
export function validateAntiBatchingIsolation(
  plans: readonly SmartTaskPlan[],
): AntiBatchingValidationReport {
  return validateAntiBatchingRule(plans);
}

/**
 * Asserts strict Anti-Batching Rule compliance, throwing HarnessError if violations occur.
 */
export function assertAntiBatchingRule(plans: readonly SmartTaskPlan[]): void {
  const report = validateAntiBatchingRule(plans);
  if (!report.compliant) {
    throw new HarnessError(
      "INTEGRITY",
      `Anti-Batching Rule violation: ${report.violations.join("; ")}`,
    );
  }
}

/**
 * Strictly partitions grouped feedback items into 1:1 isolated task nodes.
 */
export function partitionGroupedFeedbacksStrictly(
  feedbacks: readonly FeedbackItem[],
  options: {
    readonly charterGoals?: readonly string[] | undefined;
    readonly baseIdPrefix?: string | undefined;
    readonly autoEnqueue?: boolean | undefined;
    readonly queuePath?: string | undefined;
  } = {},
): readonly SmartTaskPlan[] {
  const prefix = options.baseIdPrefix ?? "task";
  const tasks: SmartTaskPlan[] = [];
  const seenScopes = new Set<string>();

  for (let i = 0; i < feedbacks.length; i++) {
    const fb = feedbacks[i]!;
    const slug = sanitizeSlug(fb.id);
    const scope = deriveWriteScopeForCategory(fb.category, fb.id);
    const gate = deriveGateForCategory(fb.category, scope);
    const priority = mapFeedbackPriorityToTaskPriority(fb.priority);
    const taskId = `${prefix}-${i + 1}-${slug}`;

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
      charter_goals:
        options.charterGoals && options.charterGoals.length > 0 ? options.charterGoals : ["G1"],
      acceptance_criteria: [
        `Strictly isolate and satisfy feedback item: ${fb.title}`,
        `Pass mandatory gate: ${gate}`,
        "Enforce 1:1 Implementer-Validator isolation (0 any, 0 suppressions)",
      ],
      dependencies,
      source_type: "feedback_intake",
      priority,
      rationale: `Partitioned 1:1 from feedback item [${fb.id}]: ${fb.content.slice(0, 150)}`,
      assigned_tier: "Tier_2_Coordinator",
      assigned_implementer: `implementer-${slug}`,
      assigned_validator: `validator-${slug}`,
      feedback_id: fb.id,
      metadata: {
        feedback_id: fb.id,
        assigned_implementer: `implementer-${slug}`,
        assigned_validator: `validator-${slug}`,
      },
    });
  }

  assertAntiBatchingRule(tasks);

  if (options.autoEnqueue && tasks.length > 0) {
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
      assigned_tier: t.assigned_tier,
      assigned_role: t.assigned_role,
      metadata: t.metadata,
    }));
    enqueueTasksBatch(batchInputs, options.queuePath);
  }

  return tasks;
}

/**
 * Strictly partitions defect candidates / directives into 1:1 isolated task nodes.
 */
export function partitionCandidatesStrictly(
  candidates: readonly {
    readonly id: string;
    readonly title?: string | undefined;
    readonly statement?: string | undefined;
    readonly category?: string | undefined;
    readonly write_scope?: readonly string[] | undefined;
    readonly gate?: string | undefined;
    readonly priority?: TaskPriority | undefined;
  }[],
  options: {
    readonly charterGoals?: readonly string[] | undefined;
    readonly baseIdPrefix?: string | undefined;
  } = {},
): readonly SmartTaskPlan[] {
  const prefix = options.baseIdPrefix ?? "candidate-task";
  const tasks: SmartTaskPlan[] = [];
  const seenScopes = new Set<string>();

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i]!;
    const slug = sanitizeSlug(cand.id);
    const label = cand.title ?? cand.statement ?? `Defect Candidate ${cand.id}`;
    const category = cand.category ?? "CORE_ENGINE";
    const scope =
      cand.write_scope && cand.write_scope.length > 0
        ? cand.write_scope
        : deriveWriteScopeForCategory(category, cand.id);
    const gate = cand.gate ?? deriveGateForCategory(category, scope);
    const taskId = `${prefix}-${i + 1}-${slug}`;

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
      label,
      write_scope: scope,
      gate,
      charter_goals:
        options.charterGoals && options.charterGoals.length > 0 ? options.charterGoals : ["G1"],
      acceptance_criteria: [
        `Strictly isolate and satisfy candidate: ${label}`,
        `Pass gate: ${gate}`,
        "Enforce 1:1 implementer-validator isolation",
      ],
      dependencies,
      source_type: "plan_enhancement",
      priority: cand.priority ?? "HIGH",
      rationale: `Partitioned 1:1 from defect candidate [${cand.id}]`,
      assigned_tier: "Tier_3_Implementer",
      assigned_implementer: `implementer-${slug}`,
      assigned_validator: `validator-${slug}`,
      candidate_id: cand.id,
      metadata: {
        candidate_id: cand.id,
        assigned_implementer: `implementer-${slug}`,
        assigned_validator: `validator-${slug}`,
      },
    });
  }

  assertAntiBatchingRule(tasks);
  return tasks;
}

/**
 * Normalizes a scope path for comparison (handling trailing slashes and relative prefixes).
 */
function normalizeScopePath(path: string): string {
  let p = path.trim().replace(/^\.\//, "");
  while (p.endsWith("/") && p.length > 1) {
    p = p.slice(0, -1);
  }
  return p;
}

/**
 * Checks whether two individual write scope paths overlap or contain each other.
 */
function pathsOverlap(p1: string, p2: string): boolean {
  const norm1 = normalizeScopePath(p1);
  const norm2 = normalizeScopePath(p2);

  if (norm1 === norm2) {
    return true;
  }

  if (norm1.startsWith(norm2 + "/") || norm2.startsWith(norm1 + "/")) {
    return true;
  }

  return false;
}

/**
 * Detects whether two sets of write scopes have any overlapping files or directories.
 * Returns the list of overlapping paths.
 */
export function detectScopeOverlap(
  scopeA: readonly string[],
  scopeB: readonly string[],
): readonly string[] {
  const overlaps: string[] = [];
  for (const a of scopeA) {
    for (const b of scopeB) {
      if (pathsOverlap(a, b)) {
        overlaps.push(a === b ? a : `${a} <-> ${b}`);
      }
    }
  }
  return overlaps;
}

/**
 * Calculates all scope collisions across a set of task plans.
 */
export function calculateScopeCollisions(
  plans: readonly SmartTaskPlan[],
): readonly ScopeCollision[] {
  const collisionMap = new Map<string, Set<string>>();

  for (let i = 0; i < plans.length; i++) {
    const planA = plans[i]!;
    for (const scopeA of planA.write_scope) {
      const normA = normalizeScopePath(scopeA);

      for (let j = 0; j < plans.length; j++) {
        const planB = plans[j]!;
        for (const scopeB of planB.write_scope) {
          if (pathsOverlap(normA, scopeB)) {
            const list = collisionMap.get(normA) ?? new Set<string>();
            list.add(planA.id);
            list.add(planB.id);
            collisionMap.set(normA, list);
          }
        }
      }
    }
  }

  const collisions: ScopeCollision[] = [];
  for (const [scope, taskSet] of collisionMap.entries()) {
    if (taskSet.size > 1) {
      collisions.push({
        scope,
        task_ids: Array.from(taskSet).sort(),
      });
    }
  }

  return collisions;
}

/**
 * Detects write scope collisions among a set of task plans (alias to calculateScopeCollisions).
 */
export function detectScopeCollisions(plans: readonly SmartTaskPlan[]): readonly ScopeCollision[] {
  return calculateScopeCollisions(plans);
}

/**
 * Plans robust wave execution for a set of smart task plans:
 * 1. Checks DAG acyclicity (detects circular dependencies).
 * 2. Partitions into dependency depth levels.
 * 3. Resolves intra-depth scope collisions into disjoint sub-waves.
 */
export function planWaveExecution(tasks: readonly SmartTaskPlan[]): SmartWavePlanResult {
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

  // Compute depth for each task based on dependencies, checking for cycles
  const depthMap = new Map<string, number>();

  function getDepth(taskId: string, visiting: Set<string>): number {
    if (depthMap.has(taskId)) {
      return depthMap.get(taskId)!;
    }
    if (visiting.has(taskId)) {
      throw new HarnessError(
        "INTEGRITY",
        `Circular dependency detected involving task '${taskId}'`,
      );
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

  // Group tasks by dependency depth
  const depthWaveMap = new Map<number, SmartTaskPlan[]>();
  for (const task of tasks) {
    const depth = depthMap.get(task.id) ?? 1;
    const list = depthWaveMap.get(depth) ?? [];
    list.push(task);
    depthWaveMap.set(depth, list);
  }

  const sortedDepths = [...depthWaveMap.keys()].sort((a, b) => a - b);
  const finalWaves: WaveGroup[] = [];
  let waveIndex = 1;

  for (const depth of sortedDepths) {
    const depthTasks = depthWaveMap.get(depth)!;
    const subWaves: SmartTaskPlan[][] = [];

    for (const task of depthTasks) {
      let placed = false;
      for (const bucket of subWaves) {
        const hasCollision = bucket.some((existing) =>
          existing.write_scope.some((s) => task.write_scope.some((ts) => pathsOverlap(s, ts))),
        );
        if (!hasCollision) {
          bucket.push(task);
          placed = true;
          break;
        }
      }
      if (!placed) {
        subWaves.push([task]);
      }
    }

    for (const bucket of subWaves) {
      finalWaves.push({
        wave_number: waveIndex++,
        task_ids: bucket.map((t) => t.id),
        tasks: bucket,
      });
    }
  }

  return {
    total_waves: finalWaves.length,
    total_tasks: tasks.length,
    waves: finalWaves,
  };
}

/**
 * Compiles an array of SmartTaskPlans into ordered execution waves with disjoint write scopes.
 */
export function compileSmartTasksToWavePlan(tasks: readonly SmartTaskPlan[]): SmartWavePlanResult {
  return planWaveExecution(tasks);
}

/**
 * Partitions tasks into strictly disjoint waves (alias to planWaveExecution).
 */
export function partitionIntoDisjointWaves(tasks: readonly SmartTaskPlan[]): SmartWavePlanResult {
  return planWaveExecution(tasks);
}

/**
 * Synthesizes 1:1 isolated smart tasks from pending items in the feedback queue (Mode B External Intake).
 */
export function synthesizeSmartTasksFromFeedbackQueue(
  options: {
    readonly capsulesDir?: string | undefined;
    readonly queuePath?: string | undefined;
    readonly charterGoals?: readonly string[] | undefined;
    readonly maxTasks?: number | undefined;
    readonly autoEnqueue?: boolean | undefined;
  } = {},
): SmartTaskSynthesisResult {
  const maxTasks = options.maxTasks ?? 5;
  const feedbackItems = readFeedbackQueue(options.capsulesDir);
  const pendingFeedback = feedbackItems.filter((f) => f.status === "PENDING");

  if (pendingFeedback.length === 0) {
    return {
      mode: "feedback_intake",
      tasks: [],
      summary: "No pending feedback items in queue.",
      source_items_count: 0,
      anti_batching_enforced: true,
      enqueued_count: 0,
    };
  }

  const selected = pendingFeedback.slice(0, maxTasks);
  const tasks: SmartTaskPlan[] = [];
  const seenScopes = new Set<string>();

  for (let i = 0; i < selected.length; i++) {
    const fb = selected[i]!;
    const slug = sanitizeSlug(fb.id);
    const scope = deriveWriteScopeForCategory(fb.category, fb.id);
    const gate = deriveGateForCategory(fb.category, scope);
    const priority = mapFeedbackPriorityToTaskPriority(fb.priority);
    const taskId = `task-${i + 1}-${slug}`;

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
      charter_goals:
        options.charterGoals && options.charterGoals.length > 0
          ? [options.charterGoals[0]!]
          : ["G1"],
      acceptance_criteria: [
        `Satisfy user directive/feedback: ${fb.title}`,
        `Pass mandatory gate: ${gate}`,
        "Enforce 0 TypeScript any and 0 compiler/linter suppressions",
      ],
      dependencies,
      source_type: "feedback_intake",
      priority,
      rationale: `Ingested from feedback queue [${fb.priority}]: ${fb.content.slice(0, 150)}`,
      assigned_tier: "Tier_2_Coordinator",
      assigned_implementer: `implementer-${slug}`,
      assigned_validator: `validator-${slug}`,
      feedback_id: fb.id,
      metadata: {
        feedback_id: fb.id,
        assigned_implementer: `implementer-${slug}`,
        assigned_validator: `validator-${slug}`,
      },
    });
  }

  assertAntiBatchingRule(tasks);

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
      assigned_tier: t.assigned_tier,
      assigned_role: t.assigned_role,
      metadata: t.metadata,
    }));
    const enqueued = enqueueTasksBatch(batchInputs, options.queuePath);
    enqueuedCount = enqueued.length;

    // Drain and mark pending feedbacks as ADMITTED
    drainPendingFeedbacks({ markAs: "ADMITTED", limit: selected.length }, options.capsulesDir);
  }

  return {
    mode: "feedback_intake",
    tasks,
    summary: `Synthesized ${tasks.length} isolated task(s) from pending user feedback queue with 1:1 implementer-validator mapping.`,
    source_items_count: pendingFeedback.length,
    anti_batching_enforced: true,
    ...(enqueuedCount > 0 ? { enqueued_count: enqueuedCount } : {}),
  };
}

/**
 * Synthesizes self-evolution smart tasks from open blunder logs and continuous invariant hardening (Mode A).
 */
export function synthesizeSmartTasksFromSelfEvolution(
  options: {
    readonly capsulesDir?: string | undefined;
    readonly queuePath?: string | undefined;
    readonly charterGoals?: readonly string[] | undefined;
    readonly maxTasks?: number | undefined;
    readonly autoEnqueue?: boolean | undefined;
  } = {},
): SmartTaskSynthesisResult {
  const maxTasks = options.maxTasks ?? 5;
  const targetRoots = options.capsulesDir ? [options.capsulesDir] : [".capsules/"];
  const blunderAudit = auditBlunderLog(targetRoots);
  const openBlunders = blunderAudit.blunders.filter((b) => b.status === "open");

  const selfTasks: SmartTaskPlan[] = [];

  if (openBlunders.length > 0) {
    const blunder = openBlunders[0]!;
    const blunderSlug = sanitizeSlug(blunder.id);
    const blunderScope = deriveWriteScopeForCategory("CORE_ENGINE", blunder.id);
    const blunderGate = deriveGateForCategory("CORE_ENGINE", blunderScope);

    selfTasks.push({
      id: `task-1-blunder-${blunderSlug}`,
      label: `Automated Blunder Remediation (${blunder.category})`,
      write_scope: blunderScope,
      gate: blunderGate,
      charter_goals:
        options.charterGoals && options.charterGoals.length > 0
          ? [options.charterGoals[0]!]
          : ["G2"],
      acceptance_criteria: [
        `Remediate open blunder ${blunder.id}: ${blunder.observation.slice(0, 100)}`,
        `Pass gate: ${blunderGate}`,
        "Verify regression immunity in unit test suite",
      ],
      dependencies: [],
      source_type: "blunder_remediation",
      priority: "CRITICAL",
      rationale: `Autonomous remediation for open blunder ${blunder.id}: ${blunder.observation}`,
      assigned_tier: "Tier_3_Implementer",
      assigned_implementer: `implementer-blunder-${blunderSlug}`,
      assigned_validator: `validator-blunder-${blunderSlug}`,
      candidate_id: blunder.id,
      metadata: {
        candidate_id: blunder.id,
        assigned_implementer: `implementer-blunder-${blunderSlug}`,
        assigned_validator: `validator-blunder-${blunderSlug}`,
      },
    });
  }

  // Invariant hardening task
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
    charter_goals:
      options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G1"],
    acceptance_criteria: [
      "0 TypeScript any across all modules",
      "0 compiler or linter suppressions",
      "All unit tests pass with exit code 0",
    ],
    dependencies: selfTasks.length > 0 ? [selfTasks[0]!.id] : [],
    source_type: "self_evolution",
    priority: "HIGH",
    rationale:
      "Continuous invariant hardening maintaining zero compiler suppressions and deterministic typed schemas.",
    assigned_tier: "Tier_3_Implementer",
    assigned_implementer: "implementer-invariant-hardening",
    assigned_validator: "validator-invariant-hardening",
    metadata: {
      assigned_implementer: "implementer-invariant-hardening",
      assigned_validator: "validator-invariant-hardening",
    },
  });

  // Autonomic continuous optimization task
  selfTasks.push({
    id: `task-${selfTasks.length + 1}-autonomic-optimization`,
    label: "Continuous Architecture & Invariant Hardening",
    write_scope: ["orchestrating-long-tasks/scripts/src/mind/", "tests/unit/mind/"],
    gate: "bun test tests/unit/mind && bun run typecheck",
    charter_goals:
      options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G3"],
    acceptance_criteria: [
      "Autonomic self-evolution cycle maintaining loop cadence and clean metrics",
      "Pass all mind unit tests cleanly",
    ],
    dependencies: [selfTasks[selfTasks.length - 1]!.id],
    source_type: "self_evolution",
    priority: "MEDIUM",
    rationale:
      "Autonomic self-evolution cycle maintaining 0 any, 0 suppressions, and continuous loop cadence.",
    assigned_tier: "Tier_1_Orchestrator",
    assigned_implementer: "implementer-autonomic-optimization",
    assigned_validator: "validator-autonomic-optimization",
    metadata: {
      assigned_implementer: "implementer-autonomic-optimization",
      assigned_validator: "validator-autonomic-optimization",
    },
  });

  const selectedSelfTasks = selfTasks.slice(0, maxTasks);
  assertAntiBatchingRule(selectedSelfTasks);

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
      assigned_tier: t.assigned_tier,
      assigned_role: t.assigned_role,
      metadata: t.metadata,
    }));
    const enqueued = enqueueTasksBatch(batchInputs, options.queuePath);
    enqueuedCount = enqueued.length;
  }

  return {
    mode: "self_evolution",
    tasks: selectedSelfTasks,
    summary: `Autonomous self-evolution synthesized ${selectedSelfTasks.length} isolated task(s) on empty queue with 1:1 implementer-validator mapping.`,
    source_items_count: openBlunders.length,
    anti_batching_enforced: true,
    ...(enqueuedCount > 0 ? { enqueued_count: enqueuedCount } : {}),
  };
}

/**
 * Autonomous Task Synthesizer implementing Dual-Intake:
 * - Mode A: Empty queue -> Autonomous Self-Evolution
 * - Mode B: Pending items -> Feedback / External Directive Expansion
 */
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

/**
 * Runs a full Autonomous Dual-Intake Cycle:
 * - Checks queue state.
 * - If pending feedback exists, runs Mode B external intake and auto-enqueues.
 * - If queue is idle/empty, runs Mode A self-evolution synthesis and auto-enqueues.
 * - If queue has active tasks, reports current active status.
 */
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

  // Mode B: External Intake from pending feedback
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

  // If queue is completely idle (0 active tasks), run Mode A Self-Evolution
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

/**
 * Runs a full Autonomous Dual-Intake Cycle (alias to processAutonomousDualIntake).
 */
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
      : ["orchestrating-long-tasks/scripts/src/", "tests/unit/"];

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

  assertAntiBatchingRule([plan]);
  return plan;
}

/**
 * General Plan Enhancer function: transforms raw prompt or FeedbackItem into a structured SmartTaskPlan.
 */
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

  assertAntiBatchingRule([plan]);
  return plan;
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

  const prefix = typeof options.baseIdPrefix === "string" ? options.baseIdPrefix : "wave-task";
  const goals =
    options.charterGoals && options.charterGoals.length > 0 ? options.charterGoals : ["G1"];

  const tasks: SmartTaskPlan[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const slug = sanitizeSlug(line.slice(0, 25));
    const id = `${prefix}-${i + 1}-${slug}`;
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
      acceptance_criteria: [`Complete wave subtask: ${line}`, `Verify gate: ${gate}`],
      dependencies,
      source_type: "external_intake",
      priority: "HIGH",
      rationale: `Expanded step ${i + 1} from multi-step prompt: ${line}`,
      assigned_tier: "Tier_3_Implementer",
      assigned_implementer: `implementer-wave-step-${i + 1}`,
      assigned_validator: `validator-wave-step-${i + 1}`,
      metadata: {
        assigned_implementer: `implementer-wave-step-${i + 1}`,
        assigned_validator: `validator-wave-step-${i + 1}`,
      },
    });
  }

  return planWaveExecution(tasks);
}

/**
 * Plan enhancer that converts feedback items or multi-step prompt into disjoint wave plans.
 */
export function planEnhanceToWavePlan(
  promptOrFeedbacks: string | readonly FeedbackItem[],
  options: {
    readonly charterGoals?: readonly string[] | undefined;
    readonly baseIdPrefix?: string | undefined;
  } = {},
): SmartWavePlanResult {
  if (typeof promptOrFeedbacks === "string") {
    return expandExternalPromptToWavePlan(promptOrFeedbacks, options);
  }

  const prefix = typeof options.baseIdPrefix === "string" ? options.baseIdPrefix : "fb-wave";
  const tasks: SmartTaskPlan[] = [];
  const seenScopes = new Set<string>();

  for (let i = 0; i < promptOrFeedbacks.length; i++) {
    const fb = promptOrFeedbacks[i]!;
    const basePlan = planEnhance(fb, {
      charterGoals: options.charterGoals,
      baseId: `${prefix}-${i + 1}-${sanitizeSlug(fb.id)}`,
    });

    const dependencies: string[] = [];
    for (const s of basePlan.write_scope) {
      if (seenScopes.has(s) && i > 0) {
        dependencies.push(tasks[i - 1]!.id);
        break;
      }
      seenScopes.add(s);
    }

    tasks.push({
      ...basePlan,
      dependencies,
    });
  }

  return planWaveExecution(tasks);
}

export function deriveWriteScopeForCategory(category: string, id: string): readonly string[] {
  const slug = sanitizeSlug(id);
  switch (category) {
    case "DOCUMENTATION":
      return ["docs/", "orchestrating-long-tasks/references/"];
    case "AGENT_CONTRACTS":
      return [
        "orchestrating-long-tasks/agents/",
        "orchestrating-long-tasks/roles/",
        "orchestrating-long-tasks/references/",
      ];
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
  return val
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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
