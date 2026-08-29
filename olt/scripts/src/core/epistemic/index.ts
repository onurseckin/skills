export type {
  EpistemicConfidenceLevel,
  EpistemicEvaluationInput,
  EpistemicConfidenceResult,
  EpistemicGrade,
  EpistemicMetricInput,
  EpistemicScoreResult,
  EpistemicVector,
  EpistemicWeights,
  ShannonEntropyConfig,
  WilsonScoreInterval,
} from "./types.ts";

export {
  DEFAULT_EPISTEMIC_WEIGHTS,
  DEFAULT_PASS_THRESHOLD,
} from "./types.ts";

export {
  calculateEpistemicGrade,
  clamp,
  computeEpistemicEntropy,
  computeEvidenceConfidence,
  computeShannonEntropy,
  computeWeightedEpistemicScore,
  computeWilsonScoreInterval,
} from "./math.ts";

export {
  computeEpistemicVector,
  evaluateEpistemicConfidence,
  type EvaluateEpistemicOptions,
} from "./evaluator.ts";
