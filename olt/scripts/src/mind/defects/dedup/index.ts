export { LiveDefectDeduplicator } from "./live-dedup.ts";

export {
  deduplicateDefectLog,
  parseAndDeduplicateDefectJsonl,
  serializeAggregatedDefectLog,
  streamDeduplicateDefects,
  createDefectDedupTransformStream,
  filterDefectStream,
} from "./dedup-stream.ts";
