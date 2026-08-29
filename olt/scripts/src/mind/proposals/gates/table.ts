import { DEFAULT_MIND_BUDGET } from "../../lifecycle/charter/index.ts";
import { readArchivedObjectives, type ArchivedObjectiveRecord } from "../../archival/index.ts";
import { resolve } from "node:path";
import { scopeConflict } from "../../../engine/scheduler/index.ts";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { CandidateRecord, AdmissionGateVerdict, GateEvaluationContext } from "./types.ts";
import {
  PROPOSAL_WITNESS_OWNER_DECISION,
  PROPOSAL_WITNESS_AUTONOMOUS_INITIATIVE,
} from "../proposal/index.ts";
export function evaluateGate5Affordable(
  candidate: CandidateRecord,
  context: GateEvaluationContext,
): AdmissionGateVerdict {
  const gateId = "gate-5-affordable";
  const gateNumber = 5;
  const name = "Affordable";

  if (!candidate || !candidate.id) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: "candidate id is missing",
      repairArgv: `bun harness.ts mind:observe --run ${context.runRoot}`,
    };
  }

  const mindState = (context.state.mind ?? {}) as Record<string, unknown>;
  const budget = (context.state.budget ?? mindState.budget ?? DEFAULT_MIND_BUDGET) as Record<
    string,
    unknown
  >;

  const pulsesToday = typeof budget.pulses_today === "number" ? budget.pulses_today : 0;
  const pulsesPerDay =
    typeof budget.pulses_per_day === "number"
      ? budget.pulses_per_day
      : DEFAULT_MIND_BUDGET.pulses_per_day;
  const wallClockToday =
    typeof budget.wall_clock_ms_today === "number" ? budget.wall_clock_ms_today : 0;
  const wallClockPerDay =
    typeof budget.wall_clock_ms_per_day === "number"
      ? budget.wall_clock_ms_per_day
      : DEFAULT_MIND_BUDGET.wall_clock_ms_per_day;

  if (pulsesPerDay !== null && Number.isFinite(pulsesPerDay) && pulsesToday >= pulsesPerDay) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: `daily pulse budget exhausted (${pulsesToday}/${pulsesPerDay} pulses today)`,
      repairArgv: `bun harness.ts mind:wake --run ${context.runRoot}`,
    };
  }

  if (
    wallClockPerDay !== null &&
    Number.isFinite(wallClockPerDay) &&
    wallClockToday >= wallClockPerDay
  ) {
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: `daily wall-clock budget exhausted (${wallClockToday}/${wallClockPerDay} ms today)`,
      repairArgv: `bun harness.ts mind:wake --run ${context.runRoot}`,
    };
  }

  const agents = (
    Array.isArray(context.state.agents) ? context.state.agents : []
  ) as readonly Record<string, unknown>[];
  const activeAgents = agents.filter(
    (a) => a.status === "active" && (a.role === "implementer" || a.role === "validator"),
  );
  const maxAgents =
    typeof budget.max_agents_in_flight === "number"
      ? budget.max_agents_in_flight
      : DEFAULT_MIND_BUDGET.max_agents_in_flight;

  if (maxAgents !== null && Number.isFinite(maxAgents) && activeAgents.length >= maxAgents) {
    const firstActiveId = String(activeAgents[0]?.id ?? "agent-1");
    return {
      gateId,
      gateNumber,
      name,
      passed: false,
      reason: `max agents in flight reached (${activeAgents.length}/${maxAgents})`,
      repairArgv: `bun harness.ts agent:release --run ${context.runRoot} --agent ${firstActiveId} --reason "free capacity"`,
    };
  }

  return {
    gateId,
    gateNumber,
    name,
    passed: true,
    metadata: { pulsesToday, pulsesPerDay, wallClockToday, wallClockPerDay },
  };
}

/**
 * Gate 6: Not a duplicate
 * Is there an open candidate, a live task, or a declined candidate with the same witness class and scope?
 * Decided by: harness: candidate ledger lookup.
 */
