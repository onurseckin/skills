import {
  aggregateBlunderEntries,
  toAggregatedBlunder,
  withinDeduplicationWindow,
} from "./aggregator.ts";
import { computeBlunderDiscriminator } from "./discriminator.ts";
import type {
  AggregatedBlunder,
  BlunderRecordInput,
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

  if (strategy === "windowed") {
    const result: AggregatedBlunder[] = [];
    for (const b of blunders) {
      if (!b) continue;
      const key = computeBlunderDiscriminator(b, options.keyOptions);
      const incomingTs = b.timestamp ?? new Date().toISOString();
      const existingIdx = result.findLastIndex((entry) => entry.dedup_key === key);

      if (existingIdx >= 0) {
        const existing = result[existingIdx];
        if (existing && withinDeduplicationWindow(existing.last_seen_at, incomingTs, windowMs)) {
          result[existingIdx] = aggregateBlunderEntries(existing, b, {
            maxOccurrences,
          });
          continue;
        }
      }

      result.push(
        toAggregatedBlunder(
          b,
          options.keyOptions !== undefined ? { keyOptions: options.keyOptions } : {},
        ),
      );
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
      map.set(
        key,
        toAggregatedBlunder(
          b,
          options.keyOptions !== undefined ? { keyOptions: options.keyOptions } : {},
        ),
      );
    } else {
      map.set(key, aggregateBlunderEntries(existing, b, { maxOccurrences }));
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
      const parsed = JSON.parse(trimmed) as unknown;
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
