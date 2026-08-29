import type { MemoryKind } from "./core/index.ts";
import { MEMORY_KINDS } from "./core/index.ts";

export interface MemoryIndexTelemetry {
  readonly totalIndexedDocuments: number;
  readonly documentsByKind: Readonly<Record<MemoryKind, number>>;
  readonly totalTokensIndexed: number;
  readonly averageTokensPerDocument: number;
  readonly lastIndexedAt: string | null;
  readonly indexOperationsCount: number;
  readonly totalIndexingDurationMs: number;
  readonly averageIndexingDurationMs: number;
}

export interface MemorySearchTelemetry {
  readonly totalSearches: number;
  readonly totalMatches: number;
  readonly zeroResultSearches: number;
  readonly averageMatchesPerSearch: number;
  readonly totalSearchDurationMs: number;
  readonly averageSearchDurationMs: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cacheHitRate: number;
  readonly lastSearchedAt: string | null;
  readonly topTerms: readonly { readonly term: string; readonly count: number }[];
}

export interface MemoryTelemetrySnapshot {
  readonly index: MemoryIndexTelemetry;
  readonly search: MemorySearchTelemetry;
  readonly totalOperations: number;
  readonly uptimeMs: number;
  readonly startedAt: string;
  readonly lastActivityAt: string | null;
}

export interface RecordIndexTelemetryOptions {
  readonly documentsCount: number;
  readonly tokensCount?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly byKind?: Partial<Record<MemoryKind, number>> | undefined;
}

export interface RecordSearchTelemetryOptions {
  readonly query?: string | undefined;
  readonly terms?: readonly string[] | undefined;
  readonly matchesCount: number;
  readonly durationMs?: number | undefined;
  readonly cacheHit?: boolean | undefined;
}

export interface MemoryTelemetryEvent {
  readonly type: "index" | "search" | "reset" | "cache_eviction";
  readonly timestamp: string;
  readonly durationMs: number;
  readonly details: Readonly<Record<string, unknown>>;
}

export type MemoryTelemetryListener = (event: MemoryTelemetryEvent) => void;

export interface CognitiveTelemetry {
  readonly timestamp: string;
  readonly index: MemoryIndexTelemetry;
  readonly search: MemorySearchTelemetry;
  readonly totalOperations: number;
  readonly cacheHitRate: number;
  readonly averageLatencyMs: number;
  readonly healthScore: number;
  readonly status: "healthy" | "degraded" | "empty";
  readonly summary: string;
}

export interface ComputeCognitiveTelemetryOptions {
  readonly snapshot?: MemoryTelemetrySnapshot | undefined;
  readonly tracker?: MemoryTelemetryTracker | undefined;
}

function createEmptyKindsMap(): Record<MemoryKind, number> {
  const map: Record<MemoryKind, number> = {
    capsule: 0,
    defect: 0,
    decision: 0,
    charter: 0,
    report: 0,
  };
  for (const k of MEMORY_KINDS) map[k] = 0;
  return map;
}

export function calculateCacheHitRate(hits: number, misses: number): number {
  const total = hits + misses;
  return total <= 0 ? 0 : Math.round((hits / total) * 10000) / 10000;
}

export class MemoryTelemetryTracker {
  private startedAt = new Date().toISOString();
  private startedTimestamp = Date.now();
  private lastActivityAt: string | null = null;
  private totalIndexedDocuments = 0;
  private documentsByKind: Record<MemoryKind, number> = createEmptyKindsMap();
  private totalTokensIndexed = 0;
  private indexOperationsCount = 0;
  private totalIndexingDurationMs = 0;
  private lastIndexedAt: string | null = null;
  private totalSearches = 0;
  private totalMatches = 0;
  private zeroResultSearches = 0;
  private totalSearchDurationMs = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private lastSearchedAt: string | null = null;
  private termFrequencies = new Map<string, number>();
  private listeners = new Set<MemoryTelemetryListener>();

