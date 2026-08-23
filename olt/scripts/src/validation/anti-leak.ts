import { HarnessError } from "../core/errors/harness-error.ts";

export type BoundaryViolationType =
  | "role_confinement_violation"
  | "critic_code_edit"
  | "validator_write_lease"
  | "supervisor_code_contamination"
  | "self_repair_violation"
  | "cross_tier_boundary_leak"
  | "validator_hardlock_violation";

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
  readonly reason?:
    | "repeated_failure"
    | "stale"
    | "unavailable"
    | "finding_remediation"
    | undefined;
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

export const PROHIBITED_COGNITIVE_CATEGORIES: ReadonlySet<string> = new Set([
  "shell",
  "test-runner",
  "build",
  "package-manager",
  "bash",
  "terminal",
  "exec",
]);

export const PROHIBITED_COGNITIVE_ACTIONS: ReadonlySet<string> = new Set([
  "run:exec",
  "exec",
  "shell",
  "test-runner",
  "build",
  "package-manager",
  "bash",
  "sh",
  "zsh",
  "run_command",
  "bun test",
  "npm test",
  "pytest",
  "vitest",
  "jest",
  "cargo",
]);

export function isMechanicValidatorRole(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  return (
    normalized === "mechanic-validator" ||
    normalized === "ui-mechanic-validator" ||
    normalized === "mechanic_validator" ||
    normalized.startsWith("mechanic-") ||
    normalized.endsWith("-mechanic-validator")
  );
}

export function isCognitiveValidatorRole(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  if (isMechanicValidatorRole(normalized)) return false;
  return (
    normalized === "validator" ||
    normalized === "ui-validator" ||
    normalized.startsWith("validator-")
  );
}

export function isExecutionToolCategory(category: string): boolean {
  return PROHIBITED_COGNITIVE_CATEGORIES.has(category.trim().toLowerCase());
}

