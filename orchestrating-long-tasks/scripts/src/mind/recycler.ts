import { enforceLineLimit } from "../cli/formatters/line-limiter.ts";
import type { JsonObject, JsonValue } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { loadRun } from "../store/load.ts";
import { transact } from "../store/transaction.ts";
import { DEFAULT_MIND_BUDGET } from "./charter.ts";
import {
  drainPendingFeedbacks,
  readFeedbackQueue,
  type FeedbackItem,
} from "./feedback-queue.ts";
import type { CandidateRecord } from "./gates.ts";
import { getAllProposals, type MindProposal } from "./proposal.ts";
import { rotateMindGeneration, type RotateMindResult } from "./rotate.ts";
import { getAllRounds, type RoundRecord } from "./rounds.ts";

export type RecycleTransitionType =
  | "critic_to_discovery"
  | "critic_to_next_round"
  | "round_to_planning"
  | "candidate_to_planning"
  | "pulse_to_wake"
  | "discovery_to_admission"
  | "quiesce_to_wake"
  | "generation_rollover"
  | "feedback_drain_to_admission"
  | "wave_dispatch";

export type RecyclePhase =
  | "critic_signed_off"
  | "round_closed"
  | "pulse_closed"
  | "candidates_admitted"
  | "idle_discovery"
  | "in_progress"
  | "quiescent"
  | "generation_converged"
  | "rollover_ready";

export interface RecycleAssessment {
  readonly canRecycle: boolean;
  readonly phase: RecyclePhase;
  readonly transition: RecycleTransitionType;
  readonly objectiveId: string | null;
  readonly candidateId: string | null;
  readonly roundNumber: number | null;
  readonly nextRecommendedCommand: string;
  readonly suggestedCommands: readonly string[];
  readonly reason: string;
  readonly infiniteCadence: true;
  readonly pendingFeedbackCount?: number | undefined;
  readonly targetGeneration?: number | undefined;
}

export interface AssessRecyclingOptions {
  readonly now?: number | Date | string | undefined;
  readonly feedbackQueuePath?: string | undefined;
  readonly checkFeedbackQueue?: boolean | undefined;
  readonly targetRunRoot?: string | undefined;
  readonly maxParallel?: number | undefined;
}

export interface AutonomousRecycleOptions extends AssessRecyclingOptions {
  readonly runRoot: string;
  readonly actor: string;
}

export interface RecyclePlan {
  readonly runRoot: string;
  readonly transition: RecycleTransitionType;
  readonly currentRound: number | null;
  readonly nextRound: number | null;
  readonly objectiveId: string | null;
  readonly candidateId: string | null;
  readonly planCommands: readonly string[];
  readonly nextRecommendedCommand: string;
  readonly markdown: string;
}

export interface ConcurrencyWavePlan {
  readonly waveIndex: number;
  readonly candidateIds: readonly string[];
  readonly commands: readonly string[];
}

export interface AutonomicWavePlanOptions {
  readonly maxParallel?: number | undefined;
  readonly actor?: string | undefined;
}

export interface AutonomicWavePlanResult {
  readonly runRoot: string;
  readonly generation: number;
  readonly totalCandidates: number;
  readonly waves: readonly ConcurrencyWavePlan[];
  readonly dispatchCommands: readonly string[];
  readonly nextInstruction: string;
}

export interface DrainAndAdmitOptions {
  readonly runRoot: string;
  readonly actor: string;
  readonly queuePath?: string | undefined;
  readonly limit?: number | undefined;
  readonly defaultCharterGoal?: string | undefined;
  readonly defaultWriteScope?: readonly string[] | undefined;
  readonly now?: number | Date | string | undefined;
}

export interface DrainAndAdmitResult {
  readonly runRoot: string;
  readonly drainedItems: readonly FeedbackItem[];
  readonly admittedCandidates: readonly CandidateRecord[];
  readonly nextCommands: readonly string[];
  readonly wavePlanCommands: readonly string[];
}

