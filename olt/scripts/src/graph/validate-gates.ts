import { isIdentifier, isNonblank, isRepoRelativePath } from "../requirements/predicates.ts";
import { commandIsWeak } from "./gate-command-policy.ts";

function validCommand(value: unknown): boolean {
  return isNonblank(value) || (Array.isArray(value) && value.length > 0 && value.every(isNonblank));
}

export function validateGates(
  gates: readonly Record<string, unknown>[],
  requirementIds: ReadonlySet<string>,
  issues: string[],
): { taskCoverage: Set<string>; hasMandatoryRun: boolean } {
  const gateIds = new Set<string>();
  const taskCoverage = new Set<string>();
  let hasMandatoryRun = false;
  gates.forEach((gate, index) => {
    const prefix = `gates[${index}]`;
    if (!isIdentifier(gate.id)) issues.push(`${prefix}.id must be a valid identifier`);
    else if (gateIds.has(gate.id)) issues.push(`duplicate gate id: ${gate.id}`);
    else gateIds.add(gate.id);
    if (!validCommand(gate.command)) issues.push(`${prefix}.command must be non-blank`);
    else if (commandIsWeak(gate.command))
      issues.push(`${prefix}.command must perform substantive verification`);
    if (!isRepoRelativePath(gate.cwd, true))
      issues.push(`${prefix}.cwd must be a normalized repository-relative path`);
    if (gate.scope !== "task" && gate.scope !== "run")
      issues.push(`${prefix}.scope must be task or run`);
    if (typeof gate.mandatory !== "boolean") issues.push(`${prefix}.mandatory must be a bool`);
    if (!Array.isArray(gate.requirement_ids)) {
      issues.push(`${prefix}.requirement_ids must be a list`);
      return;
    }
    if (gate.scope === "task" && gate.requirement_ids.length === 0)
      issues.push(`${prefix}.requirement_ids must be non-empty for a task gate`);
    if (gate.scope === "run" && gate.requirement_ids.length > 0)
      issues.push(`${prefix}.requirement_ids must be empty for a run gate`);
    const referenced = new Set<string>();
    for (const id of gate.requirement_ids) {
      if (typeof id !== "string" || !requirementIds.has(id))
        issues.push(`${prefix} references unknown requirement`);
      else if (referenced.has(id)) issues.push(`${prefix} repeats requirement ${id}`);
      else {
        referenced.add(id);
        if (gate.scope === "task" && gate.mandatory === true) taskCoverage.add(id);
      }
    }
    if (gate.scope === "run" && gate.mandatory === true) hasMandatoryRun = true;
  });
  return { taskCoverage, hasMandatoryRun };
}
