import { assessRecyclingState } from "./scanner.ts";
import { transact } from "../../../engine/store/index.ts";
import { drainPendingFeedbacks } from "../../feedback/index.ts";
import { extractAllCandidates } from "./types.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import type { JsonObject, JsonValue } from "../../../core/contracts/index.ts";
import type {
  AutonomousRecycleOptions,
  AutonomicWavePlanOptions,
  AutonomicWavePlanResult,
  CandidateRecord,
  ConcurrencyWavePlan,
  DrainAndAdmitOptions,
  DrainAndAdmitResult,
  RecycleAssessment,
} from "./types.ts";
export function transitionCompletenessCriticSignOff(
  state: Record<string, unknown>,
  options: AutonomousRecycleOptions,
): RecycleAssessment {
  return assessRecyclingState(state, options.runRoot, {
    now: options.now,
    feedbackQueuePath: options.feedbackQueuePath,
    checkFeedbackQueue: options.checkFeedbackQueue,
    targetRunRoot: options.targetRunRoot,
    maxParallel: options.maxParallel,
  });
}

/**
 * Specifically transitions a pulse cycle into the next wake/pulse arm without process termination.
 */
export function transitionPulseToWake(
  runRoot: string,
  pulseId: string,
  outcome: string = "active",
): RecycleAssessment {
  const wakeCmd = `bun harness.ts mind:wake --run ${runRoot}`;
  return {
    canRecycle: true,
    phase: "pulse_closed",
    transition: "pulse_to_wake",
    objectiveId: null,
    candidateId: null,
    roundNumber: null,
    nextRecommendedCommand: wakeCmd,
    suggestedCommands: [wakeCmd],
    reason: `Pulse '${pulseId}' closed with outcome '${outcome}'. Non-termination rail active; next wake is armed.`,
    infiniteCadence: true,
  };
}

/**
 * Legacy alias for transitionPulseToWake.
 */
export const transitionPulseCloseToWake = transitionPulseToWake;

/**
 * Drains pending feedback items from FEEDBACK_QUEUE.jsonl and admits them
 * directly into the target mind capsule.
 */
export function drainAndAdmitFeedbackCandidates(
  options: DrainAndAdmitOptions,
): DrainAndAdmitResult {
  const { runRoot, actor } = options;
  const nowIso =
    options.now !== undefined ? new Date(options.now).toISOString() : new Date().toISOString();
  const drained = drainPendingFeedbacks(
    {
      markAs: "ADMITTED",
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    },
    options.queuePath,
  );

  const admitted: CandidateRecord[] = [];
  const nextCommands: string[] = [];

  if (drained.length > 0) {
    transact(
      runRoot,
      actor,
      "mind-candidates-drained-and-admitted",
      { count: drained.length },
      (working) => {
        const candidates = Array.isArray(working.candidates)
          ? [...(working.candidates as unknown as readonly CandidateRecord[])]
          : [];
        const mind = (working.mind ?? {}) as Record<string, unknown>;
        const mindCandidates = Array.isArray(mind.candidates)
          ? [...(mind.candidates as unknown as readonly CandidateRecord[])]
          : [];

        for (const item of drained) {
          const candidateId = item.candidate_id ?? `cand-${item.id}`;
          const newCand: CandidateRecord = {
            id: candidateId,
            kind: item.category === "DOCUMENTATION" ? "proposal" : "defect",
            statement: item.title + (item.content ? `: ${item.content}` : ""),
            charter_goals: [options.defaultCharterGoal ?? "G1"],
            write_scope: options.defaultWriteScope ?? ["src/", "tests/"],
            status: "admitted",
          };

          if (!candidates.some((c) => c.id === candidateId)) {
            candidates.push(newCand);
          }
          if (!mindCandidates.some((c) => c.id === candidateId)) {
            mindCandidates.push(newCand);
          }
          admitted.push(newCand);

          const openRoundCmd = `bun harness.ts mind:round-open --run ${runRoot} --actor ${actor} --objective obj-${candidateId} --candidate ${candidateId}`;
          nextCommands.push(openRoundCmd);
        }

        working.candidates = candidates as unknown as JsonValue;
        mind.candidates = mindCandidates as unknown as JsonValue;
        working.mind = mind as unknown as JsonObject;
      },
    );
  }

  const wavePlanCommands = [
    `bun harness.ts plan:compile --run ${runRoot}`,
    `bun harness.ts orchestrate --run ${runRoot} --parallel`,
  ];

  return {
    runRoot,
    drainedItems: drained,
    admittedCandidates: admitted,
    nextCommands,
    wavePlanCommands,
  };
}

/**
 * Compiles an autonomic concurrency wave plan grouping admitted candidates into parallel execution batches.
 */
export function compileAutonomicWavePlan(
  state: Record<string, unknown>,
  runRoot: string,
  options?: AutonomicWavePlanOptions,
): AutonomicWavePlanResult {
  const mind = (state.mind ?? {}) as Record<string, unknown>;
  const generation = typeof mind.generation === "number" ? mind.generation : 1;
  const actor = options?.actor ?? (typeof mind.actor === "string" ? mind.actor : "mind-1");
  const maxParallel = options?.maxParallel ?? 4;

  const allCandidates = extractAllCandidates(state);
  const admitted = allCandidates.filter((c) => c.status === "admitted");

  const waves: ConcurrencyWavePlan[] = [];
  const dispatchCommands: string[] = [];

  let currentWaveIndex = 1;
  for (let i = 0; i < admitted.length; i += maxParallel) {
    const chunk = admitted.slice(i, i + maxParallel);
    const candidateIds = chunk.map((c) => c.id);
    const commands = chunk.map(
      (c) =>
        `bun harness.ts mind:round-open --run ${runRoot} --actor ${actor} --objective obj-${c.id} --candidate ${c.id}`,
    );

    waves.push({
      waveIndex: currentWaveIndex,
      candidateIds,
      commands,
    });
    dispatchCommands.push(...commands);
    currentWaveIndex++;
  }

  const compileCmd = `bun harness.ts plan:compile --run ${runRoot}`;
  const orchestrateCmd = `bun harness.ts orchestrate --run ${runRoot} --parallel`;
  dispatchCommands.push(compileCmd, orchestrateCmd);

  const nextInstruction =
    dispatchCommands.length > 0
      ? dispatchCommands[0]!
      : `bun harness.ts mind:wake --run ${runRoot}`;

  return {
    runRoot,
    generation,
    totalCandidates: admitted.length,
    waves,
    dispatchCommands,
    nextInstruction,
  };
}

/**
 * Executes a seamless autonomic generation rollover: seals Generation N,
 * initializes Generation N+1, drains pending items from FEEDBACK_QUEUE.jsonl,
 * admits candidates, compiles wave plans, and prepares orchestrator dispatch.
 */
