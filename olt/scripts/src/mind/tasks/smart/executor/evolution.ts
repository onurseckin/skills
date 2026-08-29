import { detectScopeOverlap } from "../planner/collisions.ts";
import {
  enqueueTasksBatch,
  type NewTaskQueueInput,
  type TaskPriority,
} from "../../../../task/queue/index.ts";
import { evaluateHierarchyScaling } from "../../../../graph/parallel-decoupler.ts";
import { drainPendingFeedbacks } from "../../../feedback/index.ts";
import { assertAntiBatchingRule } from "../planner/partitioning.ts";
import { enrichTaskPlanWithExactAnchors } from "../planner/anti-batching.ts";
import {
  mapFeedbackPriorityToTaskPriority,
  sanitizeSlug,
  deriveWriteScopeForCategory,
  deriveGateForCategory,
} from "./orchestrator.ts";
import type { SmartTaskPlan, SmartTaskSynthesisResult } from "../planner/models.ts";
import { readFeedbackQueue } from "../../../feedback/queue/index.ts";
import { HarnessError } from "../../../../core/errors/index.ts";

export interface PlanTasksForDefectOptions {
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
  readonly roundNumber?: number | undefined;
}

export interface DefectTaskTarget {
  readonly id: string;
  readonly observation?: string | undefined;
  readonly description?: string | undefined;
  readonly title?: string | undefined;
  readonly message?: string | undefined;
  readonly remediation?: string | undefined;
  readonly category?: string | undefined;
  readonly severity?: string | undefined;
  readonly status?: string | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly gate?: string | undefined;
  readonly [key: string]: unknown;
}

export function planTasksForDefect(
  defectOrDefects: DefectTaskTarget | string | readonly (DefectTaskTarget | string)[],
  options: PlanTasksForDefectOptions = {},
): readonly SmartTaskPlan[] {
  const items = Array.isArray(defectOrDefects) ? defectOrDefects : [defectOrDefects];
  if (items.length === 0) return [];

  const tasks: SmartTaskPlan[] = [];
  const goals =
    options.charterGoals && options.charterGoals.length > 0 ? options.charterGoals : ["G2"];

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const isStr = typeof item === "string";
    const defectId = isStr
      ? item.trim()
      : typeof item.id === "string" && item.id.trim()
        ? item.id.trim()
        : `defect-${i + 1}`;
    if (!defectId) throw new HarnessError("INVALID_ARGUMENT", "Defect identifier cannot be empty");

    const detail = isStr
      ? defectId
      : item.observation || item.description || item.title || item.message || defectId;
    const remediation =
      !isStr && item.remediation
        ? item.remediation
        : "Fix root cause of defect with regression immunity";
    const category = !isStr && item.category ? item.category : "CORE_ENGINE";
    const slug = sanitizeSlug(defectId.slice(0, 40));
    const taskId = options.baseId
      ? items.length === 1
        ? sanitizeSlug(options.baseId)
        : `${sanitizeSlug(options.baseId)}-${i + 1}`
      : `task-${i + 1}-defect-${slug}`;

    const scope =
      options.writeScope && options.writeScope.length > 0
        ? options.writeScope
        : !isStr && Array.isArray(item.write_scope) && item.write_scope.length > 0
          ? item.write_scope
          : deriveWriteScopeForCategory(category, defectId);

    const gate =
      options.gate && options.gate.trim()
        ? options.gate.trim()
        : !isStr && typeof item.gate === "string" && item.gate.trim()
          ? item.gate.trim()
          : deriveGateForCategory(category, scope);

    let priority: TaskPriority = options.priority ?? "CRITICAL";
    if (options.priority === undefined && !isStr && item.severity) {
      const s = item.severity.toLowerCase();
      priority =
        s === "critical"
          ? "CRITICAL"
          : s === "high" || s === "important"
            ? "HIGH"
            : s === "medium"
              ? "MEDIUM"
              : "LOW";
    }

    const assignedImplementer = options.assignedImplementer ?? `implementer-defect-${slug}`;
    const assignedValidator = options.assignedValidator ?? `validator-defect-${slug}`;

    const rawPlan: SmartTaskPlan = {
      id: taskId,
      label: `Defect Remediation: ${detail.slice(0, 80)}`,
      write_scope: scope,
      gate,
      charter_goals: goals,
      acceptance_criteria: [
        `Remediate open defect ${defectId}: ${detail.slice(0, 100)}`,
        `Prescribed remediation: ${remediation.slice(0, 100)}`,
        `Pass gate: ${gate}`,
        "Ensure zero TypeScript any and zero compiler suppressions",
      ],
      dependencies: [],
      source_type: "defect_remediation",
      priority,
      rationale: `Autonomous defect remediation for ${defectId}: ${detail}`,
      assigned_tier: options.assignedTier ?? "Tier_3_Implementer",
      assigned_implementer: assignedImplementer,
      assigned_validator: assignedValidator,
      candidate_id: defectId,
      metadata: {
        candidate_id: defectId,
        defect_id: defectId,
        assigned_implementer: assignedImplementer,
        assigned_validator: assignedValidator,
      },
    };

    const enriched = enrichTaskPlanWithExactAnchors(rawPlan);
    const dependencies: string[] = [];
    for (const prev of tasks) {
      if (detectScopeOverlap(enriched.write_scope, prev.write_scope).length > 0) {
        dependencies.push(prev.id);
      }
    }
    tasks.push({ ...enriched, dependencies });
  }

  assertAntiBatchingRule(tasks);
  return tasks;
}

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

    const rawPlan: SmartTaskPlan = {
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
    };

    tasks.push(enrichTaskPlanWithExactAnchors(rawPlan));
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

    drainPendingFeedbacks({ markAs: "ADMITTED", limit: selected.length }, options.capsulesDir);
  }

  const hierarchyScaling = evaluateHierarchyScaling({ taskCount: tasks.length });

  return {
    mode: "feedback_intake",
    tasks,
    summary: `Synthesized ${tasks.length} isolated task(s) from pending user feedback queue with 1:1 implementer-validator mapping.`,
    source_items_count: pendingFeedback.length,
    anti_batching_enforced: true,
    hierarchy_scaling: hierarchyScaling,
    fast_path_compaction: hierarchyScaling.fastPath,
    ...(enqueuedCount > 0 ? { enqueued_count: enqueuedCount } : {}),
  };
}

export { synthesizeSmartTasksFromSelfEvolution } from "./self-evolution.ts";
