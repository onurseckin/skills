import { join } from "node:path";
import type { JsonObject, JsonValue } from "../../../core/contracts/index.ts";
import { atomicWriteJson } from "../../../core/durable-write.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { initRun, loadRun, transact } from "../../../engine/store/index.ts";
import { chainCapsules } from "../../../orchestrator/capsule-chainer.ts";
import { readAgentLedger, writeAgentLedger } from "../../../workflow/agents/ledger.ts";
import { DEFAULT_MIND_BUDGET, type ParsedCharter } from "../../lifecycle/charter/index.ts";
import { pruneAndArchiveGenerationalState, type ArchivedObjectiveRecord } from "../index.ts";
import type { RotateMindResult } from "./types.ts";

export interface FinishRotationOptions {
  readonly repoRoot: string;
  readonly targetRunId: string;
  readonly promptBytes: Uint8Array;
  readonly parsedCharter: ParsedCharter;
  readonly liveCharterPath: string;
  readonly sourceRunId: string;
  readonly realSourceRunRoot: string;
  readonly sourceGeneration: number;
  readonly targetGeneration: number;
  readonly sourceState: Record<string, unknown>;
  readonly capsulesParent: string;
  readonly actor: string;
  readonly nowIso: string;
  readonly previousEventHead: string | null;
  readonly charterSourcePath: string;
  readonly charterGoals: readonly string[];
  readonly charterRepoRoots: readonly string[];
  readonly sourceLoaded: { state: Record<string, unknown> };
}

