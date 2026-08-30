import { readFeedbackQueueStrict } from "../../feedback/index.ts";
import { getAllRounds } from "../../lifecycle/rounds/index.ts";
import { DEFAULT_MIND_BUDGET } from "../../lifecycle/charter/index.ts";
import { extractAllCandidates } from "./types.ts";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import type { RecycleAssessment, AssessRecyclingOptions, RecyclePhase } from "./types.ts";
import { loadCharter } from "../../lifecycle/charter/index.ts";

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

  if (completionReview && typeof completionReview.status === "string") {
    if (completionReview.status === "clean") {
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

      if (options.checkFeedbackQueue === true || options.feedbackQueuePath !== undefined) {
        const pendingFeedbacks = readFeedbackQueueStrict(options.feedbackQueuePath).filter(
          (item) => item.status === "PENDING",
        );

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

  if (
    !openRound &&
    allRounds.length > 0 &&
    allRounds.every((r) => r.status === "closed" && r.result === "converged") &&
    (options.checkFeedbackQueue === true || options.feedbackQueuePath !== undefined)
  ) {
    const pendingFeedbacks = readFeedbackQueueStrict(options.feedbackQueuePath).filter(
      (item) => item.status === "PENDING",
    );

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
