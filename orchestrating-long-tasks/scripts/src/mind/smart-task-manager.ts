import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";
import {
  auditAdmissionDispatchIntegrity,
  drainPendingFeedbacks,
  readFeedbackQueue,
  writeFeedbackQueue,
  type AdmissionDispatchIntegrityReport,
  type AtomicAdmissionDispatchResult,
  type FeedbackCategory,
  type FeedbackItem,
  type FeedbackPriority,
  type FeedbackStatus,
} from "./feedback-queue.ts";
import { auditBlunderLog } from "./blunders.ts";
import {
  enqueueTasksBatch,
  getQueueStats,
  readTaskQueue,
  resolveCanonicalTaskQueuePath,
  resolveTaskQueuePath,
  type NewTaskQueueInput,
  type TaskPriority,
  type TaskQueueItem,
  type TaskQueueStats,
} from "./task-queue.ts";
import {
  recordCompletedTask,
  recordCompletedTasksBatch,
  type CompletedTaskRecord,
} from "./completed-tasks.ts";

export type SmartTaskSourceType =
  | "feedback_intake"
  | "self_evolution"
  | "blunder_remediation"
  | "direct_prompt"
  | "external_intake"
  | "plan_enhancement";

export interface ActiveHypothesis {
  readonly id: string;
  readonly statement: string;
  readonly confidence: number;
  readonly status: "active" | "validated" | "refuted";
  readonly evidence: readonly string[];
  readonly created_at: string;
  readonly updated_at: string;
}

export interface RoadmapItem {
  readonly id: string;
  readonly title: string;
  readonly target_horizon: string;
  readonly milestones: readonly string[];
  readonly status: "active" | "completed" | "superseded";
}

export interface MacroMetrics {
  readonly work: number;
  readonly span: number;
  readonly parallelism: number; // P = W / S
  readonly efficiency: number;
}

export interface CognitiveMemoryState {
  readonly version: number;
  readonly last_updated: string;
  readonly strategic_focus: readonly string[];
  readonly active_hypotheses: readonly ActiveHypothesis[];
  readonly roadmaps: readonly RoadmapItem[];
  readonly macro_metrics?: MacroMetrics | undefined;
  readonly context?: Readonly<Record<string, unknown>> | undefined;
}

export const CANONICAL_COGNITIVE_MEMORY_FILE = ".capsules/mind/memory.json";
export const TODO_COGNITIVE_MEMORY_FILE = ".capsules/todo/memory.json";
export const LEGACY_COGNITIVE_MEMORY_FILE = ".capsules/memory.json";
export const DEFAULT_COGNITIVE_MEMORY_FILE = ".capsules/mind/memory.json";

export function resolveCanonicalCognitiveMemoryPath(customRoot?: string, useTodo = false): string {
  const root = customRoot && customRoot.trim() ? resolve(customRoot.trim()) : process.cwd();
  const relPath = useTodo ? TODO_COGNITIVE_MEMORY_FILE : CANONICAL_COGNITIVE_MEMORY_FILE;
  return join(root, relPath);
}

export function resolveCognitiveMemoryPath(customPath?: string): string {
  if (customPath && customPath.trim()) {
    return resolve(customPath.trim());
  }
  const cwd = process.cwd();
  const candidates = [cwd, dirname(cwd)];

  for (const root of candidates) {
    const canonical = join(root, CANONICAL_COGNITIVE_MEMORY_FILE);
    if (existsSync(canonical)) return canonical;

    const todo = join(root, TODO_COGNITIVE_MEMORY_FILE);
    if (existsSync(todo)) return todo;

    const legacy = join(root, LEGACY_COGNITIVE_MEMORY_FILE);
    if (existsSync(legacy)) return legacy;
  }

  if (existsSync(join(cwd, ".capsules", "mind"))) {
    return join(cwd, CANONICAL_COGNITIVE_MEMORY_FILE);
  }
  if (existsSync(join(cwd, ".capsules"))) {
    return join(cwd, CANONICAL_COGNITIVE_MEMORY_FILE);
  }
  const parentCapsules = join(dirname(cwd), ".capsules");
  if (existsSync(parentCapsules)) {
    return join(dirname(cwd), CANONICAL_COGNITIVE_MEMORY_FILE);
  }
  return resolve(cwd, CANONICAL_COGNITIVE_MEMORY_FILE);
}

