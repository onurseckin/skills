import { HarnessError } from "../../core/errors/index.ts";
import type { AntiLeakValidationResult, BoundaryLeakCheck, BoundaryViolation } from "./types.ts";
import {
  isCodeMutationAction,
  isCriticOrValidatorAgent,
  isCriticOrValidatorRole,
  isExecutionToolCategory,
  isMechanicValidatorRole,
  isProhibitedValidatorExecutionAction,
  isSupervisorRole,
} from "./checks.ts";

export function validateBoundaryIntegrity(
  checks: readonly BoundaryLeakCheck[] | BoundaryLeakCheck,
): AntiLeakValidationResult {
  const checkList: readonly BoundaryLeakCheck[] = Array.isArray(checks) ? checks : [checks];
  const violations: BoundaryViolation[] = [];

  for (const check of checkList) {
    const role = check.role.trim().toLowerCase();
    const isCriticOrVal = isCriticOrValidatorRole(role) || isCriticOrValidatorAgent(check.agent_id);
    const isMechanicVal =
      isMechanicValidatorRole(role) || check.agent_id.trim().toLowerCase().includes("mechanic");
    const isSup = isSupervisorRole(role);
    const action = check.action.trim().toLowerCase();
    let taskId: string;
    if (typeof check.task_id === "string" && check.task_id.trim() !== "") {
      taskId = check.task_id;
    } else {
      taskId = "unknown-task";
    }

    let targetFile: string | undefined;
    if (typeof check.target_file === "string" && check.target_file.trim() !== "") {
      targetFile = check.target_file;
    } else if (check.write_scope && check.write_scope.length > 0) {
      targetFile = check.write_scope.join(", ");
    } else {
      targetFile = undefined;
    }

    if (isCriticOrVal) {
      if (action === "task:claim" || action === "claim") {
        violations.push({
          violation_type: "validator_write_lease",
          severity: "critical",
          agent_id: check.agent_id,
          role: check.role,
          task_id: taskId,
          action: check.action,
          target_file: targetFile,
          observation: `Agent '${check.agent_id}' with role '${check.role}' attempted to claim task '${taskId}' in violation of anti-boundary-leak rule.`,
          remediation:
            "Critics and Validators are strictly prohibited from claiming code write leases or editing source files directly. Record findings via task:reject / finding:report and assign a dedicated repairer via task:assign-repairer.",
          evidence: {
            task_id: taskId,
            agent_id: check.agent_id,
            role: check.role,
            action: check.action,
          },
        });
      } else if (isCodeMutationAction(action)) {
        let fileDisplay: string;
        if (typeof targetFile === "string" && targetFile.length > 0) {
          fileDisplay = targetFile;
        } else {
          fileDisplay = "unspecified";
        }

        violations.push({
          violation_type: "critic_code_edit",
          severity: "critical",
          agent_id: check.agent_id,
          role: check.role,
          task_id: taskId,
          action: check.action,
          target_file: targetFile,
          observation: `Agent '${check.agent_id}' with role '${check.role}' attempted direct code mutation via action '${check.action}' on file '${fileDisplay}'.`,
          remediation:
            "Critics and Validators must not edit code files directly. Delegate code remediation to a designated implementer or repairer.",
          evidence: {
            task_id: taskId,
            agent_id: check.agent_id,
            role: check.role,
            action: check.action,
            target_file: targetFile,
          },
        });
      }

      // Cognitive Validator Hard-Lock check
      if (!isMechanicVal) {
        const toolCategory = check.metadata
          ? ((check.metadata["tool_category"] ?? check.metadata["toolCategory"]) as
              | string
              | undefined)
          : undefined;
        const isToolCatProhibited =
          toolCategory !== undefined && isExecutionToolCategory(toolCategory);
        const isExecAction = isProhibitedValidatorExecutionAction(action);

        if (isExecAction || isToolCatProhibited) {
          violations.push({
            violation_type: "validator_hardlock_violation",
            severity: "critical",
            agent_id: check.agent_id,
            role: check.role,
            task_id: taskId,
            action: check.action,
            target_file: targetFile,
            observation: `Cognitive Validator Hard-Lock Violation: Cognitive Validator/Critic '${check.agent_id}' with role '${check.role}' attempted command execution or test running action '${check.action}'. Cognitive Validators and Critics are strictly locked from running bash, shell commands, test runners, build tools, or package managers.`,
            remediation:
              "Cognitive Validators must evaluate tasks strictly through read-only inspection and artifact review. Test execution authority is strictly reserved for Mechanic Validators (mechanic-validator / ui-mechanic-validator).",
            evidence: {
              task_id: taskId,
              agent_id: check.agent_id,
              role: check.role,
              action: check.action,
              metadata: check.metadata,
            },
          });
        }
      }
    }

    if (isSup) {
      if (action === "task:claim" || action === "claim" || isCodeMutationAction(action)) {
        violations.push({
          violation_type: "supervisor_code_contamination",
          severity: "critical",
          agent_id: check.agent_id,
          role: check.role,
          task_id: taskId,
          action: check.action,
          target_file: targetFile,
          observation: `Supervisory agent '${check.agent_id}' with role '${check.role}' attempted code lease claim / mutation action '${check.action}'.`,
          remediation:
            "Supervisors (Tier 0 Mind, Tier 1 Orchestrator, Tier 2 Coordinator) must delegate execution to Tier 3 Implementers and must never edit code files or claim task leases.",
          evidence: {
            task_id: taskId,
            agent_id: check.agent_id,
            role: check.role,
            action: check.action,
          },
        });
      }
    }

    if (check.metadata) {
      const assignedRepairer = check.metadata["assigned_repairer"];
      const validatorId = check.metadata["validator_id"];
      if (
        typeof assignedRepairer === "string" &&
        typeof validatorId === "string" &&
        assignedRepairer === validatorId
      ) {
        violations.push({
          violation_type: "self_repair_violation",
          severity: "critical",
          agent_id: check.agent_id,
          role: check.role,
          task_id: taskId,
          action: check.action,
          target_file: targetFile,
          observation: `Validator '${validatorId}' was illegally assigned as repairer for task '${taskId}'.`,
          remediation:
            "A validator who discovers findings must not repair them (anti-boundary-leak rule). Assign a dedicated, separate repairer.",
          evidence: {
            task_id: taskId,
            validator_id: validatorId,
            assigned_repairer: assignedRepairer,
          },
        });
      }
    }
  }

  const compliant = violations.length === 0;
  const summary = compliant
    ? `Anti-boundary-leak check passed: 0 violations across ${checkList.length} check(s).`
    : `Anti-boundary-leak violation: detected ${violations.length} boundary leak violation(s).`;

  return {
    compliant,
    valid: compliant,
    violations,
    summary,
  };
}

