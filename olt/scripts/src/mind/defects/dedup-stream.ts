import {
  aggregateDefectEntries,
  toAggregatedDefect,
  withinDeduplicationWindow,
} from "./aggregator.ts";
import { computeDefectDiscriminator } from "./discriminator.ts";
import type {
  AggregatedDefect,
  DefectCategory,
  DefectRecordInput,
  DefectStatus,
  LiveDeduplicationOptions,
} from "./types.ts";

export function deduplicateDefectLog(
  defects: readonly DefectRecordInput[],
  options: LiveDeduplicationOptions = {},
): AggregatedDefect[] {
  if (!Array.isArray(defects) || defects.length === 0) {
    return [];
  }

  const strategy = options.strategy ? options.strategy : "aggregate_synchronous";
  const windowMs = options.windowMs ?? 60_000;
  const maxOccurrences = options.maxOccurrencesTracked ?? 50;

  if (strategy === "exact_dedup") {
    const seen = new Set<string>();
    const result: AggregatedDefect[] = [];
    for (const b of defects) {
      if (!b) continue;
      const key = computeDefectDiscriminator(b, options.keyOptions);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(
          toAggregatedDefect(
            b,
            options.keyOptions !== undefined ? { keyOptions: options.keyOptions } : {},
          ),
        );
      }
    }
    return result;
  }

  if (strategy === "windowed" || strategy === "sliding_window_hash") {
    const keyOpts =
      strategy === "sliding_window_hash"
        ? { ...(options.keyOptions ?? {}), useContentHash: true }
        : options.keyOptions;

    const result: AggregatedDefect[] = [];
    for (const b of defects) {
      if (!b) continue;
      const key = computeDefectDiscriminator(b, keyOpts);
      const incomingTs = b.timestamp ?? new Date().toISOString();
      const existingIdx = result.findLastIndex((entry) => entry.dedup_key === key);

      if (existingIdx >= 0) {
        const existing = result[existingIdx];
        if (existing && withinDeduplicationWindow(existing.last_seen_at, incomingTs, windowMs)) {
          const updated = aggregateDefectEntries(existing, b, {
            maxOccurrences,
          });
          result[existingIdx] = updated;
          if (options.onDefectDeduplicated) {
            options.onDefectDeduplicated(updated, b);
          }
          continue;
        }
      }

      const created = toAggregatedDefect(b, keyOpts !== undefined ? { keyOptions: keyOpts } : {});
      result.push(created);
      if (options.onNewDefect) {
        options.onNewDefect(created);
      }
    }
    return result;
  }

  // Default: aggregate_synchronous
  const map = new Map<string, AggregatedDefect>();
  for (const b of defects) {
    if (!b) continue;
    const key = computeDefectDiscriminator(b, options.keyOptions);
    const existing = map.get(key);
    if (!existing) {
      const created = toAggregatedDefect(
        b,
        options.keyOptions !== undefined ? { keyOptions: options.keyOptions } : {},
      );
      map.set(key, created);
      if (options.onNewDefect) {
        options.onNewDefect(created);
      }
    } else {
      const updated = aggregateDefectEntries(existing, b, { maxOccurrences });
      map.set(key, updated);
      if (options.onDefectDeduplicated) {
        options.onDefectDeduplicated(updated, b);
      }
    }
  }

  return Array.from(map.values());
}

export function parseAndDeduplicateDefectJsonl(
  jsonlContent: string,
  options: LiveDeduplicationOptions = {},
): AggregatedDefect[] {
  if (typeof jsonlContent !== "string" || !jsonlContent.trim()) {
    return [];
  }

  const rawLines = jsonlContent.split("\n");
  const inputs: DefectRecordInput[] = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        inputs.push(parsed as DefectRecordInput);
      }
    } catch {
      // Ignore unparseable lines gracefully
    }
  }

  return deduplicateDefectLog(inputs, options);
}

export function serializeAggregatedDefectLog(defects: readonly AggregatedDefect[]): string {
  if (!Array.isArray(defects) || defects.length === 0) {
    return "";
  }
  return `${defects.map((b) => JSON.stringify(b)).join("\n")}\n`;
}

/**
 * Asynchronous generator for stream-deduplicating defect items on the fly.
 */
