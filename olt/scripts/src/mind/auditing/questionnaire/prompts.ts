import { HarnessError } from "../../../core/errors/index.ts";
import type { HarnessEvent, RunState } from "../../../core/contracts/index.ts";
import { verifyDefectWitness } from "../witness/index.ts";
import { calculatePulseValue, type PulseValueMetrics } from "../../memory/value/index.ts";
import type { WitnessVerificationCheckResult } from "./types.ts";
export function checkAdmittedCandidateWitnesses(
  state: RunState,
  events: readonly HarnessEvent[],
  options: {
    readonly repoRoot?: string | undefined;
    readonly capsuleRoot?: string | undefined;
  } = {},
): WitnessVerificationCheckResult {
  const findings: string[] = [];
  let verifiedCount = 0;

  const rawCandidates: Record<string, unknown>[] = [];
  const mindState = (state.mind ?? {}) as Record<string, unknown>;

  if (Array.isArray(state.candidates)) {
    rawCandidates.push(...(state.candidates as Record<string, unknown>[]));
  } else if (Array.isArray(mindState.candidates)) {
    rawCandidates.push(...(mindState.candidates as Record<string, unknown>[]));
  }

  for (const event of events) {
    if (event.kind === "mind-candidate-admitted") {
      const candidateId =
        typeof event.payload.candidate_id === "string"
          ? event.payload.candidate_id
          : typeof event.payload.candidate === "string"
            ? event.payload.candidate
            : null;
      if (candidateId && !rawCandidates.some((c) => c.id === candidateId)) {
        rawCandidates.push({
          id: candidateId,
          status: "admitted",
          kind: event.payload.kind ?? "defect",
          witness_command_id: event.payload.witness_command_id ?? event.payload.witness ?? null,
        });
      }
    }
  }

  const admittedDefects = rawCandidates.filter(
    (c) => c.status === "admitted" && c.kind === "defect",
  );

  for (const candidate of admittedDefects) {
    const candidateId = typeof candidate.id === "string" ? candidate.id : "unknown";
    const witnessId =
      typeof candidate.witness_command_id === "string"
        ? candidate.witness_command_id
        : typeof candidate.witness === "string"
          ? candidate.witness
          : null;

    if (!witnessId || !witnessId.trim()) {
      findings.push(`admitted defect candidate '${candidateId}' has no witness command id`);
      continue;
    }

    try {
      const verification = verifyDefectWitness(witnessId, options.capsuleRoot ?? options.repoRoot);
      verifiedCount++;
      if (verification.exitCode === 0 && verification.status === "succeeded") {
        findings.push(
          `admitted defect candidate '${candidateId}' witness '${witnessId}' exited 0 (clean, defect not demonstrated)`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      findings.push(
        `admitted defect candidate '${candidateId}' witness '${witnessId}' verification failed: ${msg}`,
      );
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    verifiedCount,
  };
}

export interface CharterGoalCheckResult {
  readonly ok: boolean;
  readonly findings: readonly string[];
}

export function checkAdmittedCandidateGoals(
  state: RunState,
  events: readonly HarnessEvent[],
  validCharterGoals: readonly string[] | ReadonlySet<string>,
): CharterGoalCheckResult {
  const findings: string[] = [];
  const validGoalSet = new Set(validCharterGoals);

  const rawCandidates: Record<string, unknown>[] = [];
  const mindState = (state.mind ?? {}) as Record<string, unknown>;

  if (Array.isArray(state.candidates)) {
    rawCandidates.push(...(state.candidates as Record<string, unknown>[]));
  } else if (Array.isArray(mindState.candidates)) {
    rawCandidates.push(...(mindState.candidates as Record<string, unknown>[]));
  }

  for (const event of events) {
    if (event.kind === "mind-candidate-admitted" || event.kind === "mind-candidate-opened") {
      const candidateId =
        typeof event.payload.candidate_id === "string"
          ? event.payload.candidate_id
          : typeof event.payload.candidate === "string"
            ? event.payload.candidate
            : null;
      const goals = Array.isArray(event.payload.charter_goal_ids)
        ? event.payload.charter_goal_ids
        : Array.isArray(event.payload.charter_goals)
          ? event.payload.charter_goals
          : null;
      if (candidateId && goals) {
        const existing = rawCandidates.find((c) => c.id === candidateId);
        if (existing) {
          if (!existing.charter_goal_ids) existing.charter_goal_ids = goals;
        } else {
          rawCandidates.push({
            id: candidateId,
            status: event.kind === "mind-candidate-admitted" ? "admitted" : "open",
            charter_goal_ids: goals,
          });
        }
      }
    }
  }

  const admittedCandidates = rawCandidates.filter((c) => c.status === "admitted");

  for (const candidate of admittedCandidates) {
    const candidateId = typeof candidate.id === "string" ? candidate.id : "unknown";
    const rawGoals = Array.isArray(candidate.charter_goal_ids)
      ? candidate.charter_goal_ids
      : Array.isArray(candidate.charter_goals)
        ? candidate.charter_goals
        : [];

    if (rawGoals.length === 0) {
      findings.push(`admitted candidate '${candidateId}' cites zero charter goals`);
      continue;
    }

    for (const g of rawGoals) {
      const goalId =
        typeof g === "string"
          ? g
          : typeof (g as { id?: string })?.id === "string"
            ? (g as { id: string }).id
            : String(g);
      if (!validGoalSet.has(goalId)) {
        findings.push(
          `admitted candidate '${candidateId}' cited non-existent charter goal '${goalId}'`,
        );
      }
    }
  }

  return {
    ok: findings.length === 0,
    findings,
  };
}

export interface ValueConsistencyCheckResult {
  readonly ok: boolean;
  readonly findings: readonly string[];
  readonly series: readonly number[];
}

export function checkValueConsistency(
  events: readonly HarnessEvent[],
  _state: RunState,
): ValueConsistencyCheckResult {
  const findings: string[] = [];
  const series: number[] = [];

  for (const event of events) {
    if (event.kind === "mind-pulse-closed") {
      const pulseId =
        typeof event.payload.pulse_id === "string" ? event.payload.pulse_id : "unknown";
      const recordedValue = typeof event.payload.value === "number" ? event.payload.value : 0;
      series.push(recordedValue);

      const metricsObj = (event.payload.metrics ?? event.payload) as Record<string, unknown>;
      const metrics: PulseValueMetrics = {
        leases_reclaimed:
          typeof metricsObj.leases_reclaimed === "number" ? metricsObj.leases_reclaimed : 0,
        findings_resolved:
          typeof metricsObj.findings_resolved === "number" ? metricsObj.findings_resolved : 0,
        gates_flipped_red_to_green:
          typeof metricsObj.gates_flipped_red_to_green === "number"
            ? metricsObj.gates_flipped_red_to_green
            : 0,
        tasks_reaching_done:
          typeof metricsObj.tasks_reaching_done === "number" ? metricsObj.tasks_reaching_done : 0,
        candidates_admitted:
          typeof metricsObj.candidates_admitted === "number" ? metricsObj.candidates_admitted : 0,
        proposals_recorded:
          typeof metricsObj.proposals_recorded === "number" ? metricsObj.proposals_recorded : 0,
      };

      const computedValue = calculatePulseValue(metrics);
      if (typeof event.payload.value === "number" && event.payload.value !== computedValue) {
        findings.push(
          `pulse ${pulseId} recorded value ${recordedValue} inconsistent with ledger metrics (computed ${computedValue})`,
        );
      }

      const forbiddenKeys = [
        "files_touched",
        "commands_run",
        "tokens_spent",
        "agents_deployed",
        "words_written",
      ];
      for (const k of forbiddenKeys) {
        if (typeof metricsObj[k] === "number" && (metricsObj[k] as number) > 0) {
          findings.push(
            `pulse ${pulseId} metric '${k}' is explicitly excluded from value computation`,
          );
        }
      }
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    series,
  };
}

export interface ScopeViolationCheckResult {
  readonly ok: boolean;
  readonly findings: readonly string[];
}
