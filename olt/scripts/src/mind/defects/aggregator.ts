export {
  pickHigherSeverity,
  normalizeStatus,
  withinDeduplicationWindow,
  toAggregatedDefect,
  aggregateDefectEntries,
  mergeDefectSets,
  calculateDefectAggregateMetrics,
  clusterDefectsBySimilarity,
} from "./aggregator/index.ts";
export type { DefectMetricsResult } from "./aggregator/index.ts";
