import { existsSync, lstatSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import { chainCapsules } from "../../../orchestrator/capsule-chainer.ts";
import type { CapsuleChainManifest, DefectSynthesis } from "../../../orchestrator/types.ts";
import { DEFAULT_MIND_BUDGET } from "../charter/index.ts";

export interface CandidateRecord {
  readonly id: string;
  readonly statement: string;
  readonly status: string;
  readonly [key: string]: unknown;
}

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
  readonly allowLeaseMigration?: boolean | undefined;
  readonly migratableTaskIds?: readonly string[] | undefined;
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
