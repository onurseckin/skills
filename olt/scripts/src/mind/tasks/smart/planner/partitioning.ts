import { detectScopeOverlap } from "./collisions.ts";
import { enrichTaskPlanWithExactAnchors } from "./anti-batching.ts";
import { mapFeedbackPriorityToTaskPriority } from "../executor/orchestrator.ts";
import { deriveGateForCategory } from "../executor/orchestrator.ts";
import { deriveWriteScopeForCategory } from "../executor/orchestrator.ts";
import { sanitizeSlug } from "../executor/orchestrator.ts";
import { join } from "node:path";
import { HarnessError } from "../../../../core/errors/index.ts";
import type { SmartTaskPlan, AntiBatchingValidationReport } from "./models.ts";
import type { FeedbackItem } from "../../../feedback/queue/index.ts";
import { enqueueTasksBatch, type NewTaskQueueInput } from "../../../../task/queue/index.ts";
export function validateAntiBatchingRule(
  plans: readonly SmartTaskPlan[],
): AntiBatchingValidationReport {
  const violations: string[] = [];
  let isolatedCount = 0;
  const seenTaskIds = new Set<string>();

  for (const plan of plans) {
    let planCompliant = true;

    if (plan.id && plan.id.trim()) {
      if (seenTaskIds.has(plan.id.trim())) {
        violations.push(`Duplicate task ID '${plan.id}' detected in plan set.`);
        planCompliant = false;
      } else {
        seenTaskIds.add(plan.id.trim());
      }
    }

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

    const rawPlan: SmartTaskPlan = {
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
    };

    tasks.push(enrichTaskPlanWithExactAnchors(rawPlan));
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