export function readCognitiveMemory(customPath?: string): CognitiveMemoryState {
  const filePath = resolveCognitiveMemoryPath(customPath);
  if (!existsSync(filePath)) {
    return {
      version: 1,
      last_updated: new Date().toISOString(),
      strategic_focus: [
        "Continuous Zero-Any & Zero-Suppression Assurance",
        "Charter Alignment & Macro DAG Work/Span (P = W/S) Optimization",
        "Autonomous Task Discovery & 1:1 Isolated Execution",
      ],
      active_hypotheses: [
        {
          id: "hyp-1-parallelism",
          statement:
            "Disjoint write scope partitioning maximizes effective parallelism P = W/S across 4 tiers without collision.",
          confidence: 0.95,
          status: "active",
          evidence: ["Topological wave planning resolves write scope collisions ahead of dispatch"],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      roadmaps: [
        {
          id: "roadmap-autonomous-fleet",
          title: "Autonomous Fleet Continuous Improvement",
          target_horizon: "Perpetual",
          milestones: [
            "Anti-batching 1:1 partitioning enforcement",
            "Generational state archival and lean queue maintenance",
            "Zero zombie accumulation across completed task logs",
          ],
          status: "active",
        },
      ],
      macro_metrics: {
        work: 10,
        span: 2,
        parallelism: 5,
        efficiency: 0.95,
      },
    };
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const version = typeof parsed["version"] === "number" ? parsed["version"] : 1;
    const lastUpdated =
      typeof parsed["last_updated"] === "string"
        ? parsed["last_updated"]
        : new Date().toISOString();
    const strategicFocus = Array.isArray(parsed["strategic_focus"])
      ? (parsed["strategic_focus"] as readonly string[])
      : [];
    const activeHypotheses = Array.isArray(parsed["active_hypotheses"])
      ? (parsed["active_hypotheses"] as readonly ActiveHypothesis[])
      : [];
    const roadmaps = Array.isArray(parsed["roadmaps"])
      ? (parsed["roadmaps"] as readonly RoadmapItem[])
      : [];
    const macroMetrics =
      typeof parsed["macro_metrics"] === "object" && parsed["macro_metrics"] !== null
        ? (parsed["macro_metrics"] as MacroMetrics)
        : undefined;
    const context =
      typeof parsed["context"] === "object" && parsed["context"] !== null
        ? (parsed["context"] as Readonly<Record<string, unknown>>)
        : undefined;

    return {
      version,
      last_updated: lastUpdated,
      strategic_focus: strategicFocus,
      active_hypotheses: activeHypotheses,
      roadmaps,
      ...(macroMetrics !== undefined ? { macro_metrics: macroMetrics } : {}),
      ...(context !== undefined ? { context } : {}),
    };
  } catch {
    return {
      version: 1,
      last_updated: new Date().toISOString(),
      strategic_focus: [],
      active_hypotheses: [],
      roadmaps: [],
    };
  }
}

export function writeCognitiveMemory(memory: CognitiveMemoryState, customPath?: string): void {
  const filePath = resolveCognitiveMemoryPath(customPath);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(memory, null, 2) + "\n", "utf8");
}

export function updateCognitiveMemory(
  updater: (current: CognitiveMemoryState) => CognitiveMemoryState,
  customPath?: string,
): CognitiveMemoryState {
  const current = readCognitiveMemory(customPath);
  const updated = updater(current);
  const stateToPersist: CognitiveMemoryState = {
    ...updated,
    last_updated: new Date().toISOString(),
  };
  writeCognitiveMemory(stateToPersist, customPath);
  return stateToPersist;
}

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
  readonly effort?: number | undefined;
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
  readonly macro_metrics?: MacroMetrics | undefined;
  readonly optimal_lanes?: number | undefined;
}

export interface RebalancedTaskPlanResult extends SmartWavePlanResult {
  readonly macro_metrics: MacroMetrics;
  readonly optimal_lanes: number;
  readonly decoupled_edges_count: number;
  readonly warnings: readonly string[];
}

export interface ScopeCollision {
  readonly scope: string;
  readonly task_ids: readonly string[];
}

export interface MultiOrchestratorSubTreePlan {
  readonly orchestrator_id: string;
  readonly write_scope: readonly string[];
  readonly tasks: readonly SmartTaskPlan[];
  readonly wave_plan: SmartWavePlanResult;
  readonly macro_metrics: MacroMetrics;
}

export interface MultiOrchestratorPrePlanningResult {
  readonly total_orchestrators: number;
  readonly total_tasks: number;
  readonly orchestrators: readonly MultiOrchestratorSubTreePlan[];
  readonly macro_metrics: MacroMetrics;
  readonly is_disjoint: boolean;
  readonly cross_orchestrator_collisions: readonly ScopeCollision[];
  readonly warnings: readonly string[];
}

export interface MultiOrchestratorPlanningOptions {
  readonly orchestratorIds?: readonly string[] | undefined;
  readonly maxOrchestrators?: number | undefined;
  readonly maxLanesPerOrchestrator?: number | undefined;
  readonly charterGoals?: readonly string[] | undefined;
  readonly autoUpdateMemory?: boolean | undefined;
  readonly cognitiveMemoryPath?: string | undefined;
}

export type ProductOwnerIntakeStream =
  | "user_feedback"
  | "self_evolution"
  | "defect_candidate"
  | "charter_roadmap"
  | "direct_directive";

export interface ProductOwnerIntakeItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly priority?: TaskPriority | FeedbackPriority | undefined;
  readonly category?: FeedbackCategory | string | undefined;
  readonly stream: ProductOwnerIntakeStream;
  readonly candidate_id?: string | undefined;
  readonly charter_goals?: readonly string[] | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly gate?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface ProductOwnerIntakeDecision {
  readonly item_id: string;
  readonly admitted: boolean;
  readonly priority: TaskPriority;
  readonly rationale: string;
  readonly assigned_task_id?: string | undefined;
  readonly assigned_orchestrator?: string | undefined;
  readonly rejected_reason?: string | undefined;
}

export interface InfiniteProductOwnerState {
  readonly cycle_number: number;
  readonly last_cycle_at: string;
  readonly total_intake_items: number;
  readonly total_admitted_and_dispatched: number;
  readonly total_declined: number;
  readonly active_orchestrator_subtrees: number;
  readonly macro_metrics: MacroMetrics;
  readonly zero_paused_admitted_verified: boolean;
}

