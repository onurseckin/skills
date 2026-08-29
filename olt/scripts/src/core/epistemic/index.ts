export type {
  BayesianBeliefState,
  BayesianEvidence,
  BayesianUpdateOptions,
  EpistemicCacheEntry,
  EpistemicCacheOptions,
  EpistemicCacheStats,
  EpistemicConfidenceLevel,
  EpistemicConfidenceResult,
  EpistemicEvaluationInput,
  EpistemicGrade,
  EpistemicMetricInput,
  EpistemicScoreResult,
  EpistemicVector,
  EpistemicWeights,
  InferenceEdge,
  InferenceGraphSnapshot,
  InferenceNode,
  InferenceNodeKind,
  ShannonEntropyConfig,
  WilsonScoreInterval,
} from "./types.ts";

export { DEFAULT_EPISTEMIC_WEIGHTS, DEFAULT_PASS_THRESHOLD } from "./types.ts";

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

export {
  computeBayesFactor,
  createBayesianBelief,
  fuseEvidenceSources,
  logOddsToProbability,
  oddsToProbability,
  probabilityToLogOdds,
  probabilityToOdds,
  updateBayesianBelief,
} from "./bayesian-inference.ts";

export { EpistemicInferenceCache } from "./inference-cache.ts";

export { InferenceGraph, type AddNodeOptions } from "./inference-graph.ts";

export {
  EpistemicIndexStore,
  EpistemicQueryOptimizer,
  computeEpistemicAggregate,
  matchesEpistemicPredicate,
  type EpistemicQuery,
  type EpistemicQueryAggregate,
  type EpistemicQueryOrder,
  type EpistemicQueryPlan,
  type EpistemicQueryPredicate,
  type EpistemicQueryProjection,
  type EpistemicQueryResult,
  type EpistemicRecord,
} from "./query.ts";

export {
  EpistemicEventBus,
  EpistemicEventJournal,
  EpistemicEventStream,
  type EpistemicEventType,
  type EpistemicStreamEvent,
  type StreamErrorHandler,
  type StreamSubscriber,
  type StreamSubscription,
} from "./streaming.ts";

export {
  EpistemicStateReplayer,
  buildSparseIndexFromState,
  diffEpistemicStates,
  reconstructEpistemicState,
  type EpistemicStateDiff,
  type EpistemicStateSnapshot,
  type ReplayedEpistemicState,
} from "./state-replay.ts";
