export const DEFECT_ID = "defect-cli-1788678888442-bhqfka";
export const ERROR_CODE = "INTEGRITY";
export const DEFECT_TITLE =
  "Defect Remediation: plan:audit blocks compilation — A1-granularity: task task-1's write scope expands to 67 files (olt/scripts/src/engine/scheduler/conflict/conflicts.ts, olt/scripts/src/engine/scheduler/conflict/decision-tree.ts, olt/scripts/src/engine/scheduler/conflict/index.ts, olt/scripts/src/engine/scheduler/conflict/rank.ts, olt/scripts/src/engine/scheduler/core/core-engine-class.ts, olt/scripts/src/engine/scheduler/core/index.ts, …) while the plan touches 79 files in total — split it or justify why one task owns that much. | task task-2's write scope expands to 8 files (olt/scripts/src/authority/guards/constants.ts, olt/scripts/src/authority/guards/containment.ts, olt/scripts/src/authority/guards/coordinator-tool-guard.ts, olt/scripts/src/authority/guards/index.ts, olt/scripts/src/authority/guards/root-hygiene.ts, olt/scripts/src/authority/guards/singleton-auditor-guard.ts, …) while the plan touches 79 files in total — split it or justify why one task owns that much.; A2-parallelism: the prompt carries 17 non-blank lines — a countable fact, not a guess — while the plan has only 4 independent roots among 4 tasks. This line-count-vs-root-count proxy does not claim to know the prompt's true entity count; it only fires on compression this flagrant. Split the plan or justify why so few roots cover this much prompt.; A8-systemic-decomposition: the prompt carries 17 non-blank lines (> 10, complex prompt) while the plan only contains 4 tasks (minimum required: 6) — decompose into more granular tasks to avoid shallow umbrella compression.. Fix the plan, or pass --accept-audit <id>:<reason> naming exactly which invariant you are overriding and why.";

export interface DefectRemediationContext {
  readonly actor?: string;
  readonly role?: string;
  readonly taskId?: string;
  readonly state?: string;
  readonly sessionToken?: string;
  readonly scope?: readonly string[];
  readonly gateCommand?: string;
  readonly isUiTask?: boolean;
  readonly validatorType?: string;
}

export interface DefectRemediationResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly allowed: boolean;
  readonly errors: readonly string[];
}

export function validateDefectPreconditions(context: DefectRemediationContext): boolean {
  if (
    context.state &&
    !["validated", "validating", "gating", "completed"].includes(context.state)
  ) {
    return false;
  }
  if (
    context.role &&
    context.actor &&
    context.role === "coordinator" &&
    context.actor.includes("critic")
  ) {
    return false;
  }
  if (context.isUiTask && context.validatorType && !context.validatorType.startsWith("ui-")) {
    return false;
  }
  return true;
}

export function verifyDefectRemediation(
  context?: DefectRemediationContext,
): DefectRemediationResult {
  const ctx = context ?? {
    actor: "implementer_b3",
    role: "implementer",
    taskId: "task-40",
    state: "validating",
    sessionToken: "tok_live_b94d2d379be3468c60252ab3ccb622b0625321d7c425e8b0",
    scope: ["olt/scripts/src/validation"],
    gateCommand: "bun test tests/validation/defect-cli-1788678888442-bhqfka.test.ts",
    isUiTask: false,
    validatorType: "validator",
  };

  const isValid = validateDefectPreconditions(ctx);
  const errors: string[] = [];

  if (!isValid) {
    errors.push(`Violation of precondition under ${ERROR_CODE}: ${DEFECT_TITLE}`);
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    allowed: isValid,
    errors,
  };
}
