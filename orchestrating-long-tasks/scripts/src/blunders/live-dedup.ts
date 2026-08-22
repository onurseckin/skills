import { resolveBlunder } from "../mind/blunders.ts";
import {
  aggregateBlunderEntries,
  toAggregatedBlunder,
  withinDeduplicationWindow,
} from "./aggregator.ts";
import { computeBlunderDiscriminator } from "./discriminator.ts";
import type {
  AggregatedBlunder,
  BlunderRecordInput,
  BlunderResolutionProof,
  LiveDeduplicationOptions,
} from "./types.ts";

export class LiveBlunderDeduplicator {
  private readonly entries = new Map<string, AggregatedBlunder>();
  private readonly idToKey = new Map<string, string>();
  private readonly options: LiveDeduplicationOptions;

  constructor(options: LiveDeduplicationOptions = {}) {
    this.options = options;
  }

  public record(blunder: BlunderRecordInput): { isNew: boolean; entry: AggregatedBlunder } {
    const key = computeBlunderDiscriminator(blunder, this.options.keyOptions);
    const existing = this.entries.get(key);
    const strategy = this.options.strategy ? this.options.strategy : "aggregate_synchronous";
    const windowMs = this.options.windowMs ?? 60_000;
    const maxOccurrences = this.options.maxOccurrencesTracked ?? 50;

    if (!existing) {
      const entry = toAggregatedBlunder(
        blunder,
        this.options.keyOptions !== undefined ? { keyOptions: this.options.keyOptions } : {},
      );
      this.entries.set(key, entry);
      this.idToKey.set(entry.id, key);
      return { isNew: true, entry };
    }

    if (strategy === "exact_dedup") {
      return { isNew: false, entry: existing };
    }

    if (strategy === "windowed") {
      const incomingTs = blunder.timestamp ?? new Date().toISOString();
      if (!withinDeduplicationWindow(existing.last_seen_at, incomingTs, windowMs)) {
        const newEntry = toAggregatedBlunder(
          blunder,
          this.options.keyOptions !== undefined ? { keyOptions: this.options.keyOptions } : {},
        );
        this.entries.set(key, newEntry);
        this.idToKey.set(newEntry.id, key);
        return { isNew: true, entry: newEntry };
      }
    }

    const updated = aggregateBlunderEntries(existing, blunder, { maxOccurrences });
    this.entries.set(key, updated);
    this.idToKey.set(updated.id, key);
    return { isNew: false, entry: updated };
  }

  public get(keyOrId: string): AggregatedBlunder | undefined {
    const byKey = this.entries.get(keyOrId);
    if (byKey) return byKey;
    const mappedKey = this.idToKey.get(keyOrId);
    return mappedKey ? this.entries.get(mappedKey) : undefined;
  }

  public has(keyOrId: string): boolean {
    return this.get(keyOrId) !== undefined;
  }

  public getAll(): readonly AggregatedBlunder[] {
    return Array.from(this.entries.values());
  }

  public resolve(keyOrId: string, proof: BlunderResolutionProof): AggregatedBlunder | null {
    const existing = this.get(keyOrId);
    if (!existing) return null;
    const resolvedMindEntry = resolveBlunder(existing, proof);
    const updated: AggregatedBlunder = {
      ...existing,
      status: "resolved",
      resolution: resolvedMindEntry.resolution,
    };
    this.entries.set(existing.dedup_key, updated);
    return updated;
  }

  public prune(maxAgeMs: number, nowMs: number = Date.now()): number {
    let pruned = 0;
    for (const [key, entry] of this.entries.entries()) {
      const lastSeenMs = Date.parse(entry.last_seen_at);
      if (Number.isFinite(lastSeenMs) && nowMs - lastSeenMs > maxAgeMs) {
        this.entries.delete(key);
        this.idToKey.delete(entry.id);
        pruned += 1;
      }
    }
    return pruned;
  }

  public clear(): void {
    this.entries.clear();
    this.idToKey.clear();
  }

  public get size(): number {
    return this.entries.size;
  }
}
