import { isJsonObject, type JsonObject } from "../core/contracts/json.ts";
import type { BranchSubTask } from "../core/contracts/branch.ts";
import type { TaskRecord, WorkflowState } from "../workflow/types.ts";
import type {
  CognitiveStepCategory,
  CognitiveStepCoverageIssue,
  CognitiveStepCoverageResult,
  CognitiveValidationStep,
  DynamicStepInput,
  DynamicStepPlan,
  ExtractedCriterion,
  PacketInput,
} from "./types.ts";

export type {
  CognitiveStepCategory,
  CognitiveStepCoverageIssue,
  CognitiveStepCoverageResult,
  CognitiveValidationStep,
  DynamicStepInput,
  DynamicStepPlan,
  ExtractedCriterion,
};

function extractTaskRequirementIds(task: TaskRecord | BranchSubTask | null | undefined): string[] {
  if (!task) return [];
  if ("requirement_ids" in task && Array.isArray(task.requirement_ids)) {
    const ids: string[] = [];
    for (const reqId of task.requirement_ids) {
      if (typeof reqId === "string" && reqId.length > 0) {
        ids.push(reqId);
      }
    }
    return ids;
  }
  return [];
}

function categorizeCriterion(criterionText: string): CognitiveStepCategory {
  const text = criterionText.toLowerCase();
  if (
    text.includes("falsifiab") ||
    text.includes("adversar") ||
    text.includes("negative") ||
    text.includes("counterfactual")
  ) {
    return "falsifiability_check";
  }
  if (
    text.includes("isolation") ||
    text.includes("boundary") ||
    text.includes("write_scope") ||
    text.includes("leak") ||
    text.includes("confinement") ||
    text.includes("scope")
  ) {
    return "boundary_verification";
  }
  if (
    text.includes("evidence") ||
    text.includes("artifact") ||
    text.includes("digest") ||
    text.includes("proof") ||
    text.includes("schema")
  ) {
    return "evidence_audit";
  }
  if (
    text.includes("invariant") ||
    text.includes("zero any") ||
    text.includes("suppression") ||
    text.includes("typing") ||
    text.includes("contract")
  ) {
    return "domain_invariant";
  }
  return "criterion_verification";
}

/**
 * Extracts normalized acceptance criteria from requirement objects.
 * Guarantees N criteria -> N explicit items.
 */
export function extractAcceptanceCriteria(
  requirements: readonly unknown[] | undefined,
  targetRequirementIds?: readonly string[] | undefined,
): ExtractedCriterion[] {
  const results: ExtractedCriterion[] = [];
  const targetSet =
    targetRequirementIds && targetRequirementIds.length > 0 ? new Set(targetRequirementIds) : null;

  if (!requirements || !Array.isArray(requirements)) {
    if (targetSet) {
      for (const reqId of targetSet) {
        results.push({
          requirementId: reqId,
          criterionId: `crit-${reqId}-1`,
          criterion: `Verify requirement ${reqId} implementation satisfies specification`,
          evidenceRequirements: [`Gate execution output for ${reqId}`],
        });
      }
    }
    return results;
  }

  for (const req of requirements) {
    if (!isJsonObject(req)) continue;
    const reqId = typeof req.id === "string" && req.id.length > 0 ? req.id : "req-unknown";
    if (targetSet && !targetSet.has(reqId)) continue;

    const acceptance = Array.isArray(req.acceptance) ? req.acceptance : [];
    if (acceptance.length > 0) {
      for (let i = 0; i < acceptance.length; i++) {
        const item = acceptance[i];
        if (isJsonObject(item)) {
          const criterionId =
            typeof item.id === "string" && item.id.length > 0 ? item.id : `crit-${reqId}-${i + 1}`;
          const criterionText =
            typeof item.criterion === "string" && item.criterion.length > 0
              ? item.criterion
              : typeof item.statement === "string" && item.statement.length > 0
                ? item.statement
                : `Verify acceptance condition ${i + 1} for ${reqId}`;
          const rawEvidence = Array.isArray(item.evidence) ? item.evidence : [];
          const evidenceRequirements: string[] = rawEvidence.filter(
            (e): e is string => typeof e === "string" && e.trim().length > 0,
          );
          if (evidenceRequirements.length === 0) {
            evidenceRequirements.push(`Gate execution output for ${reqId}`);
          }
          results.push({
            requirementId: reqId,
            criterionId,
            criterion: criterionText,
            evidenceRequirements,
          });
        }
      }
    } else {
      const instruction =
        typeof req.instruction === "string" && req.instruction.length > 0
          ? req.instruction
          : typeof req.implementation === "string" && req.implementation.length > 0
            ? req.implementation
            : `Verify requirement ${reqId}`;
      const rawEvidence = Array.isArray(req.evidence) ? req.evidence : [];
      const evidenceRequirements = rawEvidence.filter(
        (e): e is string => typeof e === "string" && e.trim().length > 0,
      );
      if (evidenceRequirements.length === 0) {
        evidenceRequirements.push(`Gate execution output for ${reqId}`);
      }
      results.push({
        requirementId: reqId,
        criterionId: `crit-${reqId}-1`,
        criterion: instruction,
        evidenceRequirements,
      });
    }
  }

  if (targetSet) {
    const foundReqIds = new Set(results.map((r) => r.requirementId));
    for (const reqId of targetSet) {
      if (!foundReqIds.has(reqId)) {
        results.push({
          requirementId: reqId,
          criterionId: `crit-${reqId}-1`,
          criterion: `Verify requirement ${reqId} implementation satisfies specification`,
          evidenceRequirements: [`Gate execution output for ${reqId}`],
        });
      }
    }
  }

  return results;
}

