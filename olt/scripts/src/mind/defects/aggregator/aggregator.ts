import {
  aggregateDefectEntries,
  computeDefectDiscriminator,
  pickHigherSeverity,
  toAggregatedDefect,
  withinDeduplicationWindow,
} from "../../../logging/defects/index.ts";
import type {
  AggregatedDefect,
  DefectStatus,
  LiveDeduplicationOptions,
} from "../../../logging/defects/index.ts";

export {
  aggregateDefectEntries,
  pickHigherSeverity,
  toAggregatedDefect,
  withinDeduplicationWindow,
};

export function normalizeStatus(status?: string): DefectStatus {
  if (status === undefined) return "open";
  if (status === null) return "open";
  if (status.length === 0) return "open";
  const s = status.toLowerCase().trim();
  if (["wont_fix", "wont-fix", "wontfix"].includes(s)) return "wontfix";
  if (["resolved", "completed"].includes(s)) return "resolved";
  return "open";
}

export function mergeDefectSets(
  setA: readonly AggregatedDefect[],
  setB: readonly AggregatedDefect[],
  options: LiveDeduplicationOptions = {},
): AggregatedDefect[] {
  const map = new Map<string, AggregatedDefect>();
  for (const item of setA) {
    const key =
      item.dedup_key !== undefined && item.dedup_key !== ""
        ? item.dedup_key
        : computeDefectDiscriminator(item);
    map.set(key, item);
  }
  for (const item of setB) {
    const key =
      item.dedup_key !== undefined && item.dedup_key !== ""
        ? item.dedup_key
        : computeDefectDiscriminator(item);
    const existing = map.get(key);
    if (existing) {
      map.set(key, aggregateDefectEntries(existing, item, options));
    } else {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}
