import { join } from "node:path";
import { computeDefectDiscriminator } from "../core/discriminator.ts";
import {
  aggregateDefectEntries,
  toAggregatedDefect,
  withinDeduplicationWindow,
} from "../aggregator/aggregator.ts";
import type {
  AggregatedDefect,
  DefectCategory,
  DefectRecordInput,
  LiveDeduplicationOptions,
} from "../core/types.ts";

export function deduplicateDefectLog(
  inputs: readonly DefectRecordInput[],
  options: LiveDeduplicationOptions = {},
): AggregatedDefect[] {
  if (!Array.isArray(inputs) || inputs.length === 0) return [];
  const strategy = options.strategy || "aggregate_synchronous";
  const windowMs = options.windowMs ?? 60_000;
  const maxOccurrences = options.maxOccurrences ?? 50;

  if (strategy === "exact_dedup") {
    const seen = new Set<string>();
    const results: AggregatedDefect[] = [];
    for (const inp of inputs) {
      const key = inp.dedup_key || computeDefectDiscriminator(inp);
      if (!seen.has(key)) {
        seen.add(key);
        const entry = toAggregatedDefect(inp);
        options.onNewDefect?.(entry);
        results.push(entry);
      } else {
        const existing = results.find(
          (r) => (r.dedup_key || computeDefectDiscriminator(r)) === key,
        );
        if (existing) options.onDefectDeduplicated?.(existing, existing);
      }
    }
    return results;
  }

  if (strategy === "windowed" || strategy === "sliding_window_hash") {
    const results: AggregatedDefect[] = [];
    const keyToLastEntry = new Map<string, AggregatedDefect>();

    for (const inp of inputs) {
      const key = inp.dedup_key || computeDefectDiscriminator(inp);
      const existing = keyToLastEntry.get(key);
      const incomingTs = inp.timestamp || new Date().toISOString();

      if (existing && withinDeduplicationWindow(existing.last_seen_at, incomingTs, windowMs)) {
        const updated = aggregateDefectEntries(existing, inp, { maxOccurrences });
        const idx = results.indexOf(existing);
        if (idx >= 0) results[idx] = updated;
        keyToLastEntry.set(key, updated);
        options.onDefectDeduplicated?.(updated, existing);
      } else {
        const newEntry = toAggregatedDefect(inp);
        results.push(newEntry);
        keyToLastEntry.set(key, newEntry);
        options.onNewDefect?.(newEntry);
      }
    }
    return results;
  }

  const defectMap = new Map<string, AggregatedDefect>();
  for (const inp of inputs) {
    const key = inp.dedup_key || computeDefectDiscriminator(inp);
    const existing = defectMap.get(key);
    if (existing) {
      const updated = aggregateDefectEntries(existing, inp, { maxOccurrences });
      defectMap.set(key, updated);
      options.onDefectDeduplicated?.(updated, existing);
    } else {
      const entry = toAggregatedDefect(inp);
      defectMap.set(key, entry);
      options.onNewDefect?.(entry);
    }
  }
  return Array.from(defectMap.values());
}

export function parseAndDeduplicateDefectJsonl(
  jsonl: string,
  options: LiveDeduplicationOptions = {},
): AggregatedDefect[] {
  if (!jsonl || typeof jsonl !== "string" || !jsonl.trim()) return [];
  const lines = jsonl.split("\n");
  const inputs: DefectRecordInput[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as DefectRecordInput;
      if (parsed && typeof parsed === "object") {
        inputs.push(parsed);
      }
    } catch {
      // Skip invalid json
    }
  }

  return deduplicateDefectLog(inputs, options);
}

export function serializeAggregatedDefectLog(entries: readonly AggregatedDefect[]): string {
  if (!Array.isArray(entries) || entries.length === 0) return "";
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

function parseChunkInput(chunk: unknown): DefectRecordInput | null {
  if (!chunk) return null;
  if (typeof chunk === "string") {
    const trimmed = chunk.trim();
    if (!trimmed) return null;
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
  const windowMs = options.windowMs ?? 60_000;
  const recent = new Map<string, AggregatedDefect>();

  for await (const rawChunk of source) {
    const input = parseChunkInput(rawChunk);
    if (!input) continue;

    const key = input.dedup_key || computeDefectDiscriminator(input);
    const existing = recent.get(key);
    const incomingTs = input.timestamp || new Date().toISOString();

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
  const windowMs = options.windowMs ?? 60_000;
  const recent = new Map<string, AggregatedDefect>();

  return new TransformStream<string | DefectRecordInput, AggregatedDefect>({
    transform(chunk, controller) {
      const input = parseChunkInput(chunk);
      if (!input) return;

      const key = input.dedup_key || computeDefectDiscriminator(input);
      const existing = recent.get(key);
      const incomingTs = input.timestamp || new Date().toISOString();

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
  const targetAgent = criteria.agentId || criteria.agent_id;
  const sevRank: Record<string, number> = {
    low: 1,
    info: 1,
    warning: 2,
    medium: 2,
    high: 3,
    critical: 4,
  };
  const minRank = criteria.minSeverity ? (sevRank[criteria.minSeverity.toLowerCase()] ?? 0) : 0;

  return defects.filter((d) => {
    if (criteria.category && d.category !== criteria.category) return false;
    if (criteria.status && d.status !== criteria.status) return false;
    if (targetAgent && d.agent_id !== targetAgent) return false;
    if (minRank > 0) {
      const rank = sevRank[(d.severity || "").toLowerCase()] ?? 0;
      if (rank < minRank) return false;
    }
    return true;
  });
}
