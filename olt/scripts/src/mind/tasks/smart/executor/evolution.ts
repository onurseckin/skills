import { detectScopeOverlap } from "../planner/collisions.ts";
import { auditDefectLog } from "../../../defects/index.ts";
import {
  isTestEnvironment,
  resolveScratchDir,
  resolveCapsulesDir,
} from "../../../../core/shared/paths.ts";
import { enqueueTasksBatch, type NewTaskQueueInput } from "../../queue/index.ts";
import { evaluateHierarchyScaling } from "../../../../graph/topology.ts";
import { drainPendingFeedbacks } from "../../../feedback/index.ts";
import { assertAntiBatchingRule } from "../planner/partitioning.ts";
import { enrichTaskPlanWithExactAnchors } from "../planner/anti-batching.ts";
import { mapFeedbackPriorityToTaskPriority } from "./orchestrator.ts";
import {
  sanitizeSlug,
  deriveWriteScopeForCategory,
  deriveGateForCategory,
} from "./orchestrator.ts";
import type { SmartTaskPlan, SmartTaskSynthesisResult } from "../planner/models.ts";
import { readCognitiveMemory } from "../planner/memory.ts";
import { readFeedbackQueue, resolveFeedbackQueuePath } from "../../../feedback/queue/index.ts";
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

    // Drain and mark pending feedbacks as ADMITTED
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

/**
 * Synthesizes self-evolution smart tasks from open defect logs, charter gap analysis,
 * Brent's theorem Work/Span (P = W/S) optimizations, and continuous invariant hardening (Mode A).
 */

export { synthesizeSmartTasksFromSelfEvolution } from "./self-evolution.ts";
