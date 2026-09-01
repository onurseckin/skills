export type DialecticalLevel =
  | "L1_TRADE_OFF_VERIFICATION"
  | "L2_SECOND_ORDER_IMPLICATIONS"
  | "L3_EMERGENT_PARADIGMS";

export const DIALECTICAL_LEVELS = {
  L1_TRADE_OFF_VERIFICATION: "L1_TRADE_OFF_VERIFICATION",
  L2_SECOND_ORDER_IMPLICATIONS: "L2_SECOND_ORDER_IMPLICATIONS",
  L3_EMERGENT_PARADIGMS: "L3_EMERGENT_PARADIGMS",
} as const;

export type CommitmentStatus = "pending" | "fulfilled" | "breached" | "superseded";

export const COMMITMENT_STATUSES = {
  PENDING: "pending",
  FULFILLED: "fulfilled",
  BREACHED: "breached",
  SUPERSEDED: "superseded",
} as const;

export interface StrategicCommitment {
  readonly id: string;
  readonly topic: string;
  readonly agreedResolution: string;
  readonly targetMilestone: string;
  readonly status: CommitmentStatus;
  readonly justification?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const PARETO_PRIORITY_LEVELS = {
  UX_DELIGHT_AND_CORRECTNESS: 1,
  SIMPLICITY_AND_MAINTAINABILITY: 2,
  SCALABILITY_GEQ_15_PERCENT: 3,
  SPECULATIVE_ABSTRACTION: 4,
} as const;

export type ParetoPriorityLevel = 1 | 2 | 3 | 4;

export const IMPASSE_CRUCIBLE_THRESHOLD = 2;
export const SCALABILITY_THRESHOLD_PERCENT = 15;

export interface StrategicResolution {
  readonly id: string;
  readonly cycleId: string;
  readonly topic: string;
  readonly consensusReached: boolean;
  readonly winningApproach: string;
  readonly paretoPriorityLevel: ParetoPriorityLevel;
  readonly settledInvariant: string;
  readonly commitments: readonly StrategicCommitment[];
  readonly recordedAt: string;
}

export interface DebateExchange {
  readonly id: string;
  readonly cycleId: string;
  readonly level: DialecticalLevel;
  readonly inquiry: string;
  readonly response?: string | undefined;
  readonly unfulfilledCommitmentId?: string | undefined;
  readonly requiresCrucible: boolean;
  readonly createdAt: string;
}

export interface SocraticLadderingState {
  readonly currentLevel: DialecticalLevel;
  readonly consecutiveImpasseCycles: number;
  readonly activeExchange?: DebateExchange | undefined;
  readonly history: readonly DebateExchange[];
  readonly consensusReached?: boolean | undefined;
}

export interface ParetoApproachInput {
  readonly name: string;
  readonly satisfiesPriority: ParetoPriorityLevel;
  readonly perfGainPercent?: number | undefined;
  readonly cognitiveComplexityScore?: number | undefined;
  readonly hasErrors?: boolean | undefined;
}

export interface ParetoComparisonMetrics {
  readonly perfGainDiffPercent?: number | undefined;
  readonly complexityDiff?: number | undefined;
  readonly correctnessWinner?: string | undefined;
}

export interface ParetoComparisonResult {
  readonly winner: string;
  readonly winningLevel: ParetoPriorityLevel;
  readonly loser: string;
  readonly losingLevel: ParetoPriorityLevel;
  readonly rationale: string;
  readonly deltaMetrics?: ParetoComparisonMetrics | undefined;
}

export interface SocraticEvaluationResult {
  readonly isSatisfactory: boolean;
  readonly reason?: string | undefined;
  readonly consensusReached?: boolean | undefined;
}

export interface SocraticCycleContext {
  readonly proposalDetails?: string | undefined;
  readonly candidateApproaches?: readonly ParetoApproachInput[] | undefined;
  readonly targetMilestone?: string | undefined;
  readonly unfulfilledCommitmentId?: string | undefined;
}

export interface SerializedDebateMemory {
  readonly version: number;
  readonly resolutions: readonly StrategicResolution[];
  readonly commitments: readonly StrategicCommitment[];
}
