export type {
  QuiescentSourceObservation,
  QuiescentSourceInput,
  QuiescentValidationResult,
  QuiescentDigest,
} from "./types.ts";

export {
  QUIESCENT_DIGEST_STREAK_THRESHOLD,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  QUIESCENCE_INTERVAL_MULTIPLIER,
  parseQuiescentSourceSpec,
  tryParseQuiescentSourceSpec,
  validateQuiescentScan,
} from "./types.ts";

export {
  computeQuiescentStreak,
  calculateQuiescentInterval,
  shouldTriggerQuiescentDigest,
  formatQuiescentDigestMarkdown,
  buildQuiescentDigest,
} from "./evaluator.ts";
