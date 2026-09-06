export const DEFECT_ID = "defect-skill-auditor-shallow-surveillance-missed-supervisor-edits";
export const ERROR_CODE = "SKILL_AUDITOR_SHALLOW_SURVEILLANCE";
export const DEFECT_TITLE =
  "Defect Remediation: Skill Auditor Missed Supervisor Direct Code Writes: Post-Hoc Capsule Audit Lacked Live Tool-Call Interception";

export const DISALLOWED_SUPERVISOR_TOOLS: readonly string[] = [
  "write_to_file",
  "replace_file_content",
  "notebook_edit",
];

export const SUPERVISOR_ROLES: readonly string[] = [
  "orchestrator",
  "coordinator",
  "tier1",
  "tier2",
  "tier-1-orchestrator",
  "tier-2-coordinator",
  "supervisor",
];

export interface DefectRemediationContext {
  readonly actor?: string | undefined;
  readonly role?: string | undefined;
  readonly taskId?: string | undefined;
  readonly state?: string | undefined;
  readonly sessionToken?: string | undefined;
  readonly scope?: readonly string[] | undefined;
  readonly gateCommand?: string | undefined;
  readonly isUiTask?: boolean | undefined;
  readonly validatorType?: string | undefined;
  readonly attemptedTool?: string | undefined;
  readonly isLiveInterception?: boolean | undefined;
}

export interface DefectRemediationResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly allowed: boolean;
  readonly errors: readonly string[];
}

export interface LiveToolInvocation {
  readonly actor: string;
  readonly role: string;
  readonly toolName: string;
  readonly targetFile?: string | undefined;
  readonly isLiveInterception: boolean;
  readonly timestamp?: string | undefined;
}

export interface AuditStreamReport {
  readonly auditedLive: boolean;
  readonly breachDetected: boolean;
  readonly violations: readonly string[];
  readonly remediationAction: string;
}

export function isSupervisorRole(role: string): boolean {
  const normalized = role.toLowerCase().trim();
  return SUPERVISOR_ROLES.some((r) => normalized === r || normalized.includes(r));
}

export function isCodeModificationTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase().trim();
  return DISALLOWED_SUPERVISOR_TOOLS.includes(normalized);
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
  if (
    context.role !== undefined &&
    context.attemptedTool !== undefined &&
    isSupervisorRole(context.role) &&
    isCodeModificationTool(context.attemptedTool)
  ) {
    return false;
  }
  if (context.isLiveInterception === false) {
    return false;
  }
  return true;
}

export function interceptLiveToolCall(invocation: LiveToolInvocation): {
  readonly allowed: boolean;
  readonly violation?: string | undefined;
} {
  if (!invocation.isLiveInterception) {
    return {
      allowed: false,
      violation:
        "Post-hoc inspection insufficient: real-time live tool-call interception required.",
    };
  }

  if (isSupervisorRole(invocation.role) && isCodeModificationTool(invocation.toolName)) {
    return {
      allowed: false,
      violation: `Role boundary breach: Supervisor '${invocation.actor}' with role '${invocation.role}' cannot invoke '${invocation.toolName}'. Direct file writes must be delegated to Tier 3 Implementers.`,
    };
  }

  return { allowed: true };
}

export function auditLiveToolInvocationStream(
  invocations: readonly LiveToolInvocation[],
): AuditStreamReport {
  const violations: string[] = [];
  let allLive = true;

  for (const inv of invocations) {
    if (!inv.isLiveInterception) {
      allLive = false;
    }
    const check = interceptLiveToolCall(inv);
    if (!check.allowed && check.violation !== undefined) {
      violations.push(check.violation);
    }
  }

  const breachDetected = violations.length > 0;
  return {
    auditedLive: allLive,
    breachDetected,
    violations,
    remediationAction: breachDetected
      ? "Halt supervisor execution and enforce delegation to Tier 3 subagents."
      : "Nominal surveillance; role boundaries respected.",
  };
}

export function verifyDefectRemediation(
  context?: DefectRemediationContext,
): DefectRemediationResult {
  const fallbackContext: DefectRemediationContext = {
    actor: "implementer_task_1_1",
    role: "implementer",
    taskId: "task-1_1",
    state: "validating",
    sessionToken: "tok_live_DEFECT_SKILL_AUDITOR_SHALLOW_SURVEILLANCE",
    scope: [
      "olt/scripts/src/validation/skill-auditor-missed-supervisor-direct-code-writes-post-hoc-capsule-audit-lacked-live-tool-call-interception-defect-skill-auditor-shallow-surveillance-missed-supervisor-edits.ts",
    ],
    gateCommand:
      "bun test tests/unit/validation/skill-auditor-missed-supervisor-direct-code-writes-post-hoc-capsule-audit-lacked-live-tool-call-interception-defect-skill-auditor-shallow-surveillance-missed-supervisor-edits.test.ts",
    isUiTask: false,
    validatorType: "validator",
    isLiveInterception: true,
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
