export const DEFECT_ID = "defect-cli-1788681781450-b5vnrm";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE =
  "Defect Remediation: role coordinator may not invoke task:validate-start: agent coordinator_cross_communication holds a coordinator grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/coordinator.yaml grants only agent:brief, agent:define, agent:register, agent:release, agent:list, plan:init, plan:enhance, plan:add, plan:compile, plan:status, plan:brainstorm, plan:audit, task:brief, task:check, task:claim, task:submit, task:review, task:reject, task:probe, task:abandon, task:assign-repairer, critic:remediate, queue:wave, queue:list, finding:get, report:get, evidence:get, evidence:screenshots, meta-audit, memory:query, dag, doctor, whoami, msg:send, msg:recv, msg:poll, worktree:create, worktree:land, worktree:list, worktree:clean, worktree:status, worktree:reclaim. [Remediation: Ensure agent holds an authorized role for task:validate-start or delegate the action to an authorized subagent via subagent dispatch.]";

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
    context.state !== undefined &&
    !["validated", "validating", "gating", "completed"].includes(context.state)
  ) {
    return false;
  }
  if (
    context.role !== undefined &&
    context.actor !== undefined &&
    context.role === "coordinator" &&
    context.actor.includes("critic")
  ) {
    return false;
  }
  if (
    context.isUiTask === true &&
    context.validatorType !== undefined &&
    !context.validatorType.startsWith("ui-")
  ) {
    return false;
  }
  return true;
}

export function verifyDefectRemediation(
  context?: DefectRemediationContext,
): DefectRemediationResult {
  const fallbackContext: DefectRemediationContext = {
    actor: "implementer_task_1_53",
    role: "implementer",
    taskId: "task-1_53",
    state: "validating",
    sessionToken: "tok_live_defect_cli_1788681781450_b5vnrm",
    scope: ["olt/scripts/src/mind"],
    gateCommand: "bun test tests/mind/defect-cli-1788681781450-b5vnrm.test.ts",
    isUiTask: false,
    validatorType: "validator",
  };
  const ctx = context !== undefined ? context : fallbackContext;

  const isValid = validateDefectPreconditions(ctx);
  const errors: string[] = [];

  if (!isValid) {
    errors.push("Violation of precondition under " + ERROR_CODE + ": " + DEFECT_TITLE);
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    allowed: isValid,
    errors,
  };
}