export function finishRotation(options: FinishRotationOptions): RotateMindResult {
  const {
    repoRoot,
    targetRunId,
    promptBytes,
    parsedCharter,
    liveCharterPath,
    sourceRunId,
    realSourceRunRoot,
    sourceGeneration,
    targetGeneration,
    sourceState,
    capsulesParent,
    actor,
    nowIso,
    previousEventHead,
    charterSourcePath,
    charterGoals,
    charterRepoRoots,
    sourceLoaded,
  } = options;

  // 2. Initialize Generation N+1
  const initializedTargetRoot = initRun(repoRoot, targetRunId, promptBytes, "file", true);
  const rotatedCharterSha256 = loadRun(initializedTargetRoot, false).manifest.prompt_sha256;

  if (rotatedCharterSha256 !== parsedCharter.sha256) {
    throw new HarnessError(
      "INTEGRITY",
      `rotated charter digest mismatch: successor capsule manifest records ${rotatedCharterSha256} but the live charter at ${liveCharterPath} hashes to ${parsedCharter.sha256}`,
    );
  }

  chainCapsules({
    sourceRunId,
    targetRunId,
    sourceCapsulePath: realSourceRunRoot,
    targetCapsulePath: initializedTargetRoot,
    roundNumber: targetGeneration,
  });

  // 3. Generational state pruning and archival
  const archivalResult = pruneAndArchiveGenerationalState({
    sourceState,
    sourceGeneration,
    capsulesDir: capsulesParent,
    sourceRunRoot: realSourceRunRoot,
    targetRunRoot: initializedTargetRoot,
    nowIso,
  });

  const carriedCandidates = archivalResult.carriedCandidates;
  const carriedObjectives = archivalResult.carriedObjectives;
  const openCandidatesCount = carriedCandidates.filter(
    (c) => c.status === "opened" || c.status === "admitted",
  ).length;
  const declinedCandidatesCount = carriedCandidates.filter((c) => c.status === "declined").length;

  const sourcePulseState = (sourceState.pulse ?? {}) as Record<string, unknown>;
  const pulseCounter = typeof sourcePulseState.counter === "number" ? sourcePulseState.counter : 0;
  const sourceBudgetState = (sourceState.budget ?? {}) as Record<string, unknown>;

  const sourceLedger = readAgentLedger(sourceLoaded.state as Parameters<typeof readAgentLedger>[0]);
  const carriedGrants = sourceLedger.filter((grant) => grant.status === "active");

  transact(
    initializedTargetRoot,
    actor,
    "mind-initialized",
    {
      generation: targetGeneration,
      charter_source_path: charterSourcePath,
      pinned_digest: rotatedCharterSha256,
      previous_generation: {
        run_id: sourceRunId,
        event_head: previousEventHead,
        sealed_at: nowIso,
      },
    },
    (state) => {
      state.mind = {
        generation: targetGeneration,
        opened_at: nowIso,
        charter: {
          source_path: charterSourcePath,
          pinned_sha256: rotatedCharterSha256,
          goals: charterGoals,
          repo_roots: charterRepoRoots,
          evidence_class: "harness_observed",
        },
        previous_generation: {
          run_id: sourceRunId,
          event_head: previousEventHead,
          sealed_at: nowIso,
        },
      } as unknown as JsonValue;

      state.budget = {
        pulses_per_day: sourceBudgetState.pulses_per_day ?? DEFAULT_MIND_BUDGET.pulses_per_day,
        wall_clock_ms_per_day:
          sourceBudgetState.wall_clock_ms_per_day ?? DEFAULT_MIND_BUDGET.wall_clock_ms_per_day,
        max_agents_in_flight:
          sourceBudgetState.max_agents_in_flight ?? DEFAULT_MIND_BUDGET.max_agents_in_flight,
        max_rounds_per_objective:
          sourceBudgetState.max_rounds_per_objective ??
          DEFAULT_MIND_BUDGET.max_rounds_per_objective,
        base_interval_ms:
          sourceBudgetState.base_interval_ms ?? DEFAULT_MIND_BUDGET.base_interval_ms,
        max_interval_ms: sourceBudgetState.max_interval_ms ?? DEFAULT_MIND_BUDGET.max_interval_ms,
        max_pause_interval_ms:
          sourceBudgetState.max_pause_interval_ms ?? DEFAULT_MIND_BUDGET.max_pause_interval_ms,
        pulse_deadline_ms:
          sourceBudgetState.pulse_deadline_ms ?? DEFAULT_MIND_BUDGET.pulse_deadline_ms,
        max_open_proposals:
          sourceBudgetState.max_open_proposals ?? DEFAULT_MIND_BUDGET.max_open_proposals,
        quiet_hours:
          sourceBudgetState.quiet_hours !== undefined
            ? sourceBudgetState.quiet_hours
            : DEFAULT_MIND_BUDGET.quiet_hours,
        day_key: sourceBudgetState.day_key ?? nowIso.slice(0, 10),
        pulses_today: sourceBudgetState.pulses_today ?? 0,
        wall_clock_ms_today: sourceBudgetState.wall_clock_ms_today ?? 0,
      } as unknown as JsonValue;

      state.pulse = {
        counter: pulseCounter,
        open: null,
        last: null,
      } as unknown as JsonValue;

      state.observations = [] as unknown as JsonValue;
      state.candidates = carriedCandidates as unknown as JsonValue;
      state.objectives = carriedObjectives as unknown as JsonValue;
      state.escalations = [] as unknown as JsonValue;
      state.audit = {
        last_started_at: null,
        last_verdict: null,
        open_findings: [],
      } as unknown as JsonValue;

      writeAgentLedger(state, carriedGrants);
    },
  );

  atomicWriteJson(join(initializedTargetRoot, "last_pulse.json"), {
    at: nowIso,
    pulse_id: null,
    outcome: null,
    next_wake_at: null,
  });

  return {
    sourceRunRoot: realSourceRunRoot,
    sourceRunId,
    targetRunRoot: initializedTargetRoot,
    targetRunId,
    sourceGeneration,
    targetGeneration,
    charterSha256: rotatedCharterSha256,
    charterSourcePath,
    previousEventHead,
    pulseCounter,
    carriedCandidates,
    openCandidatesCount,
    declinedCandidatesCount,
    archivedRecords: archivalResult.archivedRecords,
    archivedCount: archivalResult.archivedCount,
    carriedObjectives,
    carriedGrantsCount: carriedGrants.length,
    rotatedAt: nowIso,
  };
}
