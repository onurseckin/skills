export {
  deduplicateDefectLog,
  parseAndDeduplicateDefectJsonl,
  serializeAggregatedDefectLog,
  streamDeduplicateDefects,
  createDefectDedupTransformStream,
  filterDefectStream,
} from "./dedup/dedup-stream.ts";
