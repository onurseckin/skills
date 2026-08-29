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
  if (!status) return "open";
  const s = status.toLowerCase().trim();
  if (s === "wont_fix" || s === "wont-fix" || s === "wontfix") return "wontfix";
  if (s === "resolved" || s === "completed") return "resolved";
  return "open";
}

export function mergeDefectSets(
  setA: readonly AggregatedDefect[],
  setB: readonly AggregatedDefect[],
  options: LiveDeduplicationOptions = {},
): AggregatedDefect[] {
  const map = new Map<string, AggregatedDefect>();
  for (const item of setA) {
    const key = item.dedup_key || computeDefectDiscriminator(item);
    map.set(key, item);
  }
  for (const item of setB) {
    const key = item.dedup_key || computeDefectDiscriminator(item);
    const existing = map.get(key);
    if (existing) {
      map.set(key, aggregateDefectEntries(existing, item, options));
    } else {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}