export function assertNoBoundaryLeak(
  checks: readonly BoundaryLeakCheck[] | BoundaryLeakCheck,
): void {
  const result = validateBoundaryIntegrity(checks);
  if (!result.valid) {
    const firstViolation = result.violations.length > 0 ? result.violations[0] : undefined;
    let observationMessage: string;
    if (
      firstViolation &&
      typeof firstViolation.observation === "string" &&
      firstViolation.observation.length > 0
    ) {
      observationMessage = firstViolation.observation;
    } else {
      observationMessage = "Role confinement boundary breached";
    }

    let remediationMessage: string;
    if (
      firstViolation &&
      typeof firstViolation.remediation === "string" &&
      firstViolation.remediation.length > 0
    ) {
      remediationMessage = firstViolation.remediation;
    } else {
      remediationMessage =
        "Delegate repair to an assigned implementer/repairer via task:assign-repairer.";
    }

    const details = result.violations.map((v) => ({
      violation_type: v.violation_type,
      agent_id: v.agent_id,
      role: v.role,
      task_id: v.task_id !== undefined ? v.task_id : null,
      observation: v.observation,
      remediation: v.remediation,
    }));

    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Anti-boundary-leak rule violation: ${observationMessage}`,
      details,
      3,
      remediationMessage,
    );
  }
}
