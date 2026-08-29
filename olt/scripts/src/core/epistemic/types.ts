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

export const DEFAULT_EPISTEMIC_WEIGHTS: EpistemicWeights = {
  empirical: 0.25,
  coherence: 0.25,
  falsifiability: 0.25,
  stability: 0.15,
  coverage: 0.1,
};

export const DEFAULT_PASS_THRESHOLD = 0.7;