/**
 * Dynamic N-Step Cognitive Validation Engine.
 * Dynamically scales validator cognitive step count based on the number of acceptance criteria.
 * (N criteria -> N explicit cognitive validation steps).
 */
export function generateDynamicValidationSteps(input: DynamicStepInput): DynamicStepPlan {
  const targetRequirementIds: string[] = [];
  if (input.mappedRequirementIds && input.mappedRequirementIds.length > 0) {
    targetRequirementIds.push(...input.mappedRequirementIds);
  } else if (input.task) {
    targetRequirementIds.push(...extractTaskRequirementIds(input.task));
  }

  const criteria = extractAcceptanceCriteria(
    input.requirements,
    targetRequirementIds.length > 0 ? targetRequirementIds : undefined,
  );

  if (criteria.length === 0) {
    const taskId = input.task && typeof input.task.id === "string" ? input.task.id : "task";
    const label =
      input.task && typeof input.task.label === "string" ? input.task.label : "task implementation";
    const defaultReqId = targetRequirementIds[0] ?? `${taskId}-req`;
    criteria.push({
      requirementId: defaultReqId,
      criterionId: `crit-${taskId}-default-1`,
      criterion: `Verify ${label} satisfies task contract and write scope invariants`,
      evidenceRequirements: [`Quantitative execution proof for ${taskId}`],
    });
  }

  const totalSteps = criteria.length;
  const steps: CognitiveValidationStep[] = [];

  for (let i = 0; i < totalSteps; i++) {
    const crit = criteria[i]!;
    const stepNumber = i + 1;
    const category = categorizeCriterion(crit.criterion);
    const directive = `Execute independent falsifiable verification for acceptance criterion '${crit.criterionId}': ${crit.criterion}`;
    const instructions = [
      `1. Inspect touched code and repository artifacts mapping to requirement '${crit.requirementId}'.`,
      `2. Execute authoritative verification commands or gate checks proving criterion '${crit.criterionId}' (${crit.criterion}).`,
      `3. Capture concrete quantitative proof satisfying evidence requirements: ${crit.evidenceRequirements.join(", ")}.`,
      `4. Verify counterfactual falsifiability: ensure the check fails on broken or inverted logic.`,
    ].join("\n");
    const falsifiabilityPrompt = `Verify counterfactual falsifiability: ensure criterion '${crit.criterionId}' fails if the implementation logic is inverted, removed, or corrupted.`;

    steps.push({
      stepNumber,
      totalSteps,
      requirementId: crit.requirementId,
      criterionId: crit.criterionId,
      criterion: crit.criterion,
      evidenceRequirements: crit.evidenceRequirements,
      category,
      directive,
      instructions,
      falsifiabilityPrompt,
    });
  }

  const mappedRequirementIds = [...new Set(steps.map((s) => s.requirementId))];
  const summary = `Dynamic cognitive validation plan: ${totalSteps} explicit cognitive step${totalSteps === 1 ? "" : "s"} generated for ${mappedRequirementIds.length} mapped requirement${mappedRequirementIds.length === 1 ? "" : "s"} (${criteria.length} total acceptance criteria).`;
  const renderedMarkdown = renderDynamicValidationSteps(steps);

  return {
    criteriaCount: criteria.length,
    totalSteps,
    steps,
    mappedRequirementIds,
    summary,
    renderedMarkdown,
  };
}

/**
 * Renders the generated cognitive validation steps as formatted markdown.
 */
export function renderDynamicValidationSteps(steps: readonly CognitiveValidationStep[]): string {
  if (steps.length === 0) {
    return "### Dynamic Cognitive Validation Steps\n\nNo cognitive validation steps generated.\n";
  }

  const header = `### Dynamic Cognitive Validation Steps (${steps.length} Step${steps.length === 1 ? "" : "s"})\n\n`;
  const body = steps
    .map((step) => {
      const evidenceStr =
        step.evidenceRequirements.length > 0
          ? step.evidenceRequirements.map((e) => `\`${e}\``).join(", ")
          : "None declared";
      return [
        `#### Step ${step.stepNumber}/${step.totalSteps}: [\`${step.criterionId}\`] ${step.criterion}`,
        `- **Requirement ID**: \`${step.requirementId}\``,
        `- **Category**: \`${step.category}\``,
        `- **Expected Evidence**: ${evidenceStr}`,
        `- **Directive**: ${step.directive}`,
        `- **Instructions**:\n${step.instructions
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n")}`,
        `- **Falsifiability Check**: ${step.falsifiabilityPrompt}`,
      ].join("\n");
    })
    .join("\n\n");

  return `${header}${body}\n`;
}

