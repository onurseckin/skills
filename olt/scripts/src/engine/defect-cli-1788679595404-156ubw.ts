import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  AUTHORIZED_ROLES_FOR_TASK_ABANDON,
  IMPLEMENTER_COMMANDS,
  type ImplementerYamlContract,
  IMPLEMENTER_YAML_CONTRACT,
  type FormatImplementerGuardErrorOptions,
  formatImplementerGuardError,
  type RoleBoundaryGuardVerdict,
  type RoleBoundaryGuardOptions,
  guardRoleTaskBoundary,
} from "./defect-cli-1788679595404-156ubw-core.ts";

export {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  AUTHORIZED_ROLES_FOR_TASK_ABANDON,
  IMPLEMENTER_COMMANDS,
  type ImplementerYamlContract,
  IMPLEMENTER_YAML_CONTRACT,
  type FormatImplementerGuardErrorOptions,
  formatImplementerGuardError,
  type RoleBoundaryGuardVerdict,
  type RoleBoundaryGuardOptions,
  guardRoleTaskBoundary,
};

export interface Defect1788679595404156ubwResult {
  readonly defectId: string;
  readonly errorCode: string;
  readonly remediated: boolean;
  readonly allowed: boolean;
  readonly errors: readonly string[];
  readonly verdicts: readonly RoleBoundaryGuardVerdict[];
}

export interface AuditImplementerGuardOptions {
  readonly agentId?: string;
  readonly role?: string;
  readonly command?: string;
}

export function auditImplementerGuardInterlock(
  options?: AuditImplementerGuardOptions,
): Defect1788679595404156ubwResult {
  const verdicts: RoleBoundaryGuardVerdict[] = [];
  const errors: string[] = [];

  let targetRole =
    options !== undefined && options.role !== undefined ? options.role : "implementer";
  let targetCommand =
    options !== undefined && options.command !== undefined ? options.command : "task:abandon";
  let targetAgentId =
    options !== undefined && options.agentId !== undefined ? options.agentId : "implementer_guard";

  const targetVerdict = guardRoleTaskBoundary(targetRole, targetCommand, targetAgentId);
  verdicts.push(targetVerdict);

  if (targetRole === "implementer" && targetCommand === "task:abandon") {
    if (targetVerdict.allowed) {
      errors.push("Implementer role must not be allowed to invoke task:abandon");
    }
    if (targetVerdict.errorCode !== ERROR_CODE) {
      const codeStr = targetVerdict.errorCode !== undefined ? targetVerdict.errorCode : "none";
      errors.push(`Expected errorCode ${ERROR_CODE} but got ${codeStr}`);
    }
  } else if (targetRole === "coordinator" && targetCommand === "task:abandon") {
    if (!targetVerdict.allowed) {
      errors.push("Coordinator role should be allowed to invoke task:abandon");
    }
  }

  const baselineImplementerAbandon = guardRoleTaskBoundary(
    "implementer",
    "task:abandon",
    "implementer_guard",
  );
  verdicts.push(baselineImplementerAbandon);
  if (baselineImplementerAbandon.allowed) {
    errors.push("Baseline check failed: implementer invoked task:abandon without error");
  }

  const coordinatorVerdict = guardRoleTaskBoundary(
    "coordinator",
    "task:abandon",
    "coordinator_lead",
  );
  verdicts.push(coordinatorVerdict);
  if (!coordinatorVerdict.allowed) {
    errors.push("Baseline check failed: coordinator was blocked from task:abandon");
  }

  const implementerClaimVerdict = guardRoleTaskBoundary(
    "implementer",
    "task:claim",
    "implementer_3",
  );
  verdicts.push(implementerClaimVerdict);
  if (!implementerClaimVerdict.allowed) {
    errors.push("Baseline check failed: implementer was blocked from task:claim");
  }

  const implementerSubmitVerdict = guardRoleTaskBoundary(
    "implementer",
    "task:submit",
    "implementer_3",
  );
  verdicts.push(implementerSubmitVerdict);
  if (!implementerSubmitVerdict.allowed) {
    errors.push("Baseline check failed: implementer was blocked from task:submit");
  }

  const remediated = errors.length === 0;

  return {
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    remediated,
    allowed: remediated,
    errors,
    verdicts,
  };
}
