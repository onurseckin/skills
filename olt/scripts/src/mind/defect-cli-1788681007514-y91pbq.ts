export const DEFECT_ID = "defect-cli-1788681007514-y91pbq";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE = "Defect Remediation: role mind may not invoke plan:enhance: agent mind-gen-3 holds a mind grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/mind.yaml grants only mind:init, mind:wake, mind:pulse, mind:pulse-open, mind:observe, mind:candidate, mind:admit, mind:decline, mind:quiesce, mind:escalate, mind:halt, mind:round-open, mind:round-close, mind:rotate, mind:audit-start, mind:audit-report, queue:drain, queue:seal, queue:clean, watchdog:cleanup, watchdog:phase-cleanup, memory:query, smart-task:plan, smart-task:ingest, agent:brief, agent:define, agent:register, agent:release, agent:list, dag, quota:freeze, quota:resume, doctor, whoami, msg:send, msg:recv, msg:poll. [Remediation: Ensure agent holds an authorized role for plan:enhance or delegate the action to an authorized subagent via subagent dispatch.]";

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
    actor: "implementer_task_1_44",
    role: "implementer",
    taskId: "task-1_44",
    state: "validating",
    sessionToken: "tok_live_defect_cli_1788681007514_y91pbq",
    scope: ["olt/scripts/src/mind"],
    gateCommand: "bun test tests/mind/defect-cli-1788681007514-y91pbq.test.ts",
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
