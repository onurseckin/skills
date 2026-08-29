export type {
  AntiIdleIntervalOptions,
  AntiIdleIntervalResult,
} from "../../../core/scheduling/index.ts";

export {
  computeAntiIdleInterval,
  formatIntervalDuration,
  parseDuration,
  parseIntervalDuration,
  projectIntervalProgression,
} from "../../../core/scheduling/index.ts";

export interface PulseValueMetrics {
  readonly [key: string]: unknown;
}

export {
  generateTrailingValueSeries,
  extractTrailingValueSeriesFromState,
  type TrailingValuePoint,
  type TrailingValueSeries,
} from "./state.ts";
