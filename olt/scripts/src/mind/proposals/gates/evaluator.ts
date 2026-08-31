import { join } from "node:path";
import { scopeConflict } from "../../../engine/scheduler/index.ts";
import type { CandidateRecord, AdmissionGateVerdict, GateEvaluationContext } from "./types.ts";
import { parseFalsifierArgv, executeFalsifier, isPathInRepoRoots } from "./predicates.ts";
export function evaluateGate2InCharter(
  candidate: CandidateRecord,
  context: GateEvaluationContext,
): AdmissionGateVerdict {
  const gateId = "gate-2-in-charter";
  const gateNumber = 2;
  const name = "In charter";

  const goalIds = (candidate.charter_goal_ids ?? candidate.charter_goals ?? []).filter(
    (g): g is string => typeof g === "string" && g.trim().length > 0,
  );

  if (goalIds.length === 0) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: "candidate cites no charter goals",
      repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --charter-goal G1`,
    };
  }

  const charterGoals = context.charterGoals ?? new Set(["G1"]);
  for (const goalId of goalIds) {
    if (!charterGoals.has(goalId)) {
      const known = [...charterGoals].join(", ");
      return {
        gateId,
        gateNumber,
        name,
        passed: false,
        reason: `charter goal '${goalId}' does not exist in pinned charter (known goals: ${known})`,
        repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --charter-goal ${[...charterGoals][0] ?? "G1"}`,
      };
    }
  }

  const nonGoals = context.charterNonGoals ?? [];
  const statementLower = candidate.statement.toLowerCase();
  for (const nonGoal of nonGoals) {
    const trimmed = nonGoal.trim().toLowerCase();
    if (!trimmed) continue;
    if (
      statementLower.includes(trimmed) ||
      (candidate.write_scope ?? []).some((s) => s.toLowerCase().includes(trimmed))
    ) {
      return {
        gateId,
        gateNumber,
        name,
        passed: false,
        reason: `candidate matches charter non-goal '${nonGoal}'`,
        repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor}`,
      };
    }
  }

  return {
    gateId,
    gateNumber,
    name,
    passed: true,
    metadata: { goals: goalIds },
  };
}

/**
 * Gate 3: Falsifiable
 * Is there a command that fails now and would pass if this were fixed?
 * Decided by: agent declares it; harness runs it now and requires non-zero.
 */
export function evaluateGate3Falsifiable(
  candidate: CandidateRecord,
  context: GateEvaluationContext,
): AdmissionGateVerdict {
  const gateId = "gate-3-falsifiable";
  const gateNumber = 3;
  const name = "Falsifiable";

  if (candidate.kind === "proposal") {
    return {
      gateId,
      gateNumber,
      name,
      passed: true,
      metadata: { kind: "proposal" },
    };
  }

  const argv = parseFalsifierArgv(candidate.falsifier_argv ?? candidate.falsifier);
  if (argv.length === 0) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: "candidate has no falsifier argv declared",
      repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --falsifier "<failing command>"`,
    };
  }

  const result = executeFalsifier(argv, context.repoRoot, context.falsifierTimeoutMs);
  if (result.exitCode === 0) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: `falsifier command '${argv.join(" ")}' exited with 0; a falsifier must fail (exit non-zero) before the defect is fixed`,
      repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --falsifier "<failing-command>"`,
      metadata: { exitCode: 0, argv },
    };
  }

  const exitCodeObserved = result.exitCode ?? 1;
  return {
    gateId,
    gateNumber,
    name,
    passed: true,
    metadata: { exitCode: exitCodeObserved, argv },
  };
}

/**
 * Gate 4: Scoped
 * Is the write scope narrow, disjoint from every live lease, inside the charter's repo roots?
 * Decided by: harness: scopeConflict + charter roots.
 */
export function evaluateGate4Scoped(
  candidate: CandidateRecord,
  context: GateEvaluationContext,
): AdmissionGateVerdict {
  const gateId = "gate-4-scoped";
  const gateNumber = 4;
  const name = "Scoped";

  const scope = (candidate.write_scope ?? []).filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );

  if (scope.length === 0) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: "candidate write scope is empty",
      repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --write-scope <path>`,
    };
  }

  const repoRoots = context.repoRoots && context.repoRoots.length > 0 ? context.repoRoots : ["."];
  for (const path of scope) {
    if (!isPathInRepoRoots(path, repoRoots, context.repoRoot)) {
      return {
        gateId,
        gateNumber,
        name,
        passed: false,
        reason: `write scope '${path}' is outside charter repo_roots (${repoRoots.join(", ")})`,
        repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --write-scope ${repoRoots[0] ?? "."}`,
      };
    }
  }

  // Conflict against live leases in state.tasks
  const tasks = context.state.tasks as Record<string, Record<string, unknown>> | undefined;
  if (tasks && typeof tasks === "object") {
    for (const [taskId, task] of Object.entries(tasks)) {
      if (!task || typeof task !== "object") continue;
      const status = task.status;
      const lease = task.lease as Record<string, unknown> | undefined;
      const isLeased =
        status === "leased" ||
        (lease !== undefined &&
          lease !== null &&
          (typeof lease.expires_at !== "string" || Date.parse(lease.expires_at) > Date.now()));

      if (isLeased) {
        const taskScope = (
          Array.isArray(lease?.write_scope)
            ? lease.write_scope
            : Array.isArray(task.write_scope)
              ? task.write_scope
              : []
        ) as readonly string[];

        if (scopeConflict(scope, taskScope)) {
          return {
            gateId,
            gateNumber,
            name,
            passed: false,
            reason: `write scope conflicts with live task lease '${taskId}' (${taskScope.join(", ")})`,
            repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --write-scope <disjoint-path>`,
          };
        }
      }
    }
  }

  // Conflict against other open/admitted candidates
  const candidates = (
    Array.isArray(context.state.candidates) ? context.state.candidates : []
  ) as readonly CandidateRecord[];
  for (const other of candidates) {
    if (other.id !== candidate.id && (other.status === "opened" || other.status === "admitted")) {
      const otherScope = (other.write_scope ?? []) as readonly string[];
      if (scopeConflict(scope, otherScope)) {
        return {
          gateId,
          gateNumber,
          name,
          passed: false,
          reason: `write scope conflicts with active candidate '${other.id}' (${otherScope.join(", ")})`,
          repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor} --write-scope <disjoint-path>`,
        };
      }
    }
  }

  return {
    gateId,
    gateNumber,
    name,
    passed: true,
    metadata: { writeScope: scope },
  };
}

/**
 * Gate 5: Affordable
 * Does the remaining budget cover the declared round budget?
 * Decided by: harness: arithmetic on the budget ledger.
 */
