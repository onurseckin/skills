/**
 * Clean public facade for Tier 0 Quota Agent & Telemetry Monitor.
 * Invariants: 0 any, 0 suppressions, <= 400 lines.
 */

export type {
  ConstrainedModelInfo,
  QuotaDagSnapshot,
  QuotaEvaluationVerdict,
  QuotaMetric,
  QuotaMonitorOptions,
  QuotaMonitorState,
  QuotaMonitorStatus,
  QuotaSnapshot,
  QuotaStatus,
  QuotaThresholdConfig,
  SentinelOptions,
  SentinelWakeSchedule,
} from "./types.ts";

export {
  AUTO_WAKE_PROMPT,
  CRITICAL_WRAP_UP_MESSAGE,
  DEFAULT_AUTO_WAKE_BUFFER_SECONDS,
  DEFAULT_COOLDOWN_SECONDS,
  DEFAULT_FREEZE_THRESHOLD,
  DEFAULT_MAX_JITTER_SECONDS,
  DEFAULT_RECOVERY_THRESHOLD,
  DEFAULT_SAFE_WINDOW_SECONDS,
  DEFAULT_WARNING_THRESHOLD,
} from "./types.ts";

export {
  evaluateQuotaState,
  extractResetTime,
  normalizePercentage,
  parseRawPercentage,
  type EvaluatorContext,
} from "./evaluator.ts";

export { computeAutoWakeSentinel, parseResetTimeMs } from "./sentinel.ts";

export { QuotaMonitor } from "./monitor.ts";