export async function* streamDeduplicateDefects(
  stream: AsyncIterable<string | DefectRecordInput>,
  options: LiveDeduplicationOptions = {},
): AsyncGenerator<AggregatedDefect, void, unknown> {
  const windowMs = options.windowMs ?? 60_000;
  const maxOccurrences = options.maxOccurrencesTracked ?? 50;
  const slidingWindow: AggregatedDefect[] = [];

  for await (const rawItem of stream) {
    let defectInput: DefectRecordInput | null = null;
    if (typeof rawItem === "string") {
      const trimmed = rawItem.trim();
      if (!trimmed) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          defectInput = parsed as DefectRecordInput;
        }
      } catch {
        continue;
      }
    } else if (typeof rawItem === "object" && rawItem !== null) {
      defectInput = rawItem;
    }

    if (!defectInput) continue;

    const key = computeDefectDiscriminator(defectInput, options.keyOptions);
    const incomingTs = defectInput.timestamp ?? new Date().toISOString();
    const existingIdx = slidingWindow.findLastIndex((entry) => entry.dedup_key === key);

    if (existingIdx >= 0) {
      const existing = slidingWindow[existingIdx];
      if (existing && withinDeduplicationWindow(existing.last_seen_at, incomingTs, windowMs)) {
        const updated = aggregateDefectEntries(existing, defectInput, { maxOccurrences });
        slidingWindow[existingIdx] = updated;
        yield updated;
        continue;
      }
    }

    const created = toAggregatedDefect(
      defectInput,
      options.keyOptions !== undefined ? { keyOptions: options.keyOptions } : {},
    );
    slidingWindow.push(created);
    if (options.maxEntries && slidingWindow.length > options.maxEntries) {
      slidingWindow.shift();
    }
    yield created;
  }
}

/**
 * Creates a standard TransformStream for deduplicating incoming defect logs.
 */
export function createDefectDedupTransformStream(
  options: LiveDeduplicationOptions = {},
): TransformStream<string | DefectRecordInput, AggregatedDefect> {
  const activeEntries = new Map<string, AggregatedDefect>();
  const windowMs = options.windowMs ?? 60_000;
  const maxOccurrences = options.maxOccurrencesTracked ?? 50;

  return new TransformStream<string | DefectRecordInput, AggregatedDefect>({
    transform(chunk, controller) {
      let input: DefectRecordInput | null = null;
      if (typeof chunk === "string") {
        const trimmed = chunk.trim();
        if (!trimmed) return;
        try {
          const parsed: unknown = JSON.parse(trimmed);
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            input = parsed as DefectRecordInput;
          }
        } catch {
          return;
        }
      } else if (typeof chunk === "object" && chunk !== null) {
        input = chunk;
      }

      if (!input) return;

      const key = computeDefectDiscriminator(input, options.keyOptions);
      const existing = activeEntries.get(key);
      const incomingTs = input.timestamp ?? new Date().toISOString();

      if (existing && withinDeduplicationWindow(existing.last_seen_at, incomingTs, windowMs)) {
        const updated = aggregateDefectEntries(existing, input, { maxOccurrences });
        activeEntries.set(key, updated);
        controller.enqueue(updated);
      } else {
        const created = toAggregatedDefect(
          input,
          options.keyOptions !== undefined ? { keyOptions: options.keyOptions } : {},
        );
        activeEntries.set(key, created);
        if (options.maxEntries && activeEntries.size > options.maxEntries) {
          const firstKey = activeEntries.keys().next().value;
          if (firstKey !== undefined) {
            activeEntries.delete(firstKey);
          }
        }
        controller.enqueue(created);
      }
    },
  });
}

/**
 * Filters a list of defects by category, status, min severity, or agent ID.
 */
export function filterDefectStream(
  defects: readonly AggregatedDefect[],
  filter: {
    readonly category?: DefectCategory | undefined;
    readonly status?: DefectStatus | undefined;
    readonly minSeverity?: string | undefined;
    readonly agentId?: string | undefined;
  },
): AggregatedDefect[] {
  return defects.filter((b) => {
    if (filter.category && b.category !== filter.category) {
      return false;
    }
    if (filter.status && b.status !== filter.status) {
      return false;
    }
    if (filter.agentId && b.agent_id !== filter.agentId) {
      return false;
    }
    return true;
  });
}
