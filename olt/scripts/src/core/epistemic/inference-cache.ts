import { createHash } from "node:crypto";
import type {
  EpistemicCacheEntry,
  EpistemicCacheOptions,
  EpistemicCacheStats,
} from "./types.ts";

export class EpistemicInferenceCache<T> {
  private readonly entries = new Map<string, EpistemicCacheEntry<T>>();
  private readonly dependencyIndex = new Map<string, Set<string>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;
  private hits = 0;
  private misses = 0;
  private invalidations = 0;
  private evictions = 0;

  constructor(options: EpistemicCacheOptions = {}) {
    this.defaultTtlMs = Math.max(0, options.defaultTtlMs ?? 0);
    this.maxEntries = Math.max(1, options.maxEntries ?? 1000);
  }

  public computeKey(payload: unknown, prefix = "epistemic"): string {
    const serialized = JSON.stringify(payload, Object.keys(payload as object || {}).sort());
    const hash = createHash("sha256").update(serialized ?? "").digest("hex").slice(0, 16);
    return `${prefix}:${hash}`;
  }

  public get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }

    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.deleteInternal(key);
      this.evictions += 1;
      this.misses += 1;
      return undefined;
    }

    this.hits += 1;
    return entry.value;
  }

  public set(
    key: string,
    value: T,
    options: {
      readonly ttlMs?: number | undefined;
      readonly dependencies?: readonly string[] | undefined;
    } = {},
  ): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldestKey = this.findOldestKey();
      if (oldestKey) {
        this.deleteInternal(oldestKey);
        this.evictions += 1;
      }
    }

    const ttl = options.ttlMs !== undefined ? Math.max(0, options.ttlMs) : this.defaultTtlMs;
    const expiresAt = ttl > 0 ? Date.now() + ttl : undefined;
    const dependencies = options.dependencies ?? [];

    this.removeDependencyLinks(key);

    const entry: EpistemicCacheEntry<T> = {
      key,
      value,
      timestamp: Date.now(),
      expiresAt,
      dependencies,
      version: 1,
    };

    this.entries.set(key, entry);

    for (const dep of dependencies) {
      let depSet = this.dependencyIndex.get(dep);
      if (!depSet) {
        depSet = new Set<string>();
        this.dependencyIndex.set(dep, depSet);
      }
      depSet.add(key);
    }
  }

  public has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.deleteInternal(key);
      this.evictions += 1;
      return false;
    }
    return true;
  }

  public delete(key: string): boolean {
    if (!this.entries.has(key)) return false;
    this.deleteInternal(key);
    this.invalidations += 1;
    return true;
  }

  public invalidate(key: string): number {
    if (this.delete(key)) return 1;
    return 0;
  }

  public invalidateByDependency(dependencyId: string): number {
    const dependentKeys = this.dependencyIndex.get(dependencyId);
    if (!dependentKeys || dependentKeys.size === 0) return 0;

    const keysToRemove = Array.from(dependentKeys);
    let count = 0;
    for (const key of keysToRemove) {
      if (this.deleteInternal(key)) {
        count += 1;
      }
    }
    this.invalidations += count;
    return count;
  }

  public invalidateByPrefix(prefix: string): number {
    const keysToRemove: string[] = [];
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }

    let count = 0;
    for (const key of keysToRemove) {
      if (this.deleteInternal(key)) {
        count += 1;
      }
    }
    this.invalidations += count;
    return count;
  }

  public pruneExpired(): number {
    const now = Date.now();
    const expiredKeys: string[] = [];
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        expiredKeys.push(key);
      }
    }

    let count = 0;
    for (const key of expiredKeys) {
      if (this.deleteInternal(key)) {
        count += 1;
      }
    }
    this.evictions += count;
    return count;
  }

  public clear(): void {
    const count = this.entries.size;
    this.entries.clear();
    this.dependencyIndex.clear();
    this.invalidations += count;
  }

  public getStats(): EpistemicCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      invalidations: this.invalidations,
      evictions: this.evictions,
      size: this.entries.size,
    };
  }

  public resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.invalidations = 0;
    this.evictions = 0;
  }

  public size(): number {
    return this.entries.size;
  }

  private deleteInternal(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.removeDependencyLinks(key);
    return this.entries.delete(key);
  }

  private removeDependencyLinks(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    for (const dep of entry.dependencies) {
      const depSet = this.dependencyIndex.get(dep);
      if (depSet) {
        depSet.delete(key);
        if (depSet.size === 0) {
          this.dependencyIndex.delete(dep);
        }
      }
    }
  }

  private findOldestKey(): string | undefined {
    let oldestKey: string | undefined;
    let oldestTimestamp = Infinity;

    for (const [key, entry] of this.entries.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    return oldestKey;
  }
}
