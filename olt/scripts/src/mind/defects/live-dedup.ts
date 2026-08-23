import { resolveDefect } from "../defects.ts";
import {
  aggregateDefectEntries,
  calculateDefectAggregateMetrics,
  toAggregatedDefect,
  withinDeduplicationWindow,
} from "./aggregator.ts";
import { computeDefectDiscriminator } from "./discriminator.ts";
import { parseAndDeduplicateDefectJsonl, serializeAggregatedDefectLog } from "./dedup-stream.ts";
import type {
  AggregatedDefect,
  DefectAggregateMetrics,
  DefectCategory,
  DefectRecordInput,
  DefectResolutionProof,
  LiveDeduplicationOptions,
} from "./types.ts";

export class LiveDefectDeduplicator {
  private readonly entries = new Map<string, AggregatedDefect>();
  private readonly idToKey = new Map<string, string>();
  private readonly options: LiveDeduplicationOptions;

  constructor(options: LiveDeduplicationOptions = {}) {
    this.options = options;
  }

  public record(defect: DefectRecordInput): {
    readonly isNew: boolean;
    readonly entry: AggregatedDefect;
    readonly occurrenceCount: number;
  } {
    const key = computeDefectDiscriminator(defect, this.options.keyOptions);
    const existing = this.entries.get(key);
    const strategy = this.options.strategy ? this.options.strategy : "aggregate_synchronous";
    const windowMs = this.options.windowMs ?? 60_000;
    const maxOccurrences = this.options.maxOccurrencesTracked ?? 50;

    if (!existing) {
      const entry = toAggregatedDefect(
        defect,
        this.options.keyOptions !== undefined ? { keyOptions: this.options.keyOptions } : {},
      );
      this.entries.set(key, entry);
      this.idToKey.set(entry.id, key);

      if (this.options.maxEntries && this.entries.size > this.options.maxEntries) {
        this.evictOldest(this.options.maxEntries);
      }

      if (this.options.onNewDefect) {
        this.options.onNewDefect(entry);
      }

      return { isNew: true, entry, occurrenceCount: entry.count };
    }

    if (strategy === "exact_dedup") {
      return { isNew: false, entry: existing, occurrenceCount: existing.count };
    }

    if (strategy === "windowed" || strategy === "sliding_window_hash") {
      const incomingTs = defect.timestamp ?? new Date().toISOString();
      if (!withinDeduplicationWindow(existing.last_seen_at, incomingTs, windowMs)) {
        const newEntry = toAggregatedDefect(
          defect,
          this.options.keyOptions !== undefined ? { keyOptions: this.options.keyOptions } : {},
        );
        this.entries.set(key, newEntry);
        this.idToKey.set(newEntry.id, key);

        if (this.options.onNewDefect) {
          this.options.onNewDefect(newEntry);
        }

        return { isNew: true, entry: newEntry, occurrenceCount: newEntry.count };
      }
    }

    const updated = aggregateDefectEntries(existing, defect, { maxOccurrences });
    this.entries.set(key, updated);
    this.idToKey.set(updated.id, key);

    if (this.options.onDefectDeduplicated) {
      this.options.onDefectDeduplicated(updated, defect);
    }

    return { isNew: false, entry: updated, occurrenceCount: updated.count };
  }

  public recordMany(defects: readonly DefectRecordInput[]): readonly AggregatedDefect[] {
    const results: AggregatedDefect[] = [];
    for (const b of defects) {
      const { entry } = this.record(b);
      results.push(entry);
    }
    return results;
  }

  public get(keyOrId: string): AggregatedDefect | undefined {
    const byKey = this.entries.get(keyOrId);
    if (byKey) return byKey;
    const mappedKey = this.idToKey.get(keyOrId);
    return mappedKey ? this.entries.get(mappedKey) : undefined;
  }

  public has(keyOrId: string): boolean {
    return this.get(keyOrId) !== undefined;
  }

  public getAll(): readonly AggregatedDefect[] {
    return Array.from(this.entries.values());
  }

  public getOpenDefects(): readonly AggregatedDefect[] {
    return this.getAll().filter((b) => b.status === "open");
  }

  public getResolvedDefects(): readonly AggregatedDefect[] {
    return this.getAll().filter((b) => b.status === "resolved");
  }

  public getByCategory(category: DefectCategory): readonly AggregatedDefect[] {
    return this.getAll().filter((b) => b.category === category);
  }

  public getBySeverity(severity: string): readonly AggregatedDefect[] {
    const norm = severity.toLowerCase().trim();
    return this.getAll().filter((b) => b.severity.toLowerCase().trim() === norm);
  }

  public resolve(
    keyOrId: string,
    proof: DefectResolutionProof,
    options: { readonly requireCommitSha?: boolean | undefined } = {},
  ): AggregatedDefect | null {
    const existing = this.get(keyOrId);
    if (!existing) return null;
    const resolvedMindEntry = resolveDefect(existing, proof, options);
    const updated: AggregatedDefect = {
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

  public evictOldest(maxEntries: number): number {
    if (this.entries.size <= maxEntries) {
      return 0;
    }

    const sortedEntries = Array.from(this.entries.values()).sort(
      (a, b) => Date.parse(a.last_seen_at) - Date.parse(b.last_seen_at),
    );

    const excessCount = this.entries.size - maxEntries;
    let evicted = 0;

    for (let i = 0; i < excessCount && i < sortedEntries.length; i += 1) {
      const entry = sortedEntries[i];
      if (entry) {
        this.entries.delete(entry.dedup_key);
        this.idToKey.delete(entry.id);
        evicted += 1;
      }
    }

    return evicted;
  }

  public getMetrics(): DefectAggregateMetrics {
    return calculateDefectAggregateMetrics(this.getAll());
  }

  public exportJsonl(): string {
    return serializeAggregatedDefectLog(this.getAll());
  }

  public importJsonl(jsonl: string): number {
    const parsed = parseAndDeduplicateDefectJsonl(jsonl, this.options);
    for (const entry of parsed) {
      this.entries.set(entry.dedup_key, entry);
      this.idToKey.set(entry.id, entry.dedup_key);
    }
    return parsed.length;
  }

  public clear(): void {
    this.entries.clear();
    this.idToKey.clear();
  }

  public get size(): number {
    return this.entries.size;
  }
}
