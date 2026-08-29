import type { GateCoverageProbeResult } from "./types.ts";
import { isIdentifier, isNonblank, isRepoRelativePath } from "../../../requirements/predicates.ts";
import { isRecord } from "../../store/layout/layout-json.ts";
import { NOOP_COMMANDS } from "./tasks-advanced.ts";

export function probeGateCoverageViolations(state: unknown): GateCoverageProbeResult {
  const uncoveredRequirementIds: string[] = [];
  const tasksWithoutGateCoverage: string[] = [];
  const invalidGates: string[] = [];
  const details: string[] = [];
  let hasMandatoryRunGate = false;

  if (!isRecord(state)) {
    return {
      passed: true,
      uncoveredRequirementIds: [],
      tasksWithoutGateCoverage: [],
      invalidGates: [],
      hasMandatoryRunGate: false,
      details: [],
    };
  }

  const gates = (
    isRecord(state.graph) && Array.isArray(state.graph.gates)
      ? state.graph.gates
      : Array.isArray(state.gates)
        ? state.gates
        : []
  ) as Record<string, unknown>[];

  const coveredReqs = new Set<string>();

  gates.forEach((gate, idx) => {
    const prefix = `Gate[${idx}]`;
    if (!isRecord(gate)) {
      invalidGates.push(`${prefix} is not an object`);
      return;
    }

    const gateId = typeof gate.id === "string" ? gate.id : `gate-${idx}`;
    if (!isIdentifier(gateId)) {
      invalidGates.push(`${prefix} has invalid identifier '${gateId}'`);
    }

    const cmd = gate.command;
    const isCmdValid =
      isNonblank(cmd) || (Array.isArray(cmd) && cmd.length > 0 && cmd.every(isNonblank));
    if (!isCmdValid) {
      invalidGates.push(`Gate '${gateId}' has empty or non-blank command`);
    } else if (typeof cmd === "string" && NOOP_COMMANDS.has(cmd.trim().toLowerCase())) {
      invalidGates.push(`Gate '${gateId}' has weak non-substantive command '${cmd}'`);
    }

    if (gate.cwd !== undefined && !isRepoRelativePath(gate.cwd, true)) {
      invalidGates.push(
        `Gate '${gateId}' cwd '${String(gate.cwd)}' is not a normalized relative path`,
      );
    }

    if (gate.scope !== "task" && gate.scope !== "run") {
      invalidGates.push(
        `Gate '${gateId}' has invalid scope '${String(gate.scope)}' (must be 'task' or 'run')`,
      );
    }

    const reqIds = Array.isArray(gate.requirement_ids) ? gate.requirement_ids : [];
    if (gate.scope === "task") {
      if (reqIds.length === 0) {
        invalidGates.push(`Task gate '${gateId}' has empty requirement_ids`);
      } else {
        for (const req of reqIds) {
          if (typeof req === "string") {
            coveredReqs.add(req);
          }
        }
      }
    } else if (gate.scope === "run") {
      if (gate.mandatory === true) {
        hasMandatoryRunGate = true;
      }
      if (reqIds.length > 0) {
        invalidGates.push(`Run gate '${gateId}' must not have requirement_ids`);
      }
    }
  });

  // Verify task coverage
  if (isRecord(state.tasks)) {
    for (const [taskId, rawTask] of Object.entries(state.tasks)) {
      if (!isRecord(rawTask)) continue;
      const reqIds = Array.isArray(rawTask.requirement_ids) ? rawTask.requirement_ids : [];
      for (const req of reqIds) {
        if (typeof req === "string" && !coveredReqs.has(req) && !hasMandatoryRunGate) {
          if (!uncoveredRequirementIds.includes(req)) {
            uncoveredRequirementIds.push(req);
          }
          if (!tasksWithoutGateCoverage.includes(taskId)) {
            tasksWithoutGateCoverage.push(taskId);
            details.push(
              `Task '${taskId}' requirement '${req}' is not covered by any task gate or mandatory run gate.`,
            );
          }
        }
      }
    }
  }

  const passed = invalidGates.length === 0 && uncoveredRequirementIds.length === 0;

  return {
    passed,
    uncoveredRequirementIds,
    tasksWithoutGateCoverage,
    invalidGates,
    hasMandatoryRunGate,
    details,
  };
}
