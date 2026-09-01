import type {
  ParetoApproachCandidate,
  ParetoArbitrationResult,
  ParetoPriorityLevel,
} from "../planning/pareto-arbitration.ts";

/**
 * Minimum empirical performance/functional delta required to challenge or reopen
 * a Settled Bedrock Invariant (order-of-magnitude proof: >= 10x or 1000%).
 */
export const ORDER_OF_MAGNITUDE_REOPEN_THRESHOLD = 10.0;

export const DEFAULT_SPIKE_TIMEBOX_MINUTES = 60;
export const DEFAULT_SPIKE_TIMEBOX_MS = DEFAULT_SPIKE_TIMEBOX_MINUTES * 60 * 1000;

export type HypothesisMetricDirection = "increase" | "decrease" | "no_regression";

export type HypothesisValidationMethod =
  | "benchmark"
  | "stress_test"
  | "unit_suite"
  | "load_test"
  | "simulation"
  | "heuristic"
  | "code_inspection";

export interface FalsifiableHypothesis {
  readonly id: string;
  readonly statement: string;
  readonly nullHypothesis: string;
  readonly targetMetric: string;
  readonly expectedDirection: HypothesisMetricDirection;
  readonly thresholdDeltaPercent: number;
  readonly falsificationCriteria: string;
  readonly validationMethod: HypothesisValidationMethod;
  readonly baselineValue?: number | undefined;
  readonly targetValue?: number | undefined;
}

export type PrototypeSpikeStatus = "PROPOSED" | "IN_SPIKE" | "EVALUATED" | "SETTLED" | "CANCELLED";

export const PROTOTYPE_SPIKE_STATUSES = {
  PROPOSED: "PROPOSED",
  IN_SPIKE: "IN_SPIKE",
  EVALUATED: "EVALUATED",
  SETTLED: "SETTLED",
  CANCELLED: "CANCELLED",
} as const;

export interface PrototypeSpikeConfig {
  readonly spikeId: string;
  readonly title: string;
  readonly topic: string;
  readonly hypothesis: FalsifiableHypothesis;
  readonly sandboxScope: string | readonly string[];
  readonly timeBoxDurationMs?: number | undefined;
  readonly timeBoxMinutes?: number | undefined;
  readonly candidateApproaches?: readonly ParetoApproachCandidate[] | undefined;
  readonly createdAt?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface AntiPatternRecord {
  readonly id: string;
  readonly name: string;
  readonly topic: string;
  readonly description: string;
  readonly rejectedApproach: string;
  readonly rejectionReason: string;
  readonly discoveredInSpikeId?: string | undefined;
  readonly discoveredAt: string;
}

export interface PrototypeSpikeResult {
  readonly spikeId: string;
  readonly title: string;
  readonly topic: string;
  readonly status: PrototypeSpikeStatus;
  readonly hypothesis: FalsifiableHypothesis;
  readonly sandboxScope: readonly string[];
  readonly timeBoxDurationMs: number;
  readonly startedAt: string;
  readonly completedAt?: string | undefined;
  readonly candidateResults: readonly ParetoApproachCandidate[];
  readonly winningCandidate?: ParetoApproachCandidate | undefined;
  readonly arbitrationResult?: ParetoArbitrationResult | undefined;
  readonly hypothesisValidated?: boolean | undefined;
  readonly hypothesisValidationSummary?: string | undefined;
  readonly empiricalData?: Readonly<Record<string, unknown>> | undefined;
  readonly artifacts?: readonly string[] | undefined;
  readonly antiPatternsIdentified?: readonly AntiPatternRecord[] | undefined;
  readonly cancellationReason?: string | undefined;
  readonly settledInvariantId?: string | undefined;
}

export type SettledInvariantStatus = "ACTIVE" | "CHALLENGED" | "SUPERSEDED" | "DEPRECATED";

export const SETTLED_INVARIANT_STATUSES = {
  ACTIVE: "ACTIVE",
  CHALLENGED: "CHALLENGED",
  SUPERSEDED: "SUPERSEDED",
  DEPRECATED: "DEPRECATED",
} as const;

export type SettledInvariantHistoryAction =
  | "COMMITTED"
  | "CHALLENGE_REJECTED"
  | "CHALLENGE_ACCEPTED"
  | "SUPERSEDED"
  | "DEPRECATED";

export interface SettledInvariantHistoryEntry {
  readonly timestamp: string;
  readonly action: SettledInvariantHistoryAction;
  readonly reason: string;
  readonly challengerId?: string | undefined;
  readonly empiricalDeltaRatio?: number | undefined;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export interface SettledInvariant {
  readonly invariantId: string;
  readonly topic: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly winningApproach: string;
  readonly paretoPriorityLevel: ParetoPriorityLevel;
  readonly arbitrationSummary: string;
  readonly timestamp: string;
  /** Required ratio to reopen (enforces >= 10.0, i.e. 10x / 1000% delta) */
  readonly reopenThreshold: number;
  readonly status: SettledInvariantStatus;
  readonly spikeId?: string | undefined;
  readonly candidateApproachesEvaluated?: readonly string[] | undefined;
  readonly empiricalEvidence?: Readonly<Record<string, unknown>> | undefined;
  readonly antiPatterns?: readonly string[] | undefined;
  readonly history: readonly SettledInvariantHistoryEntry[];
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface CommitInvariantInput {
  readonly invariantId?: string | undefined;
  readonly topic: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly winningApproach: string;
  readonly paretoPriorityLevel: ParetoPriorityLevel;
  readonly arbitrationSummary: string;
  readonly spikeId?: string | undefined;
  readonly candidateApproachesEvaluated?: readonly string[] | undefined;
  readonly reopenThreshold?: number | undefined;
  readonly empiricalEvidence?: Readonly<Record<string, unknown>> | undefined;
  readonly antiPatterns?: readonly string[] | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface ReopenChallengeInput {
  readonly challengerId: string;
  readonly proposedApproach: string;
  readonly falsifiableClaim: string;
  /** Empirical delta ratio achieved (e.g. 10.0 = 10x, 15.0 = 15x) */
  readonly empiricalPerformanceDeltaRatio: number;
  readonly functionalSuperiorityProof?: string | undefined;
  readonly benchmarkData?: Readonly<Record<string, unknown>> | undefined;
  readonly notes?: string | undefined;
}

export interface ReopenChallengeResult {
  readonly accepted: boolean;
  readonly invariantId: string;
  readonly empiricalDeltaRatio: number;
  readonly requiredThresholdRatio: number;
  readonly reason: string;
  readonly reopenedAt?: string | undefined;
  readonly nextSteps?: readonly string[] | undefined;
}

export interface SettledInvariantStore {
  readonly version: number;
  readonly invariants: readonly SettledInvariant[];
  readonly antiPatterns: readonly AntiPatternRecord[];
  readonly updatedAt: string;
}
