import { HarnessError } from "../errors/harness-error.ts";

export type BoundaryViolationType =
  | "role_confinement_violation"
  | "critic_code_edit"
  | "validator_write_lease"
  | "supervisor_code_contamination"
  | "self_repair_violation"
  | "cross_tier_boundary_leak";

export type BoundaryViolationSeverity = "critical" | "important" | "minor";

export interface BoundaryLeakCheck {
  readonly agent_id: string;
  readonly role: string;
  readonly action: string;
  readonly write_scope?: readonly string[] | undefined;
  readonly task_id?: string | undefined;
  readonly target_file?: string | undefined;
  readonly findings?: readonly unknown[] | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface BoundaryViolation {
  readonly violation_type: BoundaryViolationType;
  readonly severity: BoundaryViolationSeverity;
  readonly agent_id: string;
  readonly role: string;
  readonly task_id?: string | undefined;
  readonly action?: string | undefined;
  readonly target_file?: string | undefined;
  readonly observation: string;
  readonly remediation: string;
  readonly evidence?: Readonly<Record<string, unknown>> | undefined;
}

export interface RepairDelegationOrder {
  readonly task_id: string;
  readonly original_implementer: string;
  readonly assigned_repairer: string;
  readonly validator_id?: string | undefined;
  readonly finding_ids?: readonly string[] | undefined;
  readonly write_scope: readonly string[];
  readonly reason: "repeated_failure" | "stale" | "unavailable" | "finding_remediation";
  readonly repair_round: number;
  readonly command: string;
  readonly generated_at: string;
}

export interface AntiLeakValidationResult {
  readonly compliant: boolean;
  readonly valid: boolean;
  readonly violations: readonly BoundaryViolation[];
  readonly delegation_orders?: readonly RepairDelegationOrder[] | undefined;
  readonly summary?: string | undefined;
}

export interface DelegateRepairTaskParams {
  readonly taskId: string;
  readonly originalImplementer: string;
  readonly assignedRepairer?: string | undefined;
  readonly validatorId?: string | undefined;
  readonly findingIds?: readonly string[] | undefined;
  readonly writeScope: readonly string[];
  readonly repairRound?: number | undefined;
  readonly reason?: "repeated_failure" | "stale" | "unavailable" | "finding_remediation" | undefined;
  readonly runRoot?: string | undefined;
}

export const CODE_MUTATION_ACTIONS: ReadonlySet<string> = new Set([
  "write_to_file",
  "replace_file_content",
  "edit_file",
  "apply_diff",
  "patch",
  "create_file",
  "delete_file",
  "file_writer",
  "code_editor",
]);

export const SUPERVISORY_ROLES: ReadonlySet<string> = new Set([
  "mind",
  "orchestrator",
  "coordinator",
  "architect",
  "planner",
  "supervisor",
]);

export function isCriticOrValidatorRole(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  return (
    normalized === "validator" ||
    normalized === "completeness-critic" ||
    normalized === "critic" ||
    normalized === "sub-validator" ||
    normalized === "plan-validator" ||
    normalized.startsWith("validator-") ||
    normalized.startsWith("critic-") ||
    normalized.endsWith("-validator") ||
    normalized.endsWith("-critic")
  );
}

export function isCriticOrValidatorAgent(agentId: string): boolean {
  const normalized = agentId.trim().toLowerCase();
  return (
    normalized.startsWith("val-") ||
    normalized.startsWith("validator-") ||
    normalized.startsWith("validator_") ||
    normalized.startsWith("critic-") ||
    normalized.startsWith("critic_") ||
    /^val/i.test(normalized) ||
    /^critic/i.test(normalized)
  );
}

export function isSupervisorRole(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  if (SUPERVISORY_ROLES.has(normalized)) return true;
  return (
    normalized.startsWith("mind-") ||
    normalized.startsWith("coord-") ||
    normalized.startsWith("coordinator-") ||
    normalized.startsWith("orch-") ||
    normalized.startsWith("orchestrator-")
  );
}

export function isCodeMutationAction(action: string): boolean {
  const normalized = action.trim().toLowerCase();
  if (CODE_MUTATION_ACTIONS.has(normalized)) return true;
  return (
    normalized.includes("write") ||
    normalized.includes("edit") ||
    normalized.includes("patch") ||
    normalized.includes("replace")
  );
}

export function isBoundaryLeakViolation(check: BoundaryLeakCheck): boolean {
  const role = check.role.trim().toLowerCase();
  const isCriticOrVal = isCriticOrValidatorRole(role) || isCriticOrValidatorAgent(check.agent_id);
  const isSup = isSupervisorRole(role);
  const action = check.action.trim().toLowerCase();
  const hasWriteScope = (check.write_scope && check.write_scope.length > 0) || Boolean(check.target_file);

  // 1. Critic or Validator attempting code write lease / task:claim
  if (isCriticOrVal && (action === "task:claim" || action === "task:submit" || action === "claim")) {
    return true;
  }

  // 2. Critic or Validator attempting direct code mutation
  if (isCriticOrVal && isCodeMutationAction(action)) {
    return true;
  }

  // 3. Critic or Validator claiming task with non-empty write scope
  if (isCriticOrVal && hasWriteScope && (action === "task:claim" || action === "claim")) {
    return true;
  }

  // 4. Supervisory role (Tier 0/1/2) claiming task write lease or mutating code
  if (isSup && (action === "task:claim" || action === "claim" || isCodeMutationAction(action))) {
    return true;
  }

  // 5. Metadata indicating self-repair or validator-as-repairer assignment
  if (check.metadata) {
    const assignedRepairer = check.metadata["assigned_repairer"];
    const validatorId = check.metadata["validator_id"];
    if (
      typeof assignedRepairer === "string" &&
      typeof validatorId === "string" &&
      assignedRepairer === validatorId
    ) {
      return true;
    }
  }

  return false;
}

export function validateBoundaryIntegrity(
  checks: readonly BoundaryLeakCheck[] | BoundaryLeakCheck,
): AntiLeakValidationResult {
  const checkList: readonly BoundaryLeakCheck[] = Array.isArray(checks) ? checks : [checks];
  const violations: BoundaryViolation[] = [];

  for (const check of checkList) {
    const role = check.role.trim().toLowerCase();
    const isCriticOrVal = isCriticOrValidatorRole(role) || isCriticOrValidatorAgent(check.agent_id);
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

export function assertNoBoundaryLeak(checks: readonly BoundaryLeakCheck[] | BoundaryLeakCheck): void {
  const result = validateBoundaryIntegrity(checks);
  if (!result.valid) {
    const firstViolation = result.violations.length > 0 ? result.violations[0] : undefined;
    let observationMessage: string;
    if (firstViolation && typeof firstViolation.observation === "string" && firstViolation.observation.length > 0) {
      observationMessage = firstViolation.observation;
    } else {
      observationMessage = "Role confinement boundary breached";
    }

    let remediationMessage: string;
    if (firstViolation && typeof firstViolation.remediation === "string" && firstViolation.remediation.length > 0) {
      remediationMessage = firstViolation.remediation;
    } else {
      remediationMessage = "Delegate repair to an assigned implementer/repairer via task:assign-repairer.";
    }

    const details = result.violations.map((v) => ({
      violation_type: v.violation_type,
      agent_id: v.agent_id,
      role: v.role,
      task_id: v.task_id ?? null,
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

export function delegateRepairTask(params: DelegateRepairTaskParams): RepairDelegationOrder {
  const taskId = params.taskId;
  const originalImplementer = params.originalImplementer;
  const assignedRepairer = params.assignedRepairer;
  const validatorId = params.validatorId;
  const findingIds = params.findingIds;
  const writeScope = params.writeScope;

  let repairRound: number;
  if (typeof params.repairRound === "number") {
    repairRound = params.repairRound;
  } else {
    repairRound = 1;
  }

  let reason: "repeated_failure" | "stale" | "unavailable" | "finding_remediation";
  if (params.reason !== undefined) {
    reason = params.reason;
  } else {
    reason = "finding_remediation";
  }

  let runRoot: string;
  if (typeof params.runRoot === "string" && params.runRoot.trim() !== "") {
    runRoot = params.runRoot;
  } else {
    runRoot = ".capsules/run-gen3-authority-evolution";
  }

  if (!taskId || taskId.trim() === "") {
    throw new HarnessError("INVALID_ARGUMENT", "taskId must be a non-empty string");
  }
  if (!originalImplementer || originalImplementer.trim() === "") {
    throw new HarnessError("INVALID_ARGUMENT", "originalImplementer must be a non-empty string");
  }
  if (!writeScope || writeScope.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "writeScope must contain at least one target path");
  }

  const designatedRepairer =
    assignedRepairer && assignedRepairer.trim() !== ""
      ? assignedRepairer.trim()
      : `repairer-${taskId.replace(/^task-/, "")}`;

  if (validatorId && designatedRepairer === validatorId) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Anti-boundary-leak rule violation: designated repairer '${designatedRepairer}' cannot be the validator '${validatorId}' of task '${taskId}'.`,
      [{ taskId, validatorId, designatedRepairer }],
      3,
      "Assign a distinct dedicated repairer or return to the original implementer.",
    );
  }

  // Pre-validate that designated repairer is not a validator agent by name
  if (isCriticOrValidatorAgent(designatedRepairer)) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Anti-boundary-leak rule violation: repairer '${designatedRepairer}' matches critic/validator naming pattern and cannot hold a write lease.`,
      [{ taskId, designatedRepairer }],
      3,
      "Repairers must use implementer or repairer roles and names.",
    );
  }

  const command = `bun harness.ts task:claim --run ${runRoot} --task ${taskId} --agent ${designatedRepairer} --role repairer`;

  return {
    task_id: taskId,
    original_implementer: originalImplementer,
    assigned_repairer: designatedRepairer,
    validator_id: validatorId,
    finding_ids: findingIds,
    write_scope: writeScope,
    reason,
    repair_round: repairRound,
    command,
    generated_at: new Date().toISOString(),
  };
}
