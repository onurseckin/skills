import type { FeedbackItem } from "../../feedback/queue/index.ts";

export interface CandidateRecord {
  readonly id: string;
  readonly status?: string | undefined;
  readonly [key: string]: unknown;
}

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
