export type {
  AntiIdleIntervalOptions,
  AntiIdleIntervalResult,
  PulseValueMetrics,
  TrailingValuePoint,
  TrailingValueSeries,
} from "../../../core/scheduling/index.ts";

export {
  computeAntiIdleInterval,
  formatIntervalDuration,
  parseDuration,
  parseIntervalDuration,
  projectIntervalProgression,
  generateTrailingValueSeries,
  extractTrailingValueSeriesFromState,
} from "../../../core/scheduling/index.ts";
