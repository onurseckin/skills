export type EpistemicGrade = "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "VERY_LOW";

export type EpistemicConfidenceLevel =
  | "CERTAIN"
  | "HIGH_CONFIDENCE"
  | "MODERATE_CONFIDENCE"
  | "LOW_CONFIDENCE"
  | "SPECULATIVE"
  | "UNGROUNDED";

export interface EpistemicVector {
  readonly empirical: number;
  readonly coherence: number;
  readonly falsifiability: number;
  readonly stability: number;
  readonly coverage: number;
}

export interface EpistemicEvaluationInput {
  readonly empiricalEvidenceCount: number;
  readonly contradictionCount: number;
  readonly falsifiableGateCount: number;
  readonly totalGateCount: number;
  readonly historicalStability: number;
  readonly testCoverageRatio?: number | undefined;
}

export interface EpistemicConfidenceResult {
  readonly confidenceScore: number;
  readonly grade: EpistemicGrade;
  readonly vector: EpistemicVector;
  readonly passed: boolean;
  readonly reasons: readonly string[];
}

export interface EpistemicWeights {
  readonly empirical: number;
  readonly coherence: number;
  readonly falsifiability: number;
  readonly stability: number;
  readonly coverage: number;
}

export interface ShannonEntropyConfig {
  readonly base?: number;
  readonly normalize?: boolean;
  readonly minLength?: number;
}

export interface WilsonScoreInterval {
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly center: number;
  readonly zScore: number;
}

export interface EpistemicMetricInput {
  readonly positiveEvidenceCount: number;
  readonly totalObservationCount: number;
  readonly confidenceZScore?: number;
  readonly priorWeight?: number;
  readonly entropyFactor?: number;
}

export interface EpistemicScoreResult {
  readonly score: number;
  readonly confidenceLevel: EpistemicConfidenceLevel;
  readonly wilsonInterval: WilsonScoreInterval;
  readonly entropy: number;
  readonly sampleSize: number;
  readonly grounded: boolean;
}

export interface EpistemicCacheEntry<T> {
  readonly key: string;
  readonly value: T;
  readonly timestamp: number;
  readonly expiresAt?: number | undefined;
  readonly dependencies: readonly string[];
  readonly version: number;
}

export interface EpistemicCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly invalidations: number;
  readonly evictions: number;
  readonly size: number;
}

export interface EpistemicCacheOptions {
  readonly defaultTtlMs?: number | undefined;
  readonly maxEntries?: number | undefined;
}

export type InferenceNodeKind = "evidence" | "hypothesis" | "axiom" | "derived";

export interface InferenceNode {
  readonly id: string;
  readonly kind: InferenceNodeKind;
  readonly label: string;
  readonly confidence: number;
  readonly grade: EpistemicGrade;
  readonly isStale: boolean;
  readonly updatedAt: number;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface InferenceEdge {
  readonly sourceId: string;
  readonly targetId: string;
  readonly weight: number;
}

export interface InferenceGraphSnapshot {
  readonly nodes: readonly InferenceNode[];
  readonly edges: readonly InferenceEdge[];
  readonly timestamp: number;
}

export interface BayesianEvidence {
  readonly id: string;
  readonly likelihoodGivenHypothesis: number;
  readonly likelihoodGivenNotHypothesis: number;
  readonly observed: boolean;
  readonly weight?: number | undefined;
}

export interface BayesianBeliefState {
  readonly hypothesisId: string;
  readonly priorProbability: number;
  readonly posteriorProbability: number;
  readonly logOdds: number;
  readonly evidenceCount: number;
  readonly grade: EpistemicGrade;
  readonly confidenceLevel: EpistemicConfidenceLevel;
  readonly updatedAt: number;
}

export interface BayesianUpdateOptions {
  readonly priorProbability?: number | undefined;
  readonly laplaceSmoothing?: number | undefined;
}

export interface EpistemicRecord {
  readonly id: string;
  readonly timestamp: number;
  readonly score: number;
  readonly grade: EpistemicGrade;
  readonly level: EpistemicConfidenceLevel;
  readonly grounded: boolean;
  readonly vector: EpistemicVector;
  readonly entropy: number;
  readonly contradictionCount: number;
  readonly tags: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface EpistemicQueryPredicate {
  readonly minConfidence?: number | undefined;
  readonly maxConfidence?: number | undefined;
  readonly grades?: readonly EpistemicGrade[] | undefined;
  readonly levels?: readonly EpistemicConfidenceLevel[] | undefined;
  readonly grounded?: boolean | undefined;
  readonly contradictions?: boolean | { min?: number; max?: number } | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly createdAfter?: number | undefined;
  readonly createdBefore?: number | undefined;
  readonly minEntropy?: number | undefined;
  readonly maxEntropy?: number | undefined;
}

export interface EpistemicQueryOrder {
  readonly field: "confidence" | "entropy" | "contradictions" | "timestamp" | "grade";
  readonly direction: "asc" | "desc";
}

export type EpistemicQueryProjection = "full" | "summary" | "vector" | "score_only";

export interface EpistemicQuery {
  readonly where?: EpistemicQueryPredicate | undefined;
  readonly orderBy?: readonly EpistemicQueryOrder[] | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly projection?: EpistemicQueryProjection | undefined;
  readonly includeAggregate?: boolean | undefined;
}

export interface EpistemicQueryAggregate {
  readonly count: number;
  readonly meanScore: number;
  readonly medianScore: number;
  readonly stdDevScore: number;
  readonly minScore: number;
  readonly maxScore: number;
  readonly gradeDistribution: Readonly<Record<EpistemicGrade, number>>;
  readonly groundedCount: number;
  readonly meanEntropy: number;
}

export interface EpistemicQueryPlan {
  readonly executionStrategy: "INDEX_SCAN" | "COLLECTION_SCAN" | "EMPTY_MATCH";
  readonly usedIndices: readonly string[];
  readonly estimatedCost: number;
  readonly actualScanCount: number;
  readonly executionTimeMs: number;
  readonly cacheHit: boolean;
}

export interface EpistemicQueryResult<T = EpistemicRecord> {
  readonly records: readonly T[];
  readonly totalMatched: number;
  readonly plan: EpistemicQueryPlan;
  readonly aggregate?: EpistemicQueryAggregate | undefined;
}

export type EpistemicEventType =
  | "claim:registered"
  | "score:recalculated"
  | "contradiction:detected"
  | "grade:transition"
  | "threshold:breach"
  | "entropy:shifted"
  | "stream:heartbeat";

export interface EpistemicStreamEvent<T = Record<string, unknown>> {
  readonly id: string;
  readonly type: EpistemicEventType;
  readonly timestamp: number;
  readonly payload: T;
  readonly source?: string | undefined;
  readonly confidence?: number | undefined;
  readonly grade?: EpistemicGrade | undefined;
}

export interface StreamSubscription {
  readonly id: string;
  unsubscribe(): void;
  readonly active: boolean;
}

export type StreamSubscriber<T> = (event: T) => void | Promise<void>;
export type StreamErrorHandler = (error: Error) => void;

export const DEFAULT_EPISTEMIC_WEIGHTS: EpistemicWeights = {
  empirical: 0.25,
  coherence: 0.25,
  falsifiability: 0.25,
  stability: 0.15,
  coverage: 0.1,
};

export const DEFAULT_PASS_THRESHOLD = 0.7;
