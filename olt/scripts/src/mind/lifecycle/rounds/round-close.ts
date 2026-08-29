import { join } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import { enforceLineLimit } from "../cadence/types.ts";
import type {
  CloseRoundInStateOptions,
  ObjectiveRecord,
  OpenRoundInStateOptions,
  RoundRecord,
  RoundResult,
} from "./types.ts";
import {
  ROUND_RESULTS,
  carryForwardFindingsAndRequirements,
  isRoundResult,
  validateCandidateAdmitted,
  validateObjectiveStatement,
  validateRoundBudget,
} from "./types.ts";

import {
  getAllRounds,
  reconcileRoundState,
  getOpenRoundForObjective,
  validatePriorRoundCompleted,
  validateRoundCloseArmingRail,
} from "./round-open.ts";

/**
 * Records an opened round in capsule state draft.
 */
export function openRoundInState(
  state: Record<string, unknown>,
  options: OpenRoundInStateOptions,
): RoundRecord {
  const {
    objective,
    candidate: candidateId,
    actor,
    round: requestedRound,
    chainFrom,
    statement: explicitStatement,
    nowIso,
    chainFromCapsulePath,
  } = options;

  // 1. Candidate must be admitted
  const candidate = validateCandidateAdmitted(state, candidateId);

  // 2. Validate objective statement drift
  const allRounds = getAllRounds(state);
  const objectiveRounds = allRounds
    .filter((r) => r.objective_id === objective)
    .sort((a, b) => a.round - b.round);
  const priorRound =
    objectiveRounds.length > 0 ? objectiveRounds[objectiveRounds.length - 1] : undefined;

  validateObjectiveStatement(candidate, explicitStatement, priorRound?.statement);

  // 3. Prevent opening over an unclosed round for the same objective
  const activeRound = getOpenRoundForObjective(state, objective);
  if (activeRound) {
    throw new HarnessError(
      "INVALID_STATE",
      `round ${activeRound.round} is already open for objective '${objective}'; close it first with mind:round-close`,
    );
  }

  // 4. Calculate round index
  const roundIndex = requestedRound ?? (priorRound ? priorRound.round + 1 : 1);

  // 5. Validate round budget
  validateRoundBudget(state, roundIndex, objective);

  // 6. Validate prior round has no live lease or unclosed branch/attempt
  if (chainFrom || chainFromCapsulePath) {
    validatePriorRoundCompleted(chainFromCapsulePath, chainFrom);
  }

  const roundId = `round-${objective}-r${roundIndex}`;
  const statement = candidate.statement;

  const newRound: RoundRecord = {
    round_id: roundId,
    objective_id: objective,
    round: roundIndex,
    candidate_id: candidateId,
    statement,
    chain_from: chainFrom ?? null,
    target_run: chainFrom ?? null,
    status: "opened",
    result: null,
    successor: null,
    terminal_reason: null,
    opened_at: nowIso,
    closed_at: null,
    actor,
  };

  if (!Array.isArray(state.rounds)) {
    state.rounds = [];
  }
  (state.rounds as unknown[]).push(newRound);

  // Update candidate's objective_run_id if not set
  if (Array.isArray(state.candidates)) {
    const candInState = (state.candidates as Record<string, unknown>[]).find(
      (c) => c.id === candidateId,
    );
    if (candInState) {
      candInState.objective_run_id = roundId;
    }
  }

  reconcileRoundState(state, objective);

  return newRound;
}

/**
 * Records a closed round in capsule state draft.
 */
export function closeRoundInState(
  state: Record<string, unknown>,
  options: CloseRoundInStateOptions,
): RoundRecord {
  const {
    objective,
    round: roundNumber,
    actor,
    result,
    successor,
    terminalReason,
    nowIso,
  } = options;

  if (!isRoundResult(result)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `invalid round result '${String(result)}'; must be one of: ${ROUND_RESULTS.join(", ")}`,
    );
  }

  // Enforce tier 1 arming rail
  validateRoundCloseArmingRail({
    result,
    successor,
    terminalReason,
  });

  const allRounds = getAllRounds(state);
  const targetRound = allRounds.find(
    (r) => r.objective_id === objective && r.round === roundNumber,
  );

  if (!targetRound) {
    throw new HarnessError(
      "INVALID_STATE",
      `no round ${roundNumber} found for objective '${objective}'`,
    );
  }

  if (targetRound.status === "closed") {
    throw new HarnessError(
      "INVALID_STATE",
      `round ${roundNumber} for objective '${objective}' is already closed (result: ${targetRound.result ?? "unknown"})`,
    );
  }

  const updatedRound: RoundRecord = {
    ...targetRound,
    status: "closed",
    result,
    successor: successor ?? null,
    terminal_reason: terminalReason ?? null,
    closed_at: nowIso,
  };

  // Replace in state.rounds
  if (Array.isArray(state.rounds)) {
    const idx = (state.rounds as RoundRecord[]).findIndex(
      (r) => r.round_id === targetRound.round_id,
    );
    if (idx !== -1) {
      (state.rounds as unknown[])[idx] = updatedRound;
    }
  }

  reconcileRoundState(state, objective);

  return updatedRound;
}

/**
 * Formats a clean 30-line brief for mind:round-open.
 */
export function formatMindRoundOpenBrief(params: {
  readonly runRoot: string;
  readonly actor: string;
  readonly objective: string;
  readonly candidate: string;
  readonly statement: string;
  readonly round: number;
  readonly maxRounds: number;
  readonly chainFrom?: string | null | undefined;
  readonly openedAt: string;
}): string {
  const lines = [
    `### Mind Round Opened: \`${params.objective}\` (Round ${params.round})`,
    `- **Mind Capsule**: \`${params.runRoot}\``,
    `- **Actor**: \`${params.actor}\``,
    `- **Candidate**: \`${params.candidate}\``,
    `- **Statement**: "${params.statement}"`,
    `- **Round Budget**: ${params.round} / ${params.maxRounds}`,
    `- **Chained From**: ${params.chainFrom ? `\`${params.chainFrom}\`` : "none (initial round)"}`,
    `- **Opened At**: \`${params.openedAt}\``,
  ];
  return enforceLineLimit(lines.join("\n"), 30);
}

/**
 * Formats a clean 30-line brief for mind:round-close.
 */
export function formatMindRoundCloseBrief(params: {
  readonly runRoot: string;
  readonly actor: string;
  readonly objective: string;
  readonly round: number;
  readonly result: RoundResult;
  readonly successor?: string | null | undefined;
  readonly terminalReason?: string | null | undefined;
  readonly closedAt: string;
}): string {
  const lines = [
    `### Mind Round Closed: \`${params.objective}\` (Round ${params.round})`,
    `- **Mind Capsule**: \`${params.runRoot}\``,
    `- **Actor**: \`${params.actor}\``,
    `- **Result**: \`${params.result}\``,
    `- **Successor**: ${params.successor ? `\`${params.successor}\`` : "none"}`,
    `- **Terminal Reason**: ${params.terminalReason ? `"${params.terminalReason}"` : "none"}`,
    `- **Closed At**: \`${params.closedAt}\``,
  ];
  return enforceLineLimit(lines.join("\n"), 30);
}
