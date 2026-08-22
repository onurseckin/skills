import {
  aggregateBlunderEntries,
  toAggregatedBlunder,
  withinDeduplicationWindow,
} from "./aggregator.ts";
import { computeBlunderDiscriminator } from "./discriminator.ts";
import type {
  AggregatedBlunder,
  BlunderCategory,
  BlunderRecordInput,
  BlunderStatus,
  LiveDeduplicationOptions,
} from "./types.ts";

export function deduplicateBlunderLog(
  blunders: readonly BlunderRecordInput[],
  options: LiveDeduplicationOptions = {},
): AggregatedBlunder[] {
  if (!Array.isArray(blunders) || blunders.length === 0) {
    return [];
  }

  const strategy = options.strategy ? options.strategy : "aggregate_synchronous";
  const windowMs = options.windowMs ?? 60_000;
  const maxOccurrences = options.maxOccurrencesTracked ?? 50;

  if (strategy === "exact_dedup") {
    const seen = new Set<string>();
    const result: AggregatedBlunder[] = [];
    for (const b of blunders) {
      if (!b) continue;
      const key = computeBlunderDiscriminator(b, options.keyOptions);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(
          toAggregatedBlunder(
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

    const result: AggregatedBlunder[] = [];
    for (const b of blunders) {
      if (!b) continue;
      const key = computeBlunderDiscriminator(b, keyOpts);
      const incomingTs = b.timestamp ?? new Date().toISOString();
      const existingIdx = result.findLastIndex((entry) => entry.dedup_key === key);

      if (existingIdx >= 0) {
        const existing = result[existingIdx];
        if (existing && withinDeduplicationWindow(existing.last_seen_at, incomingTs, windowMs)) {
          const updated = aggregateBlunderEntries(existing, b, {
            maxOccurrences,
          });
          result[existingIdx] = updated;
          if (options.onBlunderDeduplicated) {
            options.onBlunderDeduplicated(updated, b);
          }
          continue;
        }
      }

      const created = toAggregatedBlunder(
        b,
        keyOpts !== undefined ? { keyOptions: keyOpts } : {},
      );
      result.push(created);
      if (options.onNewBlunder) {
        options.onNewBlunder(created);
      }
    }
    return result;
  }

  // Default: aggregate_synchronous
  const map = new Map<string, AggregatedBlunder>();
  for (const b of blunders) {
    if (!b) continue;
    const key = computeBlunderDiscriminator(b, options.keyOptions);
    const existing = map.get(key);
    if (!existing) {
      const created = toAggregatedBlunder(
        b,
        options.keyOptions !== undefined ? { keyOptions: options.keyOptions } : {},
      );
      map.set(key, created);
      if (options.onNewBlunder) {
        options.onNewBlunder(created);
      }
    } else {
      const updated = aggregateBlunderEntries(existing, b, { maxOccurrences });
      map.set(key, updated);
      if (options.onBlunderDeduplicated) {
        options.onBlunderDeduplicated(updated, b);
      }
    }
  }

  return Array.from(map.values());
}

export function parseAndDeduplicateBlunderJsonl(
  jsonlContent: string,
  options: LiveDeduplicationOptions = {},
): AggregatedBlunder[] {
  if (typeof jsonlContent !== "string" || !jsonlContent.trim()) {
    return [];
  }

  const rawLines = jsonlContent.split("\n");
  const inputs: BlunderRecordInput[] = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        inputs.push(parsed as BlunderRecordInput);
      }
    } catch {
      // Ignore unparseable lines gracefully
    }
  }

  return deduplicateBlunderLog(inputs, options);
}

export function serializeAggregatedBlunderLog(
  blunders: readonly AggregatedBlunder[],
): string {
  if (!Array.isArray(blunders) || blunders.length === 0) {
    return "";
  }
  return `${blunders.map((b) => JSON.stringify(b)).join("\n")}\n`;
}

/**
 * Asynchronous generator for stream-deduplicating blunder items on the fly.
 */
export async function* streamDeduplicateBlunders(
  stream: AsyncIterable<string | BlunderRecordInput>,
  options: LiveDeduplicationOptions = {},
): AsyncGenerator<AggregatedBlunder, void, unknown> {
  const windowMs = options.windowMs ?? 60_000;
  const maxOccurrences = options.maxOccurrencesTracked ?? 50;
  const slidingWindow: AggregatedBlunder[] = [];

  for await (const rawItem of stream) {
    let blunderInput: BlunderRecordInput | null = null;
    if (typeof rawItem === "string") {
      const trimmed = rawItem.trim();
      if (!trimmed) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          blunderInput = parsed as BlunderRecordInput;
        }
      } catch {
        continue;
      }
    } else if (typeof rawItem === "object" && rawItem !== null) {
      blunderInput = rawItem;
    }

    if (!blunderInput) continue;

    const key = computeBlunderDiscriminator(blunderInput, options.keyOptions);
    const incomingTs = blunderInput.timestamp ?? new Date().toISOString();
    const existingIdx = slidingWindow.findLastIndex((entry) => entry.dedup_key === key);

    if (existingIdx >= 0) {
      const existing = slidingWindow[existingIdx];
      if (existing && withinDeduplicationWindow(existing.last_seen_at, incomingTs, windowMs)) {
        const updated = aggregateBlunderEntries(existing, blunderInput, { maxOccurrences });
        slidingWindow[existingIdx] = updated;
        yield updated;
        continue;
      }
    }

    const created = toAggregatedBlunder(
      blunderInput,
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
 * Creates a standard TransformStream for deduplicating incoming blunder logs.
 */
export function createBlunderDedupTransformStream(
  options: LiveDeduplicationOptions = {},
): TransformStream<string | BlunderRecordInput, AggregatedBlunder> {
  const activeEntries = new Map<string, AggregatedBlunder>();
  const windowMs = options.windowMs ?? 60_000;
  const maxOccurrences = options.maxOccurrencesTracked ?? 50;

  return new TransformStream<string | BlunderRecordInput, AggregatedBlunder>({
    transform(chunk, controller) {
      let input: BlunderRecordInput | null = null;
      if (typeof chunk === "string") {
        const trimmed = chunk.trim();
        if (!trimmed) return;
        try {
          const parsed: unknown = JSON.parse(trimmed);
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            input = parsed as BlunderRecordInput;
          }
        } catch {
          return;
        }
      } else if (typeof chunk === "object" && chunk !== null) {
        input = chunk;
      }

      if (!input) return;

      const key = computeBlunderDiscriminator(input, options.keyOptions);
      const existing = activeEntries.get(key);
      const incomingTs = input.timestamp ?? new Date().toISOString();

      if (existing && withinDeduplicationWindow(existing.last_seen_at, incomingTs, windowMs)) {
        const updated = aggregateBlunderEntries(existing, input, { maxOccurrences });
        activeEntries.set(key, updated);
        controller.enqueue(updated);
      } else {
        const created = toAggregatedBlunder(
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
 * Filters a list of blunders by category, status, min severity, or agent ID.
 */
export function filterBlunderStream(
  blunders: readonly AggregatedBlunder[],
  filter: {
    readonly category?: BlunderCategory | undefined;
    readonly status?: BlunderStatus | undefined;
    readonly minSeverity?: string | undefined;
    readonly agentId?: string | undefined;
  },
): AggregatedBlunder[] {
  return blunders.filter((b) => {
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
