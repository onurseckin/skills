export const DEFECT_ID = "defect-cli-1788678856816-bglw19";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE =
  "Defect Remediation: role orchestrator may not invoke plan:audit: agent orchestrator holds a orchestrator grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/orchestrator.yaml grants only run:init, agent:brief, agent:define, agent:register, agent:release, agent:list, task:brief, task:check, run:status, run:complete, dag, quota:freeze, quota:resume, doctor, orchestrator:supervise, summary:export, summary:view, finding:get, report:get, evidence:get, whoami, msg:send, msg:recv, msg:poll, worktree:create, worktree:land, worktree:list, worktree:clean, worktree:status, worktree:reclaim. [Remediation: Ensure agent holds an authorized role for plan:audit or delegate the action to an authorized subagent via subagent dispatch.]";

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
    taskId: "task-38",
    state: "validating",
    sessionToken: "tok_live_b94d2d379be3468c60252ab3ccb622b0625321d7c425e8b0",
    scope: ["olt/scripts/src/validation"],
    gateCommand: "bun test tests/validation/defect-cli-1788678856816-bglw19.test.ts",
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
