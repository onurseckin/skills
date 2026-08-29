import { HarnessError } from "../../core/errors/index.ts";
import type {
  AcyclicPushbackValidationParams,
  AcyclicPushbackValidationResult,
  DelegateRepairTaskParams,
  RepairDelegationOrder,
} from "./types.ts";
import { isCriticOrValidatorAgent } from "./checks.ts";

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