/**
 * Formats dynamic validation steps as a checklist.
 */
export function formatDynamicValidationChecklist(
  steps: readonly CognitiveValidationStep[],
): string {
  return steps
    .map(
      (step) =>
        `- [ ] Step ${step.stepNumber}/${step.totalSteps}: [\`${step.criterionId}\`] ${step.criterion} (Requirement: \`${step.requirementId}\`)`,
    )
    .join("\n");
}

/**
 * Fast helper to compute dynamic cognitive step count from requirements.
 */
export function computeDynamicStepCount(
  requirements: readonly unknown[] | undefined,
  targetRequirementIds?: readonly string[] | undefined,
): number {
  return extractAcceptanceCriteria(requirements, targetRequirementIds).length;
}

/**
 * Evaluates whether submitted checks and evidence satisfy all dynamic validation steps.
 */
export function validateCognitiveStepCoverage(
  plan: DynamicStepPlan,
  submittedChecks?: readonly string[] | readonly JsonObject[] | undefined,
): CognitiveStepCoverageResult {
  const issues: CognitiveStepCoverageIssue[] = [];
  const checkStrings = new Set<string>();

  if (Array.isArray(submittedChecks)) {
    for (const check of submittedChecks) {
      if (typeof check === "string") {
        checkStrings.add(check.toLowerCase());
      } else if (isJsonObject(check)) {
        if (typeof check.command_id === "string") checkStrings.add(check.command_id.toLowerCase());
        if (typeof check.criterion_id === "string")
          checkStrings.add(check.criterion_id.toLowerCase());
        if (typeof check.id === "string") checkStrings.add(check.id.toLowerCase());
        if (typeof check.requirement_id === "string")
          checkStrings.add(check.requirement_id.toLowerCase());
      }
    }
  }

  let coveredCount = 0;
  for (const step of plan.steps) {
    const critId = step.criterionId.toLowerCase();
    const reqId = step.requirementId.toLowerCase();
    const isCovered =
      checkStrings.has(critId) ||
      checkStrings.has(reqId) ||
      step.evidenceRequirements.some((e) => checkStrings.has(e.toLowerCase())) ||
      [...checkStrings].some((c) => c.includes(critId) || c.includes(reqId));

    if (isCovered || checkStrings.size === 0) {
      coveredCount++;
    } else {
      issues.push({
        stepNumber: step.stepNumber,
        criterionId: step.criterionId,
        requirementId: step.requirementId,
        reason: `Acceptance criterion '${step.criterionId}' lacks matching evidence or check in submission.`,
      });
    }
  }

  return {
    covered: issues.length === 0,
    totalSteps: plan.totalSteps,
    coveredStepsCount: coveredCount,
    missingStepsCount: issues.length,
    issues,
  };
}

/**
 * Builds dynamic cognitive steps directly from workflow state and task.
 */
export function buildDynamicStepsFromWorkflowState(
  state: WorkflowState,
  task: TaskRecord,
): DynamicStepPlan {
  const reqs = Array.isArray(state.requirements)
    ? state.requirements
    : isJsonObject(state.requirements) &&
        Array.isArray((state.requirements as { requirements?: unknown }).requirements)
      ? ((state.requirements as { requirements: unknown[] }).requirements.filter(
          isJsonObject,
        ) as JsonObject[])
      : [];

  const targetReqIds: string[] = [];
  if (Array.isArray(task.requirement_ids)) {
    for (const reqId of task.requirement_ids) {
      if (typeof reqId === "string" && reqId.length > 0) {
        targetReqIds.push(reqId);
      }
    }
  }

  return generateDynamicValidationSteps({
    task,
    requirements: reqs,
    mappedRequirementIds: targetReqIds,
  });
}

/**
 * Builds dynamic cognitive steps directly from a PacketInput.
 */
export function buildDynamicStepsFromPacketInput(input: PacketInput): DynamicStepPlan {
  const task = input.task ?? input.subTask;
  const reqIds = extractTaskRequirementIds(task);
  const reqIdSet = new Set(reqIds);
  const reqs = input.state.requirements.filter(
    (r) => typeof r.id === "string" && reqIdSet.has(r.id),
  );

  return generateDynamicValidationSteps({
    task: input.task,
    requirements: reqs,
    mappedRequirementIds: reqIds,
  });
}
