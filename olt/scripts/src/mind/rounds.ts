import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { JsonObject } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { chainCapsules } from "../orchestrator/capsule-chainer.ts";
import type { CapsuleChainManifest, DefectSynthesis } from "../orchestrator/types.ts";
import { enforceLineLimit } from "../cli/formatters/line-limiter.ts";
import { DEFAULT_MIND_BUDGET } from "./charter.ts";
import type { CandidateRecord } from "./gates.ts";

export type RoundResult = "converged" | "exhausted" | "escalated";
export const ROUND_RESULTS: readonly RoundResult[] = ["converged", "exhausted", "escalated"];

export function isRoundResult(val: unknown): val is RoundResult {
  return typeof val === "string" && (ROUND_RESULTS as readonly string[]).includes(val);
}

export interface CarryForwardOptions {
  readonly sourceRunId: string;
  readonly targetRunId: string;
  readonly sourceCapsulePath: string;
  readonly targetCapsulePath: string;
  readonly roundNumber: number;
  readonly defectSynthesis?: DefectSynthesis | undefined;
}

export interface RoundRecord {
  readonly round_id: string;
  readonly objective_id: string;
  readonly round: number;
  readonly candidate_id: string;
  readonly statement: string;
  readonly chain_from?: string | null | undefined;
  readonly target_run?: string | null | undefined;
  readonly status: "opened" | "closed";
  readonly result?: RoundResult | null | undefined;
  readonly successor?: string | null | undefined;
  readonly terminal_reason?: string | null | undefined;
  readonly opened_at: string;
  readonly closed_at?: string | null | undefined;
  readonly actor: string;
}

export interface ObjectiveRecord {
  readonly id: string;
  readonly candidate_id: string;
  readonly statement: string;
  readonly current_round: number;
  readonly max_rounds: number;
  readonly status: "active" | "converged" | "exhausted" | "escalated";
  readonly rounds: readonly RoundRecord[];
  readonly created_at: string;
  readonly updated_at: string;
}

export interface OpenRoundInStateOptions {
  readonly objective: string;
  readonly candidate: string;
  readonly actor: string;
  readonly round?: number | undefined;
  readonly chainFrom?: string | undefined;
  readonly statement?: string | undefined;
  readonly nowIso: string;
  readonly chainFromCapsulePath?: string | undefined;
}

export interface CloseRoundInStateOptions {
  readonly objective: string;
  readonly round: number;
  readonly actor: string;
  readonly result: RoundResult;
  readonly successor?: string | undefined;
  readonly terminalReason?: string | undefined;
  readonly nowIso: string;
}

/**
 * Builds on orchestrator/capsule-chainer to carry forward unsatisfied requirements
 * and unresolved findings into a successor round capsule.
 */
export function carryForwardFindingsAndRequirements(
  options: CarryForwardOptions,
): CapsuleChainManifest {
  return chainCapsules({
    sourceRunId: options.sourceRunId,
    targetRunId: options.targetRunId,
    sourceCapsulePath: options.sourceCapsulePath,
    targetCapsulePath: options.targetCapsulePath,
    roundNumber: options.roundNumber,
    defectSynthesis: options.defectSynthesis,
  });
}

/**
 * Resolves a capsule directory path given a run id or directory path.
 */
export function resolveCapsulePath(runOrPath: string, baseRunRoot?: string): string {
  if (existsSync(runOrPath) && lstatSync(runOrPath).isDirectory()) {
    return resolve(runOrPath);
  }
  if (baseRunRoot) {
    const capsulesDir = dirname(baseRunRoot);
    const candidate = join(capsulesDir, runOrPath);
    if (existsSync(candidate) && lstatSync(candidate).isDirectory()) {
      return resolve(candidate);
    }
  }
  return isAbsolute(runOrPath) ? runOrPath : resolve(runOrPath);
}

/**
 * Validates that candidate exists and is in admitted status.
 */
export function validateCandidateAdmitted(
  state: Record<string, unknown>,
  candidateId: string,
): CandidateRecord {
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  const candidateList: Record<string, unknown>[] = [];

  if (Array.isArray(state.candidates)) {
    candidateList.push(...(state.candidates as Record<string, unknown>[]));
  }
  if (Array.isArray(mindState.candidates)) {
    for (const item of mindState.candidates as Record<string, unknown>[]) {
      if (!candidateList.some((existing) => existing.id === item.id)) {
        candidateList.push(item);
      }
    }
  }

  const candidate = candidateList.find((c) => c.id === candidateId) as CandidateRecord | undefined;

  if (!candidate) {
    throw new HarnessError("INVALID_ARGUMENT", `unknown candidate '${candidateId}'`);
  }

  if (candidate.status !== "admitted") {
    throw new HarnessError(
      "INVALID_STATE",
      `candidate '${candidateId}' is not admitted (status: ${candidate.status}); admit it first with mind:admit`,
    );
  }

  return candidate;
}

/**
 * Validates that an objective statement has not drifted from the admitted candidate's
 * or prior round's statement. A changed objective belongs to tier 0.
 */
export function validateObjectiveStatement(
  candidate: CandidateRecord,
  objectiveStatement?: string,
  priorObjectiveStatement?: string,
): void {
  if (objectiveStatement !== undefined && objectiveStatement.trim().length > 0) {
    if (objectiveStatement.trim() !== candidate.statement.trim()) {
      throw new HarnessError(
        "INVALID_STATE",
        `objective statement drifted from candidate '${candidate.id}' statement (expected "${candidate.statement}", got "${objectiveStatement.trim()}"); changed objectives must be proposed as new candidates under tier 0`,
      );
    }
  }

  if (priorObjectiveStatement !== undefined && priorObjectiveStatement.trim().length > 0) {
    if (priorObjectiveStatement.trim() !== candidate.statement.trim()) {
      throw new HarnessError(
        "INVALID_STATE",
        `objective statement drifted from prior round statement (expected "${priorObjectiveStatement.trim()}", got "${candidate.statement}"); an objective statement may not drift between rounds`,
      );
    }
  }
}

/**
 * Validates round budget against the mind charter budget cap.
 */
export function validateRoundBudget(
  state: Record<string, unknown>,
  roundIndex: number,
  objectiveId: string,
): void {
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  const budget = (state.budget ?? mindState.budget ?? DEFAULT_MIND_BUDGET) as Record<
    string,
    unknown
  >;

  const maxRounds =
    typeof budget.max_rounds_per_objective === "number"
      ? budget.max_rounds_per_objective
      : (DEFAULT_MIND_BUDGET.max_rounds_per_objective ?? 3);

  if (roundIndex > maxRounds) {
    throw new HarnessError(
      "INVALID_STATE",
      `round budget spent for objective '${objectiveId}' (${roundIndex} > max ${maxRounds} rounds); close round as exhausted or escalate`,
    );
  }
}

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