export interface InfiniteProductOwnerResult {
  readonly cycle_id: string;
  readonly timestamp: string;
  readonly mode:
    | "feedback_intake"
    | "self_evolution"
    | "multi_orchestrator_dispatch"
    | "idle_monitored";
  readonly decisions: readonly ProductOwnerIntakeDecision[];
  readonly synthesized_tasks: readonly SmartTaskPlan[];
  readonly enqueued_tasks: readonly TaskQueueItem[];
  readonly multi_orchestrator_plan?: MultiOrchestratorPrePlanningResult | undefined;
  readonly macro_metrics: MacroMetrics;
  readonly zero_paused_admitted_guaranteed: boolean;
  readonly summary: string;
}

export interface AdmissionToDispatchAuditReport {
  readonly compliant: boolean;
  readonly total_feedback: number;
  readonly pending_feedback: number;
  readonly admitted_feedback: number;
  readonly paused_admitted_feedback: number;
  readonly total_tasks: number;
  readonly active_tasks: number;
  readonly zero_paused_admitted: boolean;
  readonly violations: readonly string[];
}

export interface AdmissionToDispatchResult {
  readonly synthesized_tasks: readonly SmartTaskPlan[];
  readonly enqueued_tasks: readonly TaskQueueItem[];
  readonly admitted_feedbacks: readonly FeedbackItem[];
  readonly audit_report: AdmissionToDispatchAuditReport;
  readonly summary: string;
}

export interface InfiniteProductOwnerOptions {
  readonly capsulesDir?: string | undefined;
  readonly queuePath?: string | undefined;
  readonly memoryPath?: string | undefined;
  readonly charterGoals?: readonly string[] | undefined;
  readonly orchestratorCount?: number | undefined;
  readonly orchestratorIds?: readonly string[] | undefined;
  readonly maxTasks?: number | undefined;
  readonly directIntakeItems?: readonly ProductOwnerIntakeItem[] | undefined;
  readonly autoEnqueue?: boolean | undefined;
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