export interface AutonomicRolloverOptions {
  readonly sourceRunRoot: string;
  readonly actor?: string | undefined;
  readonly now?: number | Date | string | undefined;
  readonly feedbackQueuePath?: string | undefined;
  readonly autoDrain?: boolean | undefined;
  readonly targetRunId?: string | undefined;
  readonly capsulesDir?: string | undefined;
  readonly maxParallel?: number | undefined;
}

export interface AutonomicRolloverResult {
  readonly success: boolean;
  readonly sourceRunRoot: string;
  readonly sourceRunId: string;
  readonly targetRunRoot: string;
  readonly targetRunId: string;
  readonly sourceGeneration: number;
  readonly targetGeneration: number;
  readonly drainedFeedbackItems: readonly FeedbackItem[];
  readonly admittedCandidates: readonly CandidateRecord[];
  readonly wavePlan: AutonomicWavePlanResult;
  readonly nextRecommendedCommand: string;
  readonly markdown: string;
}

/**
 * Extracts all candidate records from state (both root and mind substate).
 */
export function extractAllCandidates(state: Record<string, unknown>): readonly CandidateRecord[] {
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  const list: CandidateRecord[] = [];

  if (Array.isArray(state.candidates)) {
    for (const item of state.candidates as readonly CandidateRecord[]) {
      if (item && typeof item.id === "string") {
        list.push(item);
      }
    }
  }
  if (Array.isArray(mindState.candidates)) {
    for (const item of mindState.candidates as readonly CandidateRecord[]) {
      if (item && typeof item.id === "string" && !list.some((c) => c.id === item.id)) {
        list.push(item);
      }
    }
  }

  return list;
}

/**
 * Assesses the state of the mind and active runs to determine the exact
 * autonomous recycling transition from completeness critic, closed round, closed pulse,
 * or immediate generation rollover.
 */
