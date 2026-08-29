/**
 * Omnipresent Time Telemetry & Dual-Time Reporting Subsystem Facade
 */
export {
  type HarnessActionCategory,
  type ActionExecutionStatus,
  HARNESS_ACTION_CATEGORIES,
  ACTION_EXECUTION_STATUSES,
  type SubStepTiming,
  type HarnessActionTimeRecord,
  type StartActionSpanOptions,
  type LatencyPercentiles,
  type CategoryTelemetrySummary,
  type ActorTelemetrySummary,
  type TimeAnomaly,
  type TimeTelemetryHealthResult,
  type TimeTelemetryReport,
  type TelemetryFilter,
  isHarnessActionCategory,
  isActionExecutionStatus,
  isHarnessActionTimeRecord,
  isTimeTelemetryReport,
  isTimeTelemetryHealthResult,
} from "./types.ts";
export { categorizeHarnessAction, computeLatencyPercentiles, ActionSpan } from "./span.ts";
export { validateTimeTelemetryHealth } from "./health.ts";
export { buildTimeTelemetryReport } from "./report-builder.ts";
export { OmnipresentTelemetryCollector } from "./collector.ts";
export {
  enrichWithDualTime,
  enrichHarnessEvent,
  extractDualTime,
  renderDualTimeHeader,
  formatDualTimeTable,
  renderOmnipresentTelemetryMarkdown,
} from "./dual-time.ts";