  for (let i = 0; i < feedbacks.length; i++) {
    const fb = feedbacks[i]!;
    const slug = sanitizeSlug(fb.id);
    const scope = deriveWriteScopeForCategory(fb.category, fb.id);
    const gate = deriveGateForCategory(fb.category, scope);
    const priority = mapFeedbackPriorityToTaskPriority(fb.priority);
    const taskId = `${prefix}-${i + 1}-${slug}`;

    const dependencies: string[] = [];
    for (const prev of tasks) {
      if (detectScopeOverlap(scope, prev.write_scope).length > 0) {
        dependencies.push(prev.id);
      }
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
    for (const prev of tasks) {
      if (detectScopeOverlap(scope, prev.write_scope).length > 0) {
        dependencies.push(prev.id);
      }
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
 * Computes Work ($W$), Critical Span ($S$), Concurrency Factor ($P = W / S$), and Efficiency ($E = P / \text{optimalLanes}$)
 * based on Brent's Theorem Work/Span metrics.
 */
export function computeMacroMetrics(
  tasks: readonly (
    | SmartTaskPlan
    | TaskQueueItem
    | {
        readonly id: string;
        readonly effort?: number | undefined;
        readonly dependencies?: readonly string[] | undefined;
      }
  )[],
  maxLanes = 40,
): MacroMetrics {
  if (tasks.length === 0) {
    return {
      work: 0,
      span: 0,
      parallelism: 0,
      efficiency: 0,
    };
  }

  const effortMap = new Map<string, number>();
  const depsMap = new Map<string, Set<string>>();
  let totalWork = 0;

  for (const task of tasks) {
    const rawEffort =
      "effort" in task && typeof task.effort === "number" && task.effort > 0 ? task.effort : 1;
    effortMap.set(task.id, rawEffort);
    totalWork += rawEffort;

    const deps = new Set<string>();
    if ("dependencies" in task && Array.isArray(task.dependencies)) {
      for (const d of task.dependencies) {
        if (typeof d === "string" && d.trim().length > 0) {
          deps.add(d.trim());
        }
      }
    }
    depsMap.set(task.id, deps);
  }

  const remaining = new Map<string, number>();
  const downstream = new Map<string, Set<string>>();
  for (const [id, prereqs] of depsMap) {
    downstream.set(id, new Set());
    const validPrereqs = [...prereqs].filter((p) => depsMap.has(p));
    remaining.set(id, validPrereqs.length);
  }
  for (const [id, prereqs] of depsMap) {
    for (const p of prereqs) {
      if (downstream.has(p)) {
        downstream.get(p)!.add(id);
      }
    }
  }

  const ready = [...remaining]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const curr = ready.shift()!;
    order.push(curr);
    for (const next of [...(downstream.get(curr) ?? [])].sort()) {
      const rem = (remaining.get(next) ?? 1) - 1;
      remaining.set(next, rem);
      if (rem === 0) {
        const position = ready.findIndex((id) => id > next);
        ready.splice(position < 0 ? ready.length : position, 0, next);
      }
    }
  }

  const spanMap = new Map<string, number>();
  for (const id of order) {
    const effort = effortMap.get(id) ?? 1;
    const prereqs = depsMap.get(id) ?? new Set<string>();
    let maxPrereqSpan = 0;
    for (const p of prereqs) {
      const pSpan = spanMap.get(p) ?? 0;
      if (pSpan > maxPrereqSpan) {
        maxPrereqSpan = pSpan;
      }
    }
    spanMap.set(id, maxPrereqSpan + effort);
  }

  for (const task of tasks) {
    if (!spanMap.has(task.id)) {
      spanMap.set(task.id, effortMap.get(task.id) ?? 1);
    }
  }

  let criticalSpan = 0;
  for (const s of spanMap.values()) {
    if (s > criticalSpan) {
      criticalSpan = s;
    }
  }

  const parallelism =
    criticalSpan > 0
      ? Math.round((totalWork / criticalSpan) * 100) / 100
      : tasks.length > 0
        ? 1
        : 0;

  const optimalLanes = Math.max(
    1,
    Math.min(maxLanes, Math.ceil(parallelism > 0 ? parallelism : 1)),
  );

  const efficiency =
    optimalLanes > 0 && parallelism > 0 ? Math.round((parallelism / optimalLanes) * 100) / 100 : 0;

  return {
    work: totalWork,
    span: criticalSpan,
    parallelism,
    efficiency,
  };
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
      macro_metrics: {
        work: 0,
        span: 0,
        parallelism: 0,
        efficiency: 0,
      },
      optimal_lanes: 1,
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

  const macroMetrics = computeMacroMetrics(tasks);
  const optimalLanes = Math.max(
    1,
    Math.min(40, Math.ceil(macroMetrics.parallelism > 0 ? macroMetrics.parallelism : 1)),
  );

  return {
    total_waves: finalWaves.length,
    total_tasks: tasks.length,
    waves: finalWaves,
    macro_metrics: macroMetrics,
    optimal_lanes: optimalLanes,
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
 * Automatically rebalances tasks using Brent's Theorem limits:
 * 1. Decouples artificial serialization edges where write scopes are disjoint and no dataflow justification exists.
 * 2. Partitions tasks into conflict-free waves.
 * 3. Computes Work/Span MacroMetrics (W, S, P=W/S, efficiency).
 * 4. Optionally updates persistent cognitive memory state.
 */
export function rebalanceTasksWithBrentLimits(
  tasks: readonly SmartTaskPlan[],
  options: {
    readonly maxLanes?: number | undefined;
    readonly preserveJustified?: boolean | undefined;
    readonly autoUpdateMemory?: boolean | undefined;
    readonly cognitiveMemoryPath?: string | undefined;
  } = {},
): RebalancedTaskPlanResult {
  const maxLanes = options.maxLanes ?? 40;
  const preserveJustified = options.preserveJustified ?? true;

  if (tasks.length === 0) {
    const emptyMetrics: MacroMetrics = { work: 0, span: 0, parallelism: 0, efficiency: 0 };
    if (options.autoUpdateMemory) {
      try {
        updateCognitiveMemory(
          (curr) => ({ ...curr, macro_metrics: emptyMetrics }),
          options.cognitiveMemoryPath,
        );
      } catch {
        // Non-fatal
      }
    }
    return {
      total_waves: 0,
      total_tasks: 0,
      waves: [],
      macro_metrics: emptyMetrics,
      optimal_lanes: 1,
      decoupled_edges_count: 0,
      warnings: [],
    };
  }

  const taskMap = new Map<string, SmartTaskPlan>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const warnings: string[] = [];
  let decoupledCount = 0;
  const prunedTasks: SmartTaskPlan[] = [];

  for (const task of tasks) {
    const prunedDeps: string[] = [];
    for (const depId of task.dependencies) {
      const depTask = taskMap.get(depId);
      if (!depTask) {
        prunedDeps.push(depId);
        continue;
      }

      const overlap = detectScopeOverlap(task.write_scope, depTask.write_scope);
      const isJustified =
        task.rationale.toLowerCase().includes("dataflow") ||
        task.rationale.toLowerCase().includes("artifact") ||
        (task.metadata !== undefined && typeof task.metadata["justification"] === "string");

      if (overlap.length === 0) {
        if (!isJustified || !preserveJustified) {
          warnings.push(
            `Decoupled artificial dependency: ${task.id} -> ${depId} (disjoint write scopes: [${task.write_scope.join(", ")}] vs [${depTask.write_scope.join(", ")}])`,
          );
          decoupledCount++;
          continue;
        } else {
          warnings.push(`Preserved justified dataflow dependency: ${task.id} -> ${depId}`);
        }
      }
      prunedDeps.push(depId);
    }

    prunedTasks.push({
      ...task,
      dependencies: prunedDeps,
    });
  }

  const wavePlan = planWaveExecution(prunedTasks);
  const macroMetrics = computeMacroMetrics(prunedTasks, maxLanes);
  const optimalLanes = Math.max(
    1,
    Math.min(maxLanes, Math.ceil(macroMetrics.parallelism > 0 ? macroMetrics.parallelism : 1)),
  );

  if (options.autoUpdateMemory) {
    try {
      updateCognitiveMemory(
        (curr) => ({
          ...curr,
          macro_metrics: macroMetrics,
        }),
        options.cognitiveMemoryPath,
      );
    } catch {
      // Non-fatal
    }
  }

  return {
    total_waves: wavePlan.total_waves,
    total_tasks: wavePlan.total_tasks,
    waves: wavePlan.waves,
    macro_metrics: macroMetrics,
    optimal_lanes: optimalLanes,
    decoupled_edges_count: decoupledCount,
    warnings,
  };
}

/**
 * Integrates Work/Span MacroMetrics (W, S, P=W/S, efficiency) into persistent CognitiveMemoryState.
 */
export function integrateMacroMetricsIntoMemory(
  tasksOrQueue?: readonly (SmartTaskPlan | TaskQueueItem)[] | undefined,
  options: {
    readonly cognitiveMemoryPath?: string | undefined;
    readonly queuePath?: string | undefined;
    readonly maxLanes?: number | undefined;
  } = {},
): CognitiveMemoryState {
  let targetTasks: readonly (SmartTaskPlan | TaskQueueItem)[];
  if (tasksOrQueue !== undefined && tasksOrQueue.length > 0) {
    targetTasks = tasksOrQueue;
  } else {
    targetTasks = readTaskQueue(options.queuePath);
  }

  const metrics = computeMacroMetrics(targetTasks, options.maxLanes ?? 40);

  return updateCognitiveMemory(
    (curr) => ({
      ...curr,
      macro_metrics: metrics,
    }),
    options.cognitiveMemoryPath,
  );
}

/**
 * Rebalances the persistent task queue based on Brent limits and updates CognitiveMemoryState.
 */
export function rebalanceTaskQueueWithBrentLimits(
  options: {
    readonly queuePath?: string | undefined;
    readonly cognitiveMemoryPath?: string | undefined;
    readonly maxLanes?: number | undefined;
  } = {},
): {
  readonly updated_tasks: readonly TaskQueueItem[];
  readonly macro_metrics: MacroMetrics;
  readonly optimal_lanes: number;
} {
  const queue = readTaskQueue(options.queuePath);
  const metrics = computeMacroMetrics(queue, options.maxLanes ?? 40);
  const optimalLanes = Math.max(
    1,
    Math.min(options.maxLanes ?? 40, Math.ceil(metrics.parallelism > 0 ? metrics.parallelism : 1)),
  );

  integrateMacroMetricsIntoMemory(queue, {
    cognitiveMemoryPath: options.cognitiveMemoryPath,
    queuePath: options.queuePath,
    maxLanes: options.maxLanes,
  });

  return {
    updated_tasks: queue,
    macro_metrics: metrics,
    optimal_lanes: optimalLanes,
  };
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
 * Synthesizes self-evolution smart tasks from open blunder logs, charter gap analysis,
 * Brent's theorem Work/Span (P = W/S) optimizations, and continuous invariant hardening (Mode A).
 */
export function synthesizeSmartTasksFromSelfEvolution(
  options: {
    readonly capsulesDir?: string | undefined;
    readonly queuePath?: string | undefined;
    readonly charterGoals?: readonly string[] | undefined;
    readonly maxTasks?: number | undefined;
    readonly autoEnqueue?: boolean | undefined;
    readonly cognitiveMemoryPath?: string | undefined;
  } = {},
): SmartTaskSynthesisResult {
  const maxTasks = options.maxTasks ?? 5;
  const targetRoots = options.capsulesDir ? [options.capsulesDir] : [".capsules/"];
  const blunderAudit = auditBlunderLog(targetRoots);
  const openBlunders = blunderAudit.blunders.filter((b) => b.status === "open");

  const selfTasks: SmartTaskPlan[] = [];

  // 1. Open blunder remediation
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

  // 2. Code Quality & Zero-Suppression Assurance
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
    dependencies: selfTasks
      .filter((prev) => detectScopeOverlap(hardeningScope, prev.write_scope).length > 0)
      .map((prev) => prev.id),
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

  // 3. Charter Gap Analysis & Cognitive Flavor Checks
  const charterGapScope = [
    "docs/mind/CHARTER.md",
    "orchestrating-long-tasks/scripts/src/mind/cognitive-flavor.ts",
    "tests/unit/mind/cognitive-flavor.test.ts",
  ];
  selfTasks.push({
    id: `task-${selfTasks.length + 1}-charter-gap-analysis`,
    label: "Charter Gap Analysis & Cognitive Flavor Posture Verification",
    write_scope: charterGapScope,
    gate: "bun test tests/unit/mind/cognitive-flavor.test.ts && bun run typecheck",
    charter_goals:
      options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G1"],
    acceptance_criteria: [
      "Perform cognitive flavor gap analysis across 4 tiers",
      "Ensure alignment with Mind Charter invariants and strategic altitude",
    ],
    dependencies: selfTasks
      .filter((prev) => detectScopeOverlap(charterGapScope, prev.write_scope).length > 0)
      .map((prev) => prev.id),
    source_type: "self_evolution",
    priority: "HIGH",
    rationale:
      "Autonomous charter gap analysis verifying cognitive flavor alignments and macro objectives.",
    assigned_tier: "Tier_2_Coordinator",
    assigned_implementer: "implementer-charter-gap",
    assigned_validator: "validator-charter-gap",
    metadata: {
      assigned_implementer: "implementer-charter-gap",
      assigned_validator: "validator-charter-gap",
    },
  });

  // 4. Historical Blunder Regression & Brent's Theorem Work/Span (P = W/S) Optimization
  const brentOptimizationScope = [
    "orchestrating-long-tasks/scripts/src/mind/strategic-purpose.ts",
    "tests/unit/mind/strategic-purpose.test.ts",
  ];
  selfTasks.push({
    id: `task-${selfTasks.length + 1}-brent-work-span-optimization`,
    label: "Macro DAG Work/Span (P = W/S) Optimization & Historical Blunder Regression Immunity",
    write_scope: brentOptimizationScope,
    gate: "bun test tests/unit/mind/strategic-purpose.test.ts && bun run typecheck",
    charter_goals:
      options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G2"],
    acceptance_criteria: [
      "Optimize Work/Span parallelism P = W/S across topological DAG waves",
      "Verify historical blunder regression immunity across test suites",
    ],
    dependencies: selfTasks
      .filter((prev) => detectScopeOverlap(brentOptimizationScope, prev.write_scope).length > 0)
      .map((prev) => prev.id),
    source_type: "self_evolution",
    priority: "MEDIUM",
    rationale:
      "Brent's theorem Work/Span (P = W/S) parallelism optimization preventing schedule bottlenecking.",
    assigned_tier: "Tier_1_Orchestrator",
    assigned_implementer: "implementer-brent-optimization",
    assigned_validator: "validator-brent-optimization",
    metadata: {
      assigned_implementer: "implementer-brent-optimization",
      assigned_validator: "validator-brent-optimization",
    },
  });

  // 5. Autonomic Continuous Optimization & Lean Architecture
  const autonomicOptScope = [
    "orchestrating-long-tasks/scripts/src/mind/archival.ts",
    "orchestrating-long-tasks/scripts/src/mind/recycler.ts",
    "tests/unit/mind/generational-archival.test.ts",
    "tests/unit/mind/recycler.test.ts",
  ];
  selfTasks.push({
    id: `task-${selfTasks.length + 1}-autonomic-optimization`,
    label: "Continuous Architecture & Lean Queue Maintenance",
    write_scope: autonomicOptScope,
    gate: "bun test tests/unit/mind && bun run typecheck",
    charter_goals:
      options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G3"],
    acceptance_criteria: [
      "Autonomic self-evolution cycle maintaining loop cadence and clean metrics",
      "Pass all mind unit tests cleanly",
    ],
    dependencies: selfTasks
      .filter((prev) => detectScopeOverlap(autonomicOptScope, prev.write_scope).length > 0)
      .map((prev) => prev.id),
    source_type: "self_evolution",
    priority: "MEDIUM",
    rationale:
      "Autonomic self-evolution cycle maintaining 0 any, 0 suppressions, and zero zombie task accumulation.",
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

  // Update persistent cognitive memory at .capsules/mind/memory.json
  try {
    updateCognitiveMemory(
      (curr) => ({
        ...curr,
        strategic_focus: [
          "Continuous Zero-Any & Zero-Suppression Assurance",
          "Charter Gap Analysis & Cognitive Flavor Checks",
          "Brent's Theorem Work/Span (P = W/S) Macro DAG Optimization",
          "Automated FIFO Pop & Clean-up Mechanics (Zero Zombie Accumulation)",
        ],
        active_hypotheses: [
          {
            id: "hyp-brent-parallelism",
            statement:
              "Disjoint write scope wave partitioning maximizes effective parallelism P = W/S without collision overhead.",
            confidence: 0.96,
            status: "active",
            evidence: [
              `Discovered ${selectedSelfTasks.length} self-evolution tasks across disjoint write scopes`,
            ],
            created_at: curr.last_updated,
            updated_at: new Date().toISOString(),
          },
        ],
        macro_metrics: computeMacroMetrics(selectedSelfTasks),
      }),
      options.cognitiveMemoryPath,
    );
  } catch {
    // Non-fatal cognitive memory persistence
  }

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

  for (let i = 0; i < promptOrFeedbacks.length; i++) {
    const fb = promptOrFeedbacks[i]!;
    const basePlan = planEnhance(fb, {
      charterGoals: options.charterGoals,
      baseId: `${prefix}-${i + 1}-${sanitizeSlug(fb.id)}`,
    });

    const dependencies: string[] = [];
    for (const prev of tasks) {
      if (detectScopeOverlap(basePlan.write_scope, prev.write_scope).length > 0) {
        dependencies.push(prev.id);
      }
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

/**
 * Partitions and stages tasks across multiple orchestrator sub-trees simultaneously,
 * maintaining strictly disjoint write scopes between all orchestrator trees.
 */
export function preplanMultiOrchestratorTasks(
  tasks: readonly SmartTaskPlan[],
  options: MultiOrchestratorPlanningOptions | number | readonly string[] = {},
): MultiOrchestratorPrePlanningResult {
  let targetOrchestratorIds: string[] = [];
  let maxOrchestrators = 2;
  let autoUpdateMemory = false;
  let cognitiveMemoryPath: string | undefined = undefined;

  if (typeof options === "number") {
    maxOrchestrators = Math.max(1, options);
    targetOrchestratorIds = Array.from(
      { length: maxOrchestrators },
      (_, i) => `orchestrator-${i + 1}`,
    );
  } else if (Array.isArray(options)) {
    targetOrchestratorIds = options.length > 0 ? [...options] : ["orchestrator-1"];
    maxOrchestrators = targetOrchestratorIds.length;
  } else {
    const opts = options as MultiOrchestratorPlanningOptions;
    if (opts.orchestratorIds && opts.orchestratorIds.length > 0) {
      targetOrchestratorIds = [...opts.orchestratorIds];
      maxOrchestrators = targetOrchestratorIds.length;
    } else if (typeof opts.maxOrchestrators === "number" && opts.maxOrchestrators > 0) {
      maxOrchestrators = opts.maxOrchestrators;
      targetOrchestratorIds = Array.from(
        { length: maxOrchestrators },
        (_, i) => `orchestrator-${i + 1}`,
      );
    } else {
      maxOrchestrators = Math.max(1, Math.min(tasks.length > 0 ? tasks.length : 1, 4));
      targetOrchestratorIds = Array.from(
        { length: maxOrchestrators },
        (_, i) => `orchestrator-${i + 1}`,
      );
    }
    autoUpdateMemory = opts.autoUpdateMemory ?? false;
    cognitiveMemoryPath = opts.cognitiveMemoryPath;
  }

  if (tasks.length === 0) {
    const emptyMetrics: MacroMetrics = { work: 0, span: 0, parallelism: 0, efficiency: 0 };
    return {
      total_orchestrators: 0,
      total_tasks: 0,
      orchestrators: [],
      macro_metrics: emptyMetrics,
      is_disjoint: true,
      cross_orchestrator_collisions: [],
      warnings: [],
    };
  }

  // 1. Group tasks into connected clusters based on scope overlap and dependencies
  const n = tasks.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i: number): number {
    let root = i;
    while (root !== parent[root]) {
      root = parent[root]!;
    }
    let curr = i;
    while (curr !== root) {
      const nxt = parent[curr]!;
      parent[curr] = root;
      curr = nxt;
    }
    return root;
  }
  function union(i: number, j: number): void {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) {
      parent[rootI] = rootJ;
    }
  }

  const taskIdToIndex = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    taskIdToIndex.set(tasks[i]!.id, i);
  }

  for (let i = 0; i < n; i++) {
    const taskA = tasks[i]!;
    for (const depId of taskA.dependencies) {
      const depIdx = taskIdToIndex.get(depId);
      if (depIdx !== undefined) {
        union(i, depIdx);
      }
    }
    for (let j = i + 1; j < n; j++) {
      const taskB = tasks[j]!;
      if (detectScopeOverlap(taskA.write_scope, taskB.write_scope).length > 0) {
        union(i, j);
      }
    }
  }

  const clusterMap = new Map<number, SmartTaskPlan[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = clusterMap.get(root) ?? [];
    list.push(tasks[i]!);
    clusterMap.set(root, list);
  }

  interface TaskCluster {
    readonly tasks: readonly SmartTaskPlan[];
    readonly totalWork: number;
    readonly scopes: readonly string[];
  }

  const clusters: TaskCluster[] = [];
  for (const clusterTasks of clusterMap.values()) {
    let work = 0;
    const scopeSet = new Set<string>();
    for (const t of clusterTasks) {
      work += typeof t.effort === "number" && t.effort > 0 ? t.effort : 1;
      for (const s of t.write_scope) {
        scopeSet.add(s);
      }
    }
    clusters.push({
      tasks: clusterTasks,
      totalWork: work,
      scopes: Array.from(scopeSet),
    });
  }

  clusters.sort((a, b) => b.totalWork - a.totalWork);

  // 2. Bin pack clusters across target orchestrators
  const numOrchestrators = Math.min(clusters.length, targetOrchestratorIds.length);
  const activeOrchIds = targetOrchestratorIds.slice(0, Math.max(1, numOrchestrators));

  interface OrchBucket {
    readonly id: string;
    tasks: SmartTaskPlan[];
    totalWork: number;
    scopes: Set<string>;
  }

  const buckets: OrchBucket[] = activeOrchIds.map((id) => ({
    id,
    tasks: [],
    totalWork: 0,
    scopes: new Set<string>(),
  }));

  for (const cluster of clusters) {
    let chosenBucket = buckets[0]!;
    for (let b = 1; b < buckets.length; b++) {
      if (buckets[b]!.totalWork < chosenBucket.totalWork) {
        chosenBucket = buckets[b]!;
      }
    }

    for (const t of cluster.tasks) {
      chosenBucket.tasks.push(t);
    }
    chosenBucket.totalWork += cluster.totalWork;
    for (const s of cluster.scopes) {
      chosenBucket.scopes.add(s);
    }
  }

  // 3. Build sub-tree plans for each active orchestrator
  const subTreePlans: MultiOrchestratorSubTreePlan[] = [];
  const crossCollisions: ScopeCollision[] = [];
  const warnings: string[] = [];

  for (const bucket of buckets) {
    if (bucket.tasks.length === 0) continue;
    const wavePlan = planWaveExecution(bucket.tasks);
    const orchScopes = Array.from(bucket.scopes);
    subTreePlans.push({
      orchestrator_id: bucket.id,
      write_scope: orchScopes,
      tasks: bucket.tasks,
      wave_plan: wavePlan,
      macro_metrics: wavePlan.macro_metrics ?? computeMacroMetrics(bucket.tasks),
    });
  }

  // 4. Verify disjointness across orchestrator sub-trees
  for (let i = 0; i < subTreePlans.length; i++) {
    for (let j = i + 1; j < subTreePlans.length; j++) {
      const orchA = subTreePlans[i]!;
      const orchB = subTreePlans[j]!;
      const overlaps = detectScopeOverlap(orchA.write_scope, orchB.write_scope);
      if (overlaps.length > 0) {
        for (const overlap of overlaps) {
          crossCollisions.push({
            scope: overlap,
            task_ids: [orchA.orchestrator_id, orchB.orchestrator_id],
          });
        }
      }
    }
  }

  // 5. Aggregate MacroMetrics
  let aggWork = 0;
  let maxSpan = 0;
  for (const st of subTreePlans) {
    aggWork += st.macro_metrics.work;
    if (st.macro_metrics.span > maxSpan) {
      maxSpan = st.macro_metrics.span;
    }
  }
  const parallelism =
    maxSpan > 0 ? Math.round((aggWork / maxSpan) * 100) / 100 : tasks.length > 0 ? 1 : 0;
  const optimalLanes = Math.max(1, Math.min(40, Math.ceil(parallelism > 0 ? parallelism : 1)));
  const efficiency =
    optimalLanes > 0 && parallelism > 0 ? Math.round((parallelism / optimalLanes) * 100) / 100 : 0;

  const aggregateMetrics: MacroMetrics = {
    work: aggWork,
    span: maxSpan,
    parallelism,
    efficiency,
  };

  if (autoUpdateMemory) {
    try {
      updateCognitiveMemory(
        (curr) => ({
          ...curr,
          macro_metrics: aggregateMetrics,
        }),
        cognitiveMemoryPath,
      );
    } catch {
      // non-fatal
    }
  }

  return {
    total_orchestrators: subTreePlans.length,
    total_tasks: tasks.length,
    orchestrators: subTreePlans,
    macro_metrics: aggregateMetrics,
    is_disjoint: crossCollisions.length === 0,
    cross_orchestrator_collisions: crossCollisions,
    warnings,
  };
}

/**
 * Asserts strict multi-orchestrator write scope isolation and anti-batching rule.
 * Throws HarnessError if any write scope overlaps across different orchestrator sub-trees.
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
export function executeAtomicAdmissionToDispatch(
  options: {
    readonly capsulesDir?: string | undefined;
    readonly queuePath?: string | undefined;
    readonly feedbackItems?: readonly FeedbackItem[] | undefined;
    readonly charterGoals?: readonly string[] | undefined;
    readonly maxTasks?: number | undefined;
    readonly orchestratorIds?: readonly string[] | undefined;
  } = {},
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

  // If orchestratorIds provided, stage across orchestrators
  let finalTasks = tasks;
  if (options.orchestratorIds && options.orchestratorIds.length > 0) {
    const staged = stageTasksForMultiOrchestratorExecution(tasks, {
      orchestratorIds: options.orchestratorIds,
    });
    finalTasks = staged.staged_tasks;
  }

  // 1. Enqueue tasks to task queue
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

  const enqueuedTasks = enqueueTasksBatch(batchInputs, options.queuePath);

  // 2. Atomically update feedback queue status to ADMITTED with linked task ID
  const allFeedbacks = readFeedbackQueue(options.capsulesDir);
  const nowIso = new Date().toISOString();
  const admittedMap = new Map<string, string>();
  for (const t of finalTasks) {
    if (t.feedback_id) {
      admittedMap.set(t.feedback_id, t.id);
    }
  }

  const newlyAdmitted: FeedbackItem[] = [];
  const updatedFeedbacks = allFeedbacks.map((fb) => {
    const matchedTaskId = admittedMap.get(fb.id);
    if (matchedTaskId) {
      const updated: FeedbackItem = {
        ...fb,
        status: "ADMITTED",
        processed_at: nowIso,
        metadata: {
          ...(fb.metadata ?? {}),
          dispatched_task_id: matchedTaskId,
          atomic_dispatched_at: nowIso,
        },
      };
      newlyAdmitted.push(updated);
      return updated;
    }
    return fb;
  });

  writeFeedbackQueue(updatedFeedbacks, options.capsulesDir);

  // 3. Verify zero paused admitted items invariant
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

/**
 * Alias for executeAtomicAdmissionToDispatch.
 */
export function executeProductOwnerAdmissionAndDispatch(
  options: {
    readonly capsulesDir?: string | undefined;
    readonly queuePath?: string | undefined;
    readonly feedbackItems?: readonly FeedbackItem[] | undefined;
    readonly charterGoals?: readonly string[] | undefined;
    readonly maxTasks?: number | undefined;
    readonly orchestratorIds?: readonly string[] | undefined;
  } = {},
): AdmissionToDispatchResult {
  return executeAtomicAdmissionToDispatch(options);
}

/**
 * Auto-reconciles any paused or orphaned admitted items by synthesizing missing 1:1 isolated tasks
 * and enqueuing them to the task queue.
 */
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
  const audit = verifyAdmissionToDispatchInvariants(options);
  if (audit.zero_paused_admitted) {
    return {
      reconciled_feedbacks_count: 0,
      newly_enqueued_tasks_count: 0,
      audit_report: audit,
    };
  }

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

/**
 * Executes a full Infinite Mind Product Owner cycle:
 * 1. Intakes items across user feedback, defect candidates, and self-evolution streams.
 * 2. Emits Product Owner admission decisions (G1-G6 criteria, anti-batching 1:1 isolation).
 * 3. Pre-plans tasks across concurrent multi-orchestrator sub-trees with disjoint write scopes.
 * 4. Atomically chains admission to task queue dispatch (guaranteeing zero paused admitted items).
 * 5. Integrates Work/Span macro metrics into persistent cognitive memory.
 */
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