  public addListener(listener: MemoryTelemetryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: MemoryTelemetryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {}
    }
  }

  public recordIndex(options: RecordIndexTelemetryOptions): void {
    const now = new Date().toISOString();
    const duration = Math.max(0, options.durationMs ?? 0);
    const docs = Math.max(0, options.documentsCount);
    const tokens = Math.max(0, options.tokensCount ?? 0);
    this.totalIndexedDocuments += docs;
    this.totalTokensIndexed += tokens;
    this.indexOperationsCount += 1;
    this.totalIndexingDurationMs += duration;
    this.lastIndexedAt = now;
    this.lastActivityAt = now;
    if (options.byKind) {
      for (const kind of MEMORY_KINDS) {
        const count = options.byKind[kind];
        if (typeof count === "number" && count > 0)
          this.documentsByKind[kind] = (this.documentsByKind[kind] ?? 0) + count;
      }
    }
    this.emit({
      type: "index",
      timestamp: now,
      durationMs: duration,
      details: { documentsCount: docs, tokensCount: tokens, byKind: options.byKind ?? {} },
    });
  }

  public recordSearch(options: RecordSearchTelemetryOptions): void {
    const now = new Date().toISOString();
    const duration = Math.max(0, options.durationMs ?? 0);
    const matches = Math.max(0, options.matchesCount);
    this.totalSearches += 1;
    this.totalMatches += matches;
    if (matches === 0) this.zeroResultSearches += 1;
    this.totalSearchDurationMs += duration;
    this.lastSearchedAt = now;
    this.lastActivityAt = now;
    if (options.cacheHit === true) this.cacheHits += 1;
    else if (options.cacheHit === false) this.cacheMisses += 1;
    const terms =
      options.terms && options.terms.length > 0
        ? options.terms
        : options.query
          ? options.query.toLowerCase().split(/\s+/)
          : [];
    for (const term of terms) {
      const normalized = term.trim().toLowerCase();
      if (normalized.length > 0)
        this.termFrequencies.set(normalized, (this.termFrequencies.get(normalized) ?? 0) + 1);
    }
    this.emit({
      type: "search",
      timestamp: now,
      durationMs: duration,
      details: { query: options.query ?? "", matchesCount: matches, cacheHit: options.cacheHit },
    });
  }

  public getSnapshot(): MemoryTelemetrySnapshot {
    const avgDocTokens =
      this.totalIndexedDocuments > 0
        ? Math.round((this.totalTokensIndexed / this.totalIndexedDocuments) * 100) / 100
        : 0;
    const avgIndexingDuration =
      this.indexOperationsCount > 0
        ? Math.round((this.totalIndexingDurationMs / this.indexOperationsCount) * 100) / 100
        : 0;
    const avgMatches =
      this.totalSearches > 0 ? Math.round((this.totalMatches / this.totalSearches) * 100) / 100 : 0;
    const avgSearchDuration =
      this.totalSearches > 0
        ? Math.round((this.totalSearchDurationMs / this.totalSearches) * 100) / 100
        : 0;
    const entries = Array.from(this.termFrequencies.entries()).sort((a, b) => b[1] - a[1]);
    const topTerms = entries.slice(0, 10).map(([term, count]) => ({ term, count }));
    return {
      index: {
        totalIndexedDocuments: this.totalIndexedDocuments,
        documentsByKind: { ...this.documentsByKind },
        totalTokensIndexed: this.totalTokensIndexed,
        averageTokensPerDocument: avgDocTokens,
        lastIndexedAt: this.lastIndexedAt,
        indexOperationsCount: this.indexOperationsCount,
        totalIndexingDurationMs: this.totalIndexingDurationMs,
        averageIndexingDurationMs: avgIndexingDuration,
      },
      search: {
        totalSearches: this.totalSearches,
        totalMatches: this.totalMatches,
        zeroResultSearches: this.zeroResultSearches,
        averageMatchesPerSearch: avgMatches,
        totalSearchDurationMs: this.totalSearchDurationMs,
        averageSearchDurationMs: avgSearchDuration,
        cacheHits: this.cacheHits,
        cacheMisses: this.cacheMisses,
        cacheHitRate: calculateCacheHitRate(this.cacheHits, this.cacheMisses),
        lastSearchedAt: this.lastSearchedAt,
        topTerms,
      },
      totalOperations: this.indexOperationsCount + this.totalSearches,
      uptimeMs: Math.max(0, Date.now() - this.startedTimestamp),
      startedAt: this.startedAt,
      lastActivityAt: this.lastActivityAt,
    };
  }

  public reset(): void {
    this.startedAt = new Date().toISOString();
    this.startedTimestamp = Date.now();
    this.lastActivityAt = null;
    this.totalIndexedDocuments = 0;
    this.documentsByKind = createEmptyKindsMap();
    this.totalTokensIndexed = 0;
    this.indexOperationsCount = 0;
    this.totalIndexingDurationMs = 0;
    this.lastIndexedAt = null;
    this.totalSearches = 0;
    this.totalMatches = 0;
    this.zeroResultSearches = 0;
    this.totalSearchDurationMs = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.lastSearchedAt = null;
    this.termFrequencies.clear();
    this.emit({ type: "reset", timestamp: new Date().toISOString(), durationMs: 0, details: {} });
  }

  public exportJson(): string {
    return JSON.stringify(this.getSnapshot(), null, 2);
  }
  public formatSummary(): string {
    return formatMemoryTelemetrySummary(this.getSnapshot());
  }
}

