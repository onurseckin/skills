import { enforceLineLimit } from "../cli/formatters/line-limiter.ts";
import type { JsonObject } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { DEFAULT_MIND_BUDGET } from "./charter.ts";
import type { CandidateRecord } from "./gates.ts";
import { getAllProposals, type MindProposal } from "./proposal.ts";
import { getAllRounds, type RoundRecord } from "./rounds.ts";

export type RecycleTransitionType =
  | "critic_to_discovery"
  | "critic_to_next_round"
  | "round_to_planning"
  | "candidate_to_planning"
  | "pulse_to_wake"
  | "discovery_to_admission"
  | "quiesce_to_wake";

export type RecyclePhase =
  | "critic_signed_off"
  | "round_closed"
  | "pulse_closed"
  | "candidates_admitted"
  | "idle_discovery"
  | "in_progress"
  | "quiescent";

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
}

export interface AutonomousRecycleOptions {
  readonly runRoot: string;
  readonly actor: string;
  readonly now?: number | Date | string | undefined;
  readonly targetRunRoot?: string | undefined;
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
 * autonomous recycling transition from completeness critic, closed round, or closed pulse.
 */
export function assessRecyclingState(
  state: Record<string, unknown>,
  runRoot: string,
  _options: { readonly now?: number | Date | string | undefined } = {},
): RecycleAssessment {
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  const actor = typeof mindState.actor === "string" ? mindState.actor : "mind-1";
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
      // Round converged: look for next admitted candidate or discover new ones
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

  // 4. Default perpetual mind wake transition
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
  return assessRecyclingState(state, options.runRoot, { now: options.now });
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
 * Plans an autonomous round recycle cycle, formatting the step-by-step instructions.
 */
export function planAutonomousRoundRecycle(
  state: Record<string, unknown>,
  options: AutonomousRecycleOptions,
): RecyclePlan {
  const assessment = assessRecyclingState(state, options.runRoot, { now: options.now });
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
  targetGeneration: number,
): {
  readonly ready: boolean;
  readonly reason: string;
  readonly generation: number;
} {
  const mind = sourceState.mind as Record<string, unknown> | undefined;
  if (!mind || typeof mind !== "object") {
    return {
      ready: false,
      reason: "Missing mind substate in source capsule",
      generation: 1,
    };
  }

  const currentGen = typeof mind.generation === "number" ? mind.generation : 1;
  if (targetGeneration <= currentGen) {
    return {
      ready: false,
      reason: `Target generation ${targetGeneration} must exceed current generation ${currentGen}`,
      generation: currentGen,
    };
  }

  return {
    ready: true,
    reason: `Mind is ready to transition from generation ${currentGen} to ${targetGeneration}`,
    generation: currentGen,
  };
}