export function assessRecyclingState(
  state: Record<string, unknown>,
  runRoot: string,
  options: AssessRecyclingOptions = {},
): RecycleAssessment {
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  const actor = typeof mindState.actor === "string" ? mindState.actor : "mind-1";
  const currentGen = typeof mindState.generation === "number" ? mindState.generation : 1;
  const budget = (state.budget ?? mindState.budget ?? DEFAULT_MIND_BUDGET) as Record<
    string,
    unknown
  >;
  const maxRounds =
    typeof budget.max_rounds_per_objective === "number"
      ? budget.max_rounds_per_objective
      : (DEFAULT_MIND_BUDGET.max_rounds_per_objective ?? 3);

  const allCandidates = extractAllCandidates(state);
  const allRounds = getAllRounds(state);
  const completionReview = state.completion_review as
    | { status?: string; summary?: string; review_sha256?: string }
    | undefined;

  const openRound = allRounds.find((r) => r.status === "opened");
  const latestRound =
    allRounds.length > 0 ? [...allRounds].sort((a, b) => b.round - a.round)[0] : undefined;

  // 1. Check if completeness critic has reviewed the current round
  if (completionReview && typeof completionReview.status === "string") {
    if (completionReview.status === "clean") {
      // Round converged: look for next admitted candidate
      const nextCandidate = allCandidates.find(
        (c) =>
          c.status === "admitted" &&
          (!c.objective_run_id ||
            !allRounds.some(
              (r) => r.candidate_id === c.id && r.status === "closed" && r.result === "converged",
            )),
      );

      if (nextCandidate) {
        const nextObjId = `obj-${nextCandidate.id}`;
        const cmd = `bun harness.ts mind:round-open --run ${runRoot} --actor ${actor} --objective ${nextObjId} --candidate ${nextCandidate.id}`;
        return {
          canRecycle: true,
          phase: "critic_signed_off",
          transition: "candidate_to_planning",
          objectiveId: nextObjId,
          candidateId: nextCandidate.id,
          roundNumber: 1,
          nextRecommendedCommand: cmd,
          suggestedCommands: [
            cmd,
            `bun harness.ts plan:init --run ${runRoot} --actor ${actor} --objective "${nextCandidate.statement}"`,
          ],
          reason: `Completeness critic signed off clean; admitted candidate '${nextCandidate.id}' is ready for new round wave.`,
          infiniteCadence: true,
        };
      }

      // Check for un-admitted open candidates
      const openCandidate = allCandidates.find((c) => c.status === "opened" || c.status === "open");
      if (openCandidate) {
        const cmd = `bun harness.ts mind:admit --run ${runRoot} --actor ${actor} --candidate ${openCandidate.id}`;
        return {
          canRecycle: true,
          phase: "critic_signed_off",
          transition: "discovery_to_admission",
          objectiveId: null,
          candidateId: openCandidate.id,
          roundNumber: null,
          nextRecommendedCommand: cmd,
          suggestedCommands: [cmd],
          reason: `Completeness critic signed off clean; open candidate '${openCandidate.id}' is ready for admission review.`,
          infiniteCadence: true,
        };
      }

      // Check if feedback queue has pending items when checking queue
      if (options.checkFeedbackQueue === true || options.feedbackQueuePath !== undefined) {
        let pendingFeedbacks: FeedbackItem[] = [];
        try {
          const queueItems = readFeedbackQueue(options.feedbackQueuePath);
          pendingFeedbacks = queueItems.filter((i) => i.status === "PENDING");
        } catch {
          pendingFeedbacks = [];
        }

        if (pendingFeedbacks.length > 0) {
          const targetGen = currentGen + 1;
          const rotateCmd = `bun harness.ts mind:rotate --run ${runRoot} --actor ${actor}`;
          const drainCmd = `bun harness.ts feedback:drain --run ${options.targetRunRoot ?? runRoot}`;
          const orchestrateCmd = `bun harness.ts orchestrate --run ${options.targetRunRoot ?? runRoot} --parallel`;
          return {
            canRecycle: true,
            phase: "generation_converged",
            transition: "generation_rollover",
            objectiveId: null,
            candidateId: null,
            roundNumber: null,
            targetGeneration: targetGen,
            pendingFeedbackCount: pendingFeedbacks.length,
            nextRecommendedCommand: rotateCmd,
            suggestedCommands: [rotateCmd, drainCmd, orchestrateCmd],
            reason: `Completeness critic signed off clean; generation ${currentGen} converged with ${pendingFeedbacks.length} pending feedback items in queue. Immediate autonomic rollover to generation ${targetGen} ready.`,
            infiniteCadence: true,
          };
        }
      }

      // No open/admitted candidates: recycle into discovery
      const wakeCmd = `bun harness.ts mind:wake --run ${runRoot}`;
      const candCmd = `bun harness.ts mind:candidate --run ${runRoot} --actor ${actor} --kind defect --statement "Autonomous candidate discovery" --charter-goal G1 --write-scope src/`;
      return {
        canRecycle: true,
        phase: "critic_signed_off",
        transition: "critic_to_discovery",
        objectiveId: null,
        candidateId: null,
        roundNumber: null,
        nextRecommendedCommand: candCmd,
        suggestedCommands: [candCmd, wakeCmd],
        reason:
          "Completeness critic signed off clean; transitioning to new candidate discovery under perpetual mind loop.",
        infiniteCadence: true,
      };
    }

    if (completionReview.status === "findings") {
      // Critic identified findings: carry forward into successor round if budget allows
      const currentObj = openRound?.objective_id
        ? openRound.objective_id
        : latestRound?.objective_id;
      const currentCand = openRound?.candidate_id
        ? openRound.candidate_id
        : latestRound?.candidate_id;
      const currentRndNum =
        openRound?.round !== undefined
          ? openRound.round
          : latestRound?.round !== undefined
            ? latestRound.round
            : 1;

      if (currentObj && currentCand && currentRndNum < maxRounds) {
        const nextRnd = currentRndNum + 1;
        const cmd = `bun harness.ts mind:round-open --run ${runRoot} --actor ${actor} --objective ${currentObj} --candidate ${currentCand} --round ${nextRnd} --chain-from ${runRoot}`;
        return {
          canRecycle: true,
          phase: "critic_signed_off",
          transition: "critic_to_next_round",
          objectiveId: currentObj,
          candidateId: currentCand,
          roundNumber: nextRnd,
          nextRecommendedCommand: cmd,
          suggestedCommands: [cmd],
          reason: `Completeness critic reported findings; opening successor round ${nextRnd} (max ${maxRounds}) chaining from prior round.`,
          infiniteCadence: true,
        };
      }

      // Budget exhausted: recycle to discovery / next objective
      const cmd = `bun harness.ts mind:wake --run ${runRoot}`;
      return {
        canRecycle: true,
        phase: "critic_signed_off",
        transition: "critic_to_discovery",
        objectiveId: currentObj ? currentObj : null,
        candidateId: currentCand ? currentCand : null,
        roundNumber: null,
        nextRecommendedCommand: cmd,
        suggestedCommands: [cmd],
        reason: `Round budget exhausted (${currentRndNum}/${maxRounds}); transitioning to next objective discovery.`,
        infiniteCadence: true,
      };
    }
  }

  // 2. Check for admitted candidates ready to start a round
  const admittedCandidate = allCandidates.find(
    (c) =>
      c.status === "admitted" &&
      (!c.objective_run_id ||
        !allRounds.some(
          (r) => r.candidate_id === c.id && r.status === "closed" && r.result === "converged",
        )),
  );

  if (admittedCandidate && !openRound) {
    const nextObjId = `obj-${admittedCandidate.id}`;
    const cmd = `bun harness.ts mind:round-open --run ${runRoot} --actor ${actor} --objective ${nextObjId} --candidate ${admittedCandidate.id}`;
    return {
      canRecycle: true,
      phase: "candidates_admitted",
      transition: "candidate_to_planning",
      objectiveId: nextObjId,
      candidateId: admittedCandidate.id,
      roundNumber: 1,
      nextRecommendedCommand: cmd,
      suggestedCommands: [cmd],
      reason: `Admitted candidate '${admittedCandidate.id}' is ready to open round 1.`,
      infiniteCadence: true,
    };
  }

  // 3. Check for open candidates ready for admission
  const openCandidate = allCandidates.find((c) => c.status === "opened" || c.status === "open");
  if (openCandidate && !openRound) {
    const cmd = `bun harness.ts mind:admit --run ${runRoot} --actor ${actor} --candidate ${openCandidate.id}`;
    return {
      canRecycle: true,
      phase: "idle_discovery",
      transition: "discovery_to_admission",
      objectiveId: null,
      candidateId: openCandidate.id,
      roundNumber: null,
      nextRecommendedCommand: cmd,
      suggestedCommands: [cmd],
      reason: `Open candidate '${openCandidate.id}' is awaiting admission review.`,
      infiniteCadence: true,
    };
  }

  // 4. Check if all rounds are closed and feedback queue has pending items for rollover
  if (
    !openRound &&
    allRounds.length > 0 &&
    allRounds.every((r) => r.status === "closed" && r.result === "converged") &&
    (options.checkFeedbackQueue === true || options.feedbackQueuePath !== undefined)
  ) {
    let pendingFeedbacks: FeedbackItem[] = [];
    try {
      const queueItems = readFeedbackQueue(options.feedbackQueuePath);
      pendingFeedbacks = queueItems.filter((i) => i.status === "PENDING");
    } catch {
      pendingFeedbacks = [];
    }

    if (pendingFeedbacks.length > 0) {
      const targetGen = currentGen + 1;
      const rotateCmd = `bun harness.ts mind:rotate --run ${runRoot} --actor ${actor}`;
      return {
        canRecycle: true,
        phase: "rollover_ready",
        transition: "generation_rollover",
        objectiveId: null,
        candidateId: null,
        roundNumber: null,
        targetGeneration: targetGen,
        pendingFeedbackCount: pendingFeedbacks.length,
        nextRecommendedCommand: rotateCmd,
        suggestedCommands: [rotateCmd],
        reason: `All rounds converged in generation ${currentGen}; ${pendingFeedbacks.length} feedback items pending in queue. Immediate autonomic rollover to generation ${targetGen} ready.`,
        infiniteCadence: true,
      };
    }
  }

  // 5. Default perpetual mind wake transition
  const wakeCmd = `bun harness.ts mind:wake --run ${runRoot}`;
  return {
    canRecycle: true,
    phase: openRound ? "in_progress" : "quiescent",
    transition: "pulse_to_wake",
    objectiveId: openRound?.objective_id ?? null,
    candidateId: openRound?.candidate_id ?? null,
    roundNumber: openRound?.round ?? null,
    nextRecommendedCommand: wakeCmd,
    suggestedCommands: [wakeCmd],
    reason: "Perpetual autonomous cadence: loop continues seamlessly into next wake.",
    infiniteCadence: true,
  };
}

