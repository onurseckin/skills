import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import type { ObjectiveRecord, RoundRecord, RoundResult } from "./rounds-chunk1.ts";


/**
 * Refuses round opening if the prior round has a live lease or unclosed attempt/branch/pulse.
 */
export function validatePriorRoundCompleted(
  chainFromCapsulePath?: string,
  chainFromRunId?: string,
): void {
  if (!chainFromCapsulePath || !existsSync(chainFromCapsulePath)) {
    return;
  }

  const statePath = join(chainFromCapsulePath, "state.json");
  if (!existsSync(statePath)) {
    return;
  }

  try {
    const raw = readFileSync(statePath, "utf-8");
    const priorState = JSON.parse(raw) as Record<string, unknown>;
    const priorId = chainFromRunId ?? priorState.run_id ?? chainFromCapsulePath;

    // Check live task leases in prior round
    if (priorState.tasks && typeof priorState.tasks === "object") {
      const taskEntries = Object.entries(
        priorState.tasks as Record<string, Record<string, unknown>>,
      );
      for (const [taskId, task] of taskEntries) {
        if (!task || typeof task !== "object") continue;
        const status = String(task.status);
        const lease = task.lease as Record<string, unknown> | undefined;
        const isLeased =
          status === "leased" ||
          (lease !== undefined &&
            lease !== null &&
            (typeof lease.expires_at !== "string" || Date.parse(lease.expires_at) > Date.now()));

        if (isLeased) {
          throw new HarnessError(
            "INVALID_STATE",
            `prior round '${priorId}' has a live lease on task '${taskId}'; cannot open new round until prior round leases are closed`,
          );
        }
      }
    }

    // Check unclosed branch attempts in prior round
    if (priorState.branches && typeof priorState.branches === "object") {
      const branchEntries = Object.entries(
        priorState.branches as Record<string, Record<string, unknown>>,
      );
      for (const [branchId, branch] of branchEntries) {
        if (!branch || typeof branch !== "object") continue;
        const branchStatus = String(branch.status);
        if (branchStatus === "open" || branchStatus === "leased") {
          throw new HarnessError(
            "INVALID_STATE",
            `prior round '${priorId}' has an unclosed branch attempt '${branchId}'; collect or abandon it before opening a new round`,
          );
        }
      }
    }

    // Check unclosed pulse in prior round if applicable
    const pulseState = priorState.pulse as Record<string, unknown> | undefined;
    if (pulseState?.open && typeof pulseState.open === "object") {
      const openPulse = pulseState.open as Record<string, unknown>;
      const openPulseId = String(openPulse.pulse_id ?? "open-pulse");
      throw new HarnessError(
        "INVALID_STATE",
        `prior round '${priorId}' has an active unclosed pulse '${openPulseId}'; close it before opening a new round`,
      );
    }
  } catch (err) {
    if (err instanceof HarnessError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new HarnessError("INTEGRITY", `cannot read prior round state at '${statePath}': ${msg}`);
  }
}


/**
 * Enforces the Tier 1 arming rail: a round may not close without recording
 * either the next round it opened (--successor) or why the chain ended (--terminal-reason).
 */
export function validateRoundCloseArmingRail(params: {
  readonly result: RoundResult;
  readonly successor?: string | null | undefined;
  readonly terminalReason?: string | null | undefined;
}): void {
  const hasSuccessor = typeof params.successor === "string" && params.successor.trim().length > 0;
  const hasReason =
    typeof params.terminalReason === "string" && params.terminalReason.trim().length > 0;

  if (!hasSuccessor && !hasReason) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "a round may not close without either an armed successor (--successor <run-id>) or a recorded terminal reason (--terminal-reason <reason>). Tier 1 arming rail requires recording the next round or terminal reason.",
    );
  }
}


/**
 * Retrieves all rounds recorded in state.
 */
export function getAllRounds(state: Record<string, unknown>): RoundRecord[] {
  const list: RoundRecord[] = [];
  const mindState = (state.mind ?? {}) as Record<string, unknown>;

  if (Array.isArray(state.rounds)) {
    list.push(...(state.rounds as RoundRecord[]));
  }
  if (Array.isArray(mindState.rounds)) {
    for (const r of mindState.rounds as RoundRecord[]) {
      if (!list.some((existing) => existing.round_id === r.round_id)) {
        list.push(r);
      }
    }
  }

  return list;
}


/**
 * Returns any open round for a specific objective.
 */
export function getOpenRoundForObjective(
  state: Record<string, unknown>,
  objectiveId: string,
): RoundRecord | undefined {
  const all = getAllRounds(state);
  return all.find((r) => r.objective_id === objectiveId && r.status === "opened");
}


/**
 * Reconciles the round state in the capsule projection, updating objectives and active rounds.
 */
export function reconcileRoundState(
  state: Record<string, unknown>,
  objectiveId?: string,
): {
  readonly objectives: readonly ObjectiveRecord[];
  readonly activeRounds: readonly RoundRecord[];
  readonly totalRoundsCount: number;
} {
  const allRounds = getAllRounds(state);
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  const budget = (state.budget ?? mindState.budget ?? DEFAULT_MIND_BUDGET) as Record<
    string,
    unknown
  >;
  const maxRoundsPerObjective =
    typeof budget.max_rounds_per_objective === "number"
      ? budget.max_rounds_per_objective
      : (DEFAULT_MIND_BUDGET.max_rounds_per_objective ?? 3);

  // Group rounds by objective_id
  const roundsByObjective = new Map<string, RoundRecord[]>();
  for (const r of allRounds) {
    const list = roundsByObjective.get(r.objective_id) ?? [];
    list.push(r);
    roundsByObjective.set(r.objective_id, list);
  }

  const objectives: ObjectiveRecord[] = [];
  for (const [objId, rounds] of roundsByObjective.entries()) {
    if (objectiveId && objId !== objectiveId) continue;
    rounds.sort((a, b) => a.round - b.round);
    const lastRound = rounds[rounds.length - 1]!;
    const candidateId = lastRound.candidate_id;
    const statement = lastRound.statement;
    const currentRound = lastRound.round;

    let status: "active" | "converged" | "exhausted" | "escalated" = "active";
    if (lastRound.status === "closed") {
      status = lastRound.result ?? "exhausted";
    }

    objectives.push({
      id: objId,
      candidate_id: candidateId,
      statement,
      current_round: currentRound,
      max_rounds: maxRoundsPerObjective,
      status,
      rounds: [...rounds],
      created_at: rounds[0]!.opened_at,
      updated_at: lastRound.closed_at ?? lastRound.opened_at,
    });
  }

  const activeRounds = allRounds.filter((r) => r.status === "opened");

  // Keep state.rounds and state.objectives updated in state
  state.rounds = allRounds as unknown as JsonObject[];
  state.objectives = objectives as unknown as JsonObject[];
  if (state.mind && typeof state.mind === "object") {
    (state.mind as Record<string, unknown>).rounds = state.rounds;
    (state.mind as Record<string, unknown>).objectives = state.objectives;
  }

  return {
    objectives,
    activeRounds,
    totalRoundsCount: allRounds.length,
  };
}