let globalMemoryTelemetryTracker: MemoryTelemetryTracker | null = null;
export function createMemoryTelemetryTracker(): MemoryTelemetryTracker {
  return new MemoryTelemetryTracker();
}
export function getGlobalMemoryTelemetryTracker(): MemoryTelemetryTracker {
  if (!globalMemoryTelemetryTracker) globalMemoryTelemetryTracker = new MemoryTelemetryTracker();
  return globalMemoryTelemetryTracker;
}
export function recordMemoryIndexTelemetry(options: RecordIndexTelemetryOptions): void {
  getGlobalMemoryTelemetryTracker().recordIndex(options);
}
export function recordMemorySearchTelemetry(options: RecordSearchTelemetryOptions): void {
  getGlobalMemoryTelemetryTracker().recordSearch(options);
}
export function getMemoryTelemetrySnapshot(): MemoryTelemetrySnapshot {
  return getGlobalMemoryTelemetryTracker().getSnapshot();
}
export function resetMemoryTelemetry(): void {
  getGlobalMemoryTelemetryTracker().reset();
}

export function formatMemoryTelemetrySummary(snapshot?: MemoryTelemetrySnapshot): string {
  const s = snapshot ?? getGlobalMemoryTelemetryTracker().getSnapshot();
  return [
    "Memory Telemetry Summary:",
    `  - Total Operations: ${s.totalOperations}`,
    `  - Indexed Docs: ${s.index.totalIndexedDocuments} (${s.index.totalTokensIndexed} tokens across ${s.index.indexOperationsCount} batches)`,
    `  - Searches: ${s.search.totalSearches} (${s.search.totalMatches} matches, ${s.search.zeroResultSearches} zero-result)`,
    `  - Cache Hit Rate: ${(s.search.cacheHitRate * 100).toFixed(1)}% (${s.search.cacheHits} hits / ${s.search.cacheMisses} misses)`,
    `  - Avg Latency: Index ${s.index.averageIndexingDurationMs}ms | Search ${s.search.averageSearchDurationMs}ms`,
  ].join("\n");
}

export function computeCognitiveTelemetry(
  source?: MemoryTelemetrySnapshot | MemoryTelemetryTracker | ComputeCognitiveTelemetryOptions,
): CognitiveTelemetry {
  const tracker =
    source && "getSnapshot" in source && typeof source.getSnapshot === "function"
      ? source
      : source && "tracker" in source && source.tracker
        ? source.tracker
        : undefined;
  const snapshot: MemoryTelemetrySnapshot = tracker
    ? tracker.getSnapshot()
    : source &&
        "index" in source &&
        "search" in source &&
        typeof source.totalOperations === "number"
      ? (source as MemoryTelemetrySnapshot)
      : source && "snapshot" in source && source.snapshot
        ? source.snapshot
        : getGlobalMemoryTelemetryTracker().getSnapshot();

  const totalOps = snapshot.totalOperations;
  const totalDuration =
    snapshot.index.totalIndexingDurationMs + snapshot.search.totalSearchDurationMs;
  const avgLatency = totalOps > 0 ? Math.round((totalDuration / totalOps) * 100) / 100 : 0;
  const cacheHitRate = snapshot.search.cacheHitRate;

  let healthScore = 100;
  if (snapshot.search.totalSearches > 0) {
    const zeroResultRatio = snapshot.search.zeroResultSearches / snapshot.search.totalSearches;
    healthScore -= Math.round(zeroResultRatio * 30);
    if (snapshot.search.cacheHits + snapshot.search.cacheMisses > 0 && cacheHitRate < 0.2)
      healthScore -= 20;
    if (snapshot.search.averageSearchDurationMs > 50) {
      healthScore -= Math.min(30, Math.round((snapshot.search.averageSearchDurationMs - 50) / 5));
    }
  }
  if (snapshot.index.averageIndexingDurationMs > 100) {
    healthScore -= Math.min(20, Math.round((snapshot.index.averageIndexingDurationMs - 100) / 10));
  }
  healthScore = Math.max(0, Math.min(100, healthScore));

  const status: "healthy" | "degraded" | "empty" =
    totalOps === 0 ? "empty" : healthScore < 60 ? "degraded" : "healthy";

  return {
    timestamp: new Date().toISOString(),
    index: snapshot.index,
    search: snapshot.search,
    totalOperations: totalOps,
    cacheHitRate,
    averageLatencyMs: avgLatency,
    healthScore,
    status,
    summary: formatMemoryTelemetrySummary(snapshot),
  };
}