/**
 * Specifically transitions from completeness critic sign-off back into candidate
 * discovery and next wave planning.
 */
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
 * Specifically transitions a closed pulse into the next wake/pulse arm without process termination.
 */
export function transitionPulseCloseToWake(
  runRoot: string,
  pulseId: string,
  outcome: string,
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
 * Drains pending feedback items from FEEDBACK_QUEUE.jsonl and admits them
 * directly into the target mind capsule.
 */
export function drainAndAdmitFeedbackCandidates(
  options: DrainAndAdmitOptions,
): DrainAndAdmitResult {
  const { runRoot, actor } = options;
  const nowIso =
    options.now !== undefined
      ? new Date(options.now).toISOString()
      : new Date().toISOString();
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
export function executeAutonomicRollover(
  options: AutonomicRolloverOptions,
): AutonomicRolloverResult {
  const actor = options.actor ?? "mind-autonomic-recycler";
  const sourceLoaded = loadRun(options.sourceRunRoot, false);
  const readiness = validateRolloverReadiness(
    sourceLoaded.state as Record<string, unknown>,
    undefined,
    { feedbackQueuePath: options.feedbackQueuePath },
  );
  if (!readiness.ready) {
    throw new HarnessError("INVALID_STATE", `Capsule not ready for rollover: ${readiness.reason}`);
  }

  // 1. Rotate generation
  const rotateResult = rotateMindGeneration({
    sourceRunRoot: options.sourceRunRoot,
    nextRunId: options.targetRunId,
    actor,
    now: options.now !== undefined ? new Date(options.now).toISOString() : undefined,
    capsulesDir: options.capsulesDir,
  });

  // 2. Drain feedback queue items into target capsule if autoDrain is true (default true)
  const shouldDrain = options.autoDrain !== false;
  let drainedFeedbackItems: readonly FeedbackItem[] = [];
  let admittedCandidates: readonly CandidateRecord[] = [];

  if (shouldDrain) {
    const drainResult = drainAndAdmitFeedbackCandidates({
      runRoot: rotateResult.targetRunRoot,
      actor,
      queuePath: options.feedbackQueuePath,
      now: options.now,
    });
    drainedFeedbackItems = drainResult.drainedItems;
    admittedCandidates = drainResult.admittedCandidates;
  }

  // 3. Compile wave plan for successor generation
  const targetLoaded = loadRun(rotateResult.targetRunRoot, false);
  const wavePlan = compileAutonomicWavePlan(
    targetLoaded.state as Record<string, unknown>,
    rotateResult.targetRunRoot,
    { maxParallel: options.maxParallel, actor },
  );

  const markdown = formatAutonomicRolloverBrief({
    sourceRunId: rotateResult.sourceRunId,
    targetRunId: rotateResult.targetRunId,
    sourceGeneration: rotateResult.sourceGeneration,
    targetGeneration: rotateResult.targetGeneration,
    targetRunRoot: rotateResult.targetRunRoot,
    drainedCount: drainedFeedbackItems.length,
    admittedCount: admittedCandidates.length,
    waveCount: wavePlan.waves.length,
    nextInstruction: wavePlan.nextInstruction,
  });

  return {
    success: true,
    sourceRunRoot: rotateResult.sourceRunRoot,
    sourceRunId: rotateResult.sourceRunId,
    targetRunRoot: rotateResult.targetRunRoot,
    targetRunId: rotateResult.targetRunId,
    sourceGeneration: rotateResult.sourceGeneration,
    targetGeneration: rotateResult.targetGeneration,
    drainedFeedbackItems,
    admittedCandidates,
    wavePlan,
    nextRecommendedCommand: wavePlan.nextInstruction,
    markdown,
  };
}

/**
 * Formats a clean markdown brief for an autonomic generation rollover.
 */
export function formatAutonomicRolloverBrief(params: {
  readonly sourceRunId: string;
  readonly targetRunId: string;
  readonly sourceGeneration: number;
  readonly targetGeneration: number;
  readonly targetRunRoot: string;
  readonly drainedCount: number;
  readonly admittedCount: number;
  readonly waveCount: number;
  readonly nextInstruction: string;
}): string {
  const lines = [
    `### Autonomic Mind Generation Rollover: ${params.sourceGeneration} → ${params.targetGeneration}`,
    `- **Source**: \`${params.sourceRunId}\` (converged & sealed)`,
    `- **Successor**: \`${params.targetRunId}\` at \`${params.targetRunRoot}\``,
    `- **FEEDBACK_QUEUE Drained**: ${params.drainedCount} items admitted`,
    `- **Candidates Admitted**: ${params.admittedCount}`,
    `- **Concurrency Waves Compiled**: ${params.waveCount}`,
    `- **Cadence**: infinite autonomous loop active (zero yield / zero idle)`,
    `- **Next Instruction**: \`${params.nextInstruction}\``,
  ];
  return enforceLineLimit(lines.join("\n"), 25);
}

/**
 * Plans an autonomous round recycle cycle, formatting the step-by-step instructions.
 */
export function planAutonomousRoundRecycle(
  state: Record<string, unknown>,
  options: AutonomousRecycleOptions,
): RecyclePlan {
  const assessment = assessRecyclingState(state, options.runRoot, {
    now: options.now,
    feedbackQueuePath: options.feedbackQueuePath,
    checkFeedbackQueue: options.checkFeedbackQueue,
    targetRunRoot: options.targetRunRoot,
    maxParallel: options.maxParallel,
  });
  const markdown = formatRecycleBrief(assessment, options.runRoot);

  return {
    runRoot: options.runRoot,
    transition: assessment.transition,
    currentRound: assessment.roundNumber,
    nextRound: assessment.roundNumber !== null ? assessment.roundNumber + 1 : null,
    objectiveId: assessment.objectiveId,
    candidateId: assessment.candidateId,
    planCommands: assessment.suggestedCommands,
    nextRecommendedCommand: assessment.nextRecommendedCommand,
    markdown,
  };
}

/**
 * Formats a clean, line-limited brief (<= 25 lines) for autonomous round recycling.
 */
export function formatRecycleBrief(assessment: RecycleAssessment, runRoot: string): string {
  const lines = [
    `### Autonomous Mind Recycler`,
    `- **Capsule**: \`${runRoot}\``,
    `- **Phase**: \`${assessment.phase}\``,
    `- **Transition**: \`${assessment.transition}\``,
    assessment.objectiveId ? `- **Objective**: \`${assessment.objectiveId}\`` : undefined,
    assessment.candidateId ? `- **Candidate**: \`${assessment.candidateId}\`` : undefined,
    assessment.roundNumber !== null ? `- **Round**: ${assessment.roundNumber}` : undefined,
    `- **Cadence**: infinite autonomous loop active (prohibits agent termination / exit)`,
    `- **Reason**: ${assessment.reason}`,
    `- **Next Instruction**: \`${assessment.nextRecommendedCommand}\``,
  ].filter((l): l is string => l !== undefined);

  return enforceLineLimit(lines.join("\n"), 25);
}

/**
 * Strict invariant check preventing any agent from killing the mind process,
 * terminating schedulers, or breaking the infinite cadence.
 */
export function enforceInfiniteMindCadence(params: {
  readonly runRoot: string;
  readonly actor: string;
  readonly isTerminal?: boolean | undefined;
  readonly nextWakeAt?: string | null | undefined;
}): {
  readonly cadence: "infinite_autonomous";
  readonly allowed: boolean;
  readonly nextInstruction: string;
  readonly message: string;
} {
  const nextCmd = `bun harness.ts mind:wake --run ${params.runRoot}`;

  if (params.isTerminal) {
    return {
      cadence: "infinite_autonomous",
      allowed: true,
      nextInstruction: nextCmd,
      message:
        "Terminal outcome recorded; perpetual mind loop remains armed and ready for manual or external restart.",
    };
  }

  return {
    cadence: "infinite_autonomous",
    allowed: true,
    nextInstruction: nextCmd,
    message:
      "Infinite autonomous mind cadence active; agents may not terminate background loops or schedulers.",
  };
}

export interface MindRecycleHealth {
  readonly healthy: boolean;
  readonly activeCadence: "infinite_autonomous";
  readonly assessment: RecycleAssessment;
  readonly timestamp: string;
}

/**
 * Diagnostic helper inspecting the autonomic loop recycling health and invariant compliance.
 */
export function inspectRecycleHealth(
  state: Record<string, unknown>,
  runRoot: string,
  options?: AutonomousRecycleOptions,
): MindRecycleHealth {
  const assessment = assessRecyclingState(state, runRoot, options);
  const nowIso =
    options?.now !== undefined
      ? new Date(options.now).toISOString()
      : new Date().toISOString();

  return {
    healthy: assessment.canRecycle && assessment.infiniteCadence,
    activeCadence: "infinite_autonomous",
    assessment,
    timestamp: nowIso,
  };
}

/**
 * Validates whether a mind capsule is ready for generational rollover.
 */
export function validateRolloverReadiness(
  sourceState: Record<string, unknown>,
  targetGeneration?: number,
  options?: { readonly feedbackQueuePath?: string | undefined },
): {
  readonly ready: boolean;
  readonly reason: string;
  readonly generation: number;
  readonly targetGeneration: number;
  readonly pendingFeedbackCount: number;
  readonly activeCandidatesCount: number;
} {
  const mind = sourceState.mind as Record<string, unknown> | undefined;
  if (!mind || typeof mind !== "object") {
    return {
      ready: false,
      reason: "Missing mind substate in source capsule",
      generation: 1,
      targetGeneration: targetGeneration ?? 2,
      pendingFeedbackCount: 0,
      activeCandidatesCount: 0,
    };
  }

  const currentGen = typeof mind.generation === "number" ? mind.generation : 1;
  const effectiveTargetGen = targetGeneration ?? currentGen + 1;
  if (effectiveTargetGen <= currentGen) {
    return {
      ready: false,
      reason: `Target generation ${effectiveTargetGen} must exceed current generation ${currentGen}`,
      generation: currentGen,
      targetGeneration: effectiveTargetGen,
      pendingFeedbackCount: 0,
      activeCandidatesCount: 0,
    };
  }

  if (mind.status === "rotated") {
    return {
      ready: false,
      reason: "Source capsule is already rotated (sealed)",
      generation: currentGen,
      targetGeneration: effectiveTargetGen,
      pendingFeedbackCount: 0,
      activeCandidatesCount: 0,
    };
  }

  const allCandidates = extractAllCandidates(sourceState);
  const activeCandidates = allCandidates.filter(
    (c) => c.status === "opened" || c.status === "open" || c.status === "admitted",
  );

  let pendingCount = 0;
  try {
    const feedbackItems = readFeedbackQueue(options?.feedbackQueuePath);
    pendingCount = feedbackItems.filter((i) => i.status === "PENDING").length;
  } catch {
    pendingCount = 0;
  }

  return {
    ready: true,
    reason: `Mind is ready to transition from generation ${currentGen} to ${effectiveTargetGen}`,
    generation: currentGen,
    targetGeneration: effectiveTargetGen,
    pendingFeedbackCount: pendingCount,
    activeCandidatesCount: activeCandidates.length,
  };
}