export function isProhibitedValidatorExecutionAction(action: string): boolean {
  const normalized = action.trim().toLowerCase();
  if (PROHIBITED_COGNITIVE_ACTIONS.has(normalized)) return true;
  return (
    normalized.startsWith("run:exec") ||
    normalized.startsWith("bun test") ||
    normalized.startsWith("npm test") ||
    normalized.startsWith("pytest") ||
    normalized.startsWith("cargo test") ||
    normalized.includes("test-runner") ||
    normalized.includes("run_command")
  );
}

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
  const isMechanicVal =
    isMechanicValidatorRole(role) || check.agent_id.trim().toLowerCase().includes("mechanic");
  const isSup = isSupervisorRole(role);
  const action = check.action.trim().toLowerCase();
  const hasWriteScope =
    (check.write_scope && check.write_scope.length > 0) || Boolean(check.target_file);

  // 1. Critic or Validator attempting code write lease / task:claim
  if (
    isCriticOrVal &&
    (action === "task:claim" || action === "task:submit" || action === "claim")
  ) {
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

  // 6. Cognitive Validator Hard-Lock: Cognitive Validator / Critic attempting execution / shell / test commands
  if (isCriticOrVal && !isMechanicVal) {
    if (isProhibitedValidatorExecutionAction(action)) {
      return true;
    }
    if (check.metadata) {
      const toolCategory = check.metadata["tool_category"] ?? check.metadata["toolCategory"];
      if (typeof toolCategory === "string" && isExecutionToolCategory(toolCategory)) {
        return true;
      }
      const toolName = check.metadata["tool_name"] ?? check.metadata["tool"];
      if (
        typeof toolName === "string" &&
        (PROHIBITED_COGNITIVE_ACTIONS.has(toolName.toLowerCase().trim()) ||
          isExecutionToolCategory(toolName))
      ) {
        return true;
      }
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

export interface AcyclicPushbackValidationParams {
  readonly taskId: string;
  readonly validatorId: string;
  readonly assignedRepairer?: string | undefined;
  readonly observation?: string | undefined;
  readonly remediation?: string | undefined;
  readonly findings?: readonly unknown[] | undefined;
  readonly repairRound?: number | undefined;
  readonly dependencyGraph?: Readonly<Record<string, readonly string[]>> | undefined;
}

export interface AcyclicPushbackValidationResult {
  readonly valid: boolean;
  readonly acyclic: boolean;
  readonly structured: boolean;
  readonly violations: readonly string[];
  readonly remediation_guidance?: string | undefined;
}

export function detectGraphCycles(graph: Readonly<Record<string, readonly string[]>>): {
  hasCycle: boolean;
  cyclePath?: string[];
} {
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): boolean {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    const neighbors = graph[node] !== undefined ? graph[node] : [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recStack.has(neighbor)) {
        path.push(neighbor);
        return true;
      }
    }

    recStack.delete(node);
    path.pop();
    return false;
  }

  for (const node of Object.keys(graph)) {
    if (!visited.has(node)) {
      if (dfs(node)) {
        return { hasCycle: true, cyclePath: [...path] };
      }
    }
  }

  return { hasCycle: false };
}

export function validateAcyclicPushbackDelegation(
  params: AcyclicPushbackValidationParams,
): AcyclicPushbackValidationResult {
  const violations: string[] = [];
  let structured = true;
  let acyclic = true;

  const taskId = params.taskId;
  const validatorId = params.validatorId;
  const assignedRepairer = params.assignedRepairer;

  if (!taskId || taskId.trim() === "") {
    violations.push("taskId must be a non-empty string");
    structured = false;
  }

  if (!validatorId || validatorId.trim() === "") {
    violations.push("validatorId must be a non-empty string");
    structured = false;
  }

  // 1. Structured observation & remediation validation
  if (params.observation !== undefined && params.observation.trim().length === 0) {
    violations.push("Pushback observation must not be empty");
    structured = false;
  }

  if (params.remediation !== undefined && params.remediation.trim().length === 0) {
    violations.push("Pushback remediation must provide non-empty actionable instructions");
    structured = false;
  }

  // 2. Findings structure validation
  if (params.findings && params.findings.length > 0) {
    for (let i = 0; i < params.findings.length; i++) {
      const f = params.findings[i];
      if (typeof f !== "object" || f === null) {
        violations.push(`Finding at index ${i} is not a valid object`);
        structured = false;
        continue;
      }
      const rec = f as Record<string, unknown>;
      if (!rec["id"] || typeof rec["id"] !== "string" || rec["id"].trim().length === 0) {
        violations.push(`Finding at index ${i} missing stable non-empty 'id'`);
        structured = false;
      }
      const findingLabel = typeof rec["id"] === "string" ? rec["id"] : String(i);
      if (
        !rec["remediation"] ||
        typeof rec["remediation"] !== "string" ||
        rec["remediation"].trim().length === 0
      ) {
        violations.push(`Finding '${findingLabel}' missing non-empty 'remediation' instructions`);
        structured = false;
      }
      if (
        !rec["observation"] ||
        typeof rec["observation"] !== "string" ||
        rec["observation"].trim().length === 0
      ) {
        violations.push(`Finding '${findingLabel}' missing non-empty 'observation'`);
        structured = false;
      }
    }
  }

  // 3. Acyclic repairer delegation (prevent self-repair 1-agent cycle)
  if (assignedRepairer && validatorId && assignedRepairer.trim() === validatorId.trim()) {
    violations.push(
      `Circular delegation violation: assigned repairer '${assignedRepairer}' matches rejecting validator '${validatorId}'`,
    );
    acyclic = false;
  }

  if (assignedRepairer && isCriticOrValidatorAgent(assignedRepairer)) {
    violations.push(
      `Role confinement violation: repairer '${assignedRepairer}' cannot be a validator/critic agent`,
    );
    acyclic = false;
  }

  // 4. DAG Cycle Detection
  if (params.dependencyGraph) {
    const cycleCheck = detectGraphCycles(params.dependencyGraph);
    if (cycleCheck.hasCycle) {
      const cycleStr = cycleCheck.cyclePath !== undefined ? cycleCheck.cyclePath.join(" -> ") : "";
      violations.push(`Circular DAG dependency detected: cycle along path [${cycleStr}]`);
      acyclic = false;
    }
  }

  const valid = violations.length === 0;
  return {
    valid,
    acyclic,
    structured,
    violations,
    remediation_guidance: valid
      ? undefined
      : "Ensure all pushbacks provide structured remediation instructions and assign disjoint repairers without cyclic dependencies.",
  };
}

export function assertAcyclicPushbackDelegation(params: AcyclicPushbackValidationParams): void {
  const result = validateAcyclicPushbackDelegation(params);
  if (!result.valid) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Acyclic pushback delegation failure: ${result.violations.join("; ")}`,
      result.violations.map((v) => ({ violation: v })),
      3,
      result.remediation_guidance !== undefined
        ? result.remediation_guidance
        : "Provide structured remediation and eliminate circular dependencies.",
    );
  }
}
