import {
  aggregateDefectEntries,
  computeDefectDiscriminator,
  deduplicateDefectLog,
  parseAndDeduplicateDefectJsonl,
  serializeAggregatedDefectLog,
  toAggregatedDefect,
  withinDeduplicationWindow,
} from "../../../logging/defects/index.ts";
import type {
  AggregatedDefect,
  DefectCategory,
  DefectRecordInput,
  LiveDeduplicationOptions,
} from "../../../logging/defects/index.ts";

export { deduplicateDefectLog, parseAndDeduplicateDefectJsonl, serializeAggregatedDefectLog };

function parseChunkInput(chunk: unknown): DefectRecordInput | null {
  if (chunk === undefined) return null;
  if (chunk === null) return null;
  if (typeof chunk === "string") {
    const trimmed = chunk.trim();
    if (trimmed.length === 0) return null;
    try {
      return JSON.parse(trimmed) as DefectRecordInput;
    } catch {
      return null;
    }
  }
  if (typeof chunk === "object") {
    return chunk as DefectRecordInput;
  }
  return null;
}

export async function* streamDeduplicateDefects(
  source: AsyncIterable<string | DefectRecordInput>,
  options: LiveDeduplicationOptions = {},
): AsyncGenerator<AggregatedDefect, void, unknown> {
  const windowMs = options.windowMs !== undefined ? options.windowMs : 60_000;
  const recent = new Map<string, AggregatedDefect>();

  for await (const rawChunk of source) {
    const input = parseChunkInput(rawChunk);
    if (!input) continue;

    const key =
      input.dedup_key !== undefined && input.dedup_key !== ""
        ? input.dedup_key
        : computeDefectDiscriminator(input);
    const existing = recent.get(key);
    const incomingTs =
      input.timestamp !== undefined && input.timestamp !== ""
        ? input.timestamp
        : new Date().toISOString();

    if (existing && withinDeduplicationWindow(existing.last_seen_at, incomingTs, windowMs)) {
      const updated = aggregateDefectEntries(existing, input, options);
      recent.set(key, updated);
      yield updated;
    } else {
      if (options.maxEntries && recent.size >= options.maxEntries) {
        const oldestKey = recent.keys().next().value;
        if (oldestKey !== undefined) recent.delete(oldestKey);
      }
      const newEntry = toAggregatedDefect(input);
      recent.set(key, newEntry);
      yield newEntry;
    }
  }
}

export function createDefectDedupTransformStream(
  options: LiveDeduplicationOptions = {},
): TransformStream<string | DefectRecordInput, AggregatedDefect> {
  const windowMs = options.windowMs !== undefined ? options.windowMs : 60_000;
  const recent = new Map<string, AggregatedDefect>();

  return new TransformStream<string | DefectRecordInput, AggregatedDefect>({
    transform(chunk, controller) {
      const input = parseChunkInput(chunk);
      if (!input) return;

      const key =
        input.dedup_key !== undefined && input.dedup_key !== ""
          ? input.dedup_key
          : computeDefectDiscriminator(input);
      const existing = recent.get(key);
      const incomingTs =
        input.timestamp !== undefined && input.timestamp !== ""
          ? input.timestamp
          : new Date().toISOString();

      if (existing && withinDeduplicationWindow(existing.last_seen_at, incomingTs, windowMs)) {
        const updated = aggregateDefectEntries(existing, input, options);
        recent.set(key, updated);
        controller.enqueue(updated);
      } else {
        if (options.maxEntries && recent.size >= options.maxEntries) {
          const oldestKey = recent.keys().next().value;
          if (oldestKey !== undefined) recent.delete(oldestKey);
        }
        const newEntry = toAggregatedDefect(input);
        recent.set(key, newEntry);
        controller.enqueue(newEntry);
      }
    },
  });
}

export function filterDefectStream(
  defects: readonly AggregatedDefect[],
  criteria: {
    readonly category?: DefectCategory | undefined;
    readonly status?: string | undefined;
    readonly minSeverity?: string | undefined;
    readonly agentId?: string | undefined;
    readonly agent_id?: string | undefined;
  },
): readonly AggregatedDefect[] {
  const targetAgent =
    criteria.agentId !== undefined && criteria.agentId !== ""
      ? criteria.agentId
      : criteria.agent_id;
  const sevRank: Record<string, number> = {
    low: 1,
    info: 1,
    warning: 2,
    medium: 2,
    high: 3,
    critical: 4,
  };
  let minRank = 0;
  if (criteria.minSeverity !== undefined) {
    const r = sevRank[criteria.minSeverity.toLowerCase()];
    if (r !== undefined) minRank = r;
  }

  return defects.filter((d) => {
    if (criteria.category && d.category !== criteria.category) return false;
    if (criteria.status && d.status !== criteria.status) return false;
    if (targetAgent && d.agent_id !== targetAgent) return false;
    if (minRank > 0) {
      const sevStr = d.severity !== undefined ? d.severity : "";
      const rankVal = sevRank[sevStr.toLowerCase()];
      const rank = rankVal !== undefined ? rankVal : 0;
      if (rank < minRank) return false;
    }
    return true;
  });
}