export function evaluateGate6NotADuplicate(
  candidate: CandidateRecord,
  context: GateEvaluationContext,
): AdmissionGateVerdict {
  const gateId = "gate-6-not-a-duplicate";
  const gateNumber = 6;
  const name = "Not a duplicate";

  const candidates = (
    Array.isArray(context.state.candidates) ? context.state.candidates : []
  ) as readonly CandidateRecord[];

  const scope = (candidate.write_scope ?? []) as readonly string[];
  const statementLower = candidate.statement.trim().toLowerCase();
  const witnessId = candidate.witness_command_id?.trim();

  for (const other of candidates) {
    if (other.id === candidate.id) continue;

    const otherScope = (other.write_scope ?? []) as readonly string[];
    const otherStatementLower = other.statement.trim().toLowerCase();
    const otherWitnessId = other.witness_command_id?.trim();

    if (other.status === "declined") {
      const isWitnessDup =
        witnessId &&
        otherWitnessId &&
        witnessId !== "owner-decision" &&
        witnessId === otherWitnessId;
      const isStatementScopeDup =
        statementLower === otherStatementLower && scopeConflict(scope, otherScope);
      const isProposalDup =
        candidate.kind === "proposal" &&
        other.kind === "proposal" &&
        statementLower === otherStatementLower;

      if (isWitnessDup || isStatementScopeDup || isProposalDup) {
        return {
          gateId,
          gateNumber,
          name,
          passed: false,
          reason: `candidate is a duplicate of permanently declined candidate '${other.id}' (declined reason: '${other.decline_reason ?? "declined"}')`,
          repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor}`,
        };
      }
    }

    if (other.status === "opened" || other.status === "admitted") {
      const isWitnessDup =
        witnessId &&
        otherWitnessId &&
        witnessId !== "owner-decision" &&
        witnessId === otherWitnessId;
      const isStatementScopeDup =
        statementLower === otherStatementLower && scopeConflict(scope, otherScope);

      if (isWitnessDup || isStatementScopeDup) {
        return {
          gateId,
          gateNumber,
          name,
          passed: false,
          reason: `candidate is a duplicate of active candidate '${other.id}' (${other.status})`,
          repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor}`,
        };
      }
    }
  }

  // Check live tasks
  const tasks = context.state.tasks as Record<string, Record<string, unknown>> | undefined;
  if (tasks && typeof tasks === "object") {
    for (const [taskId, task] of Object.entries(tasks)) {
      if (!task || typeof task !== "object") continue;
      const status = String(task.status);
      if (status === "ready" || status === "leased" || status === "proposed") {
        const taskLabel = typeof task.label === "string" ? task.label.trim().toLowerCase() : "";
        const taskScope = (
          Array.isArray(task.write_scope) ? task.write_scope : []
        ) as readonly string[];
        if (taskLabel === statementLower && scopeConflict(scope, taskScope)) {
          return {
            gateId,
            gateNumber,
            name,
            passed: false,
            reason: `candidate is a duplicate of live task '${taskId}'`,
            repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor}`,
          };
        }
      }
    }
  }

  // Check archived candidates for permanently declined duplicates
  const archivedCapsulesPath = resolve(context.runRoot, "..", "ARCHIVED_OBJECTIVES.jsonl");
  const capsuleLocalArchived = resolve(context.runRoot, "ARCHIVED_OBJECTIVES.jsonl");
  const archivedFiles = [archivedCapsulesPath, capsuleLocalArchived];

  for (const archFile of archivedFiles) {
    let archivedRecords: ArchivedObjectiveRecord[];
    try {
      archivedRecords = readArchivedObjectives(archFile);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown archival ledger error";
      return {
        gateId,
        gateNumber,
        name,
        passed: false,
        reason: `archived objectives ledger could not be securely scanned: ${reason}`,
        repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor}`,
      };
    }
    for (const arch of archivedRecords) {
      if (arch.id === candidate.id) continue;
      if (arch.result !== "declined") continue;
      const archScope = (arch.write_scope ?? []) as readonly string[];
      const archStatementLower = arch.statement.trim().toLowerCase();
      const archDetails = (arch.details ?? {}) as Record<string, unknown>;
      const archKind = archDetails["kind"] ?? arch.type;
      const declineReason =
        typeof archDetails["decline_reason"] === "string"
          ? archDetails["decline_reason"]
          : arch.result;

      const isStatementScopeDup =
        statementLower === archStatementLower && scopeConflict(scope, archScope);
      const isProposalDup =
        candidate.kind === "proposal" &&
        archKind === "proposal" &&
        statementLower === archStatementLower;

      if (isStatementScopeDup || isProposalDup) {
        return {
          gateId,
          gateNumber,
          name,
          passed: false,
          reason: `candidate is a duplicate of permanently declined candidate '${arch.id}' (declined reason: '${declineReason}')`,
          repairArgv: `bun harness.ts mind:candidate --run ${context.runRoot} --actor ${context.actor}`,
        };
      }
    }
  }

  return {
    gateId,
    gateNumber,
    name,
    passed: true,
  };
}

/**
 * Runs all six admission gates in order and stops at the first failure.
 */
