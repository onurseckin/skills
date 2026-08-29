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
