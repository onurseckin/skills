export {
  pickHigherSeverity,
  normalizeStatus,
  withinDeduplicationWindow,
  toAggregatedDefect,
  aggregateDefectEntries,
  mergeDefectSets,
} from "./aggregator.ts";

export {
  calculateDefectAggregateMetrics,
  clusterDefectsBySimilarity,
} from "./metrics.ts";
export type { DefectMetricsResult } from "./metrics.ts";
