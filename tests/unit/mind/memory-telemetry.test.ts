import { beforeEach, describe, expect, test } from "bun:test";
import {
  calculateCacheHitRate,
  createMemoryTelemetryTracker,
  formatMemoryTelemetrySummary,
  getGlobalMemoryTelemetryTracker,
  getMemoryTelemetrySnapshot,
  MemoryTelemetryTracker,
  recordMemoryIndexTelemetry,
  recordMemorySearchTelemetry,
  resetMemoryTelemetry,
  type MemoryTelemetryEvent,
} from "../../../olt/scripts/src/mind/memory/index.ts";

describe("Mind Memory Telemetry", () => {
  beforeEach(() => {
    resetMemoryTelemetry();
  });

  describe("calculateCacheHitRate", () => {
    test("handles zero values safely", () => {
      expect(calculateCacheHitRate(0, 0)).toBe(0);
      expect(calculateCacheHitRate(-1, -1)).toBe(0);
    });

    test("computes accurate hit rates", () => {
      expect(calculateCacheHitRate(5, 5)).toBe(0.5);
      expect(calculateCacheHitRate(1, 3)).toBe(0.25);
      expect(calculateCacheHitRate(10, 0)).toBe(1);
    });
  });

  describe("MemoryTelemetryTracker", () => {
    test("initializes with zeroed counters", () => {
      const tracker = createMemoryTelemetryTracker();
      const snapshot = tracker.getSnapshot();

      expect(snapshot.totalOperations).toBe(0);
      expect(snapshot.index.totalIndexedDocuments).toBe(0);
      expect(snapshot.index.totalTokensIndexed).toBe(0);
      expect(snapshot.index.averageTokensPerDocument).toBe(0);
      expect(snapshot.index.lastIndexedAt).toBeNull();
      expect(snapshot.search.totalSearches).toBe(0);
      expect(snapshot.search.totalMatches).toBe(0);
      expect(snapshot.search.zeroResultSearches).toBe(0);
      expect(snapshot.search.cacheHits).toBe(0);
      expect(snapshot.search.cacheMisses).toBe(0);
      expect(snapshot.search.cacheHitRate).toBe(0);
      expect(snapshot.search.topTerms).toEqual([]);
      expect(snapshot.lastActivityAt).toBeNull();
    });

    test("records index telemetry accurately with document kinds breakdown", () => {
      const tracker = new MemoryTelemetryTracker();
      tracker.recordIndex({
        documentsCount: 20,
        tokensCount: 500,
        durationMs: 40,
        byKind: {
          capsule: 10,
          defect: 5,
          decision: 3,
          charter: 1,
          report: 1,
        },
      });

      const s1 = tracker.getSnapshot();
      expect(s1.index.totalIndexedDocuments).toBe(20);
      expect(s1.index.totalTokensIndexed).toBe(500);
      expect(s1.index.averageTokensPerDocument).toBe(25);
      expect(s1.index.indexOperationsCount).toBe(1);
      expect(s1.index.totalIndexingDurationMs).toBe(40);
      expect(s1.index.averageIndexingDurationMs).toBe(40);
      expect(s1.index.documentsByKind.capsule).toBe(10);
      expect(s1.index.documentsByKind.defect).toBe(5);
      expect(s1.index.documentsByKind.decision).toBe(3);
      expect(s1.index.documentsByKind.charter).toBe(1);
      expect(s1.index.documentsByKind.report).toBe(1);
      expect(s1.index.lastIndexedAt).not.toBeNull();
      expect(s1.lastActivityAt).not.toBeNull();

      tracker.recordIndex({
        documentsCount: 10,
        tokensCount: 300,
        durationMs: 20,
        byKind: {
          capsule: 5,
          defect: 5,
        },
      });

      const s2 = tracker.getSnapshot();
      expect(s2.index.totalIndexedDocuments).toBe(30);
      expect(s2.index.totalTokensIndexed).toBe(800);
      expect(s2.index.averageTokensPerDocument).toBe(26.67);
      expect(s2.index.indexOperationsCount).toBe(2);
      expect(s2.index.totalIndexingDurationMs).toBe(60);
      expect(s2.index.averageIndexingDurationMs).toBe(30);
      expect(s2.index.documentsByKind.capsule).toBe(15);
      expect(s2.index.documentsByKind.defect).toBe(10);
    });

    test("records search telemetry and tracks query terms and cache hits", () => {
      const tracker = new MemoryTelemetryTracker();
      tracker.recordSearch({
        query: "memory search indexing",
        matchesCount: 4,
        durationMs: 15,
        cacheHit: true,
      });

      tracker.recordSearch({
        query: "memory performance",
        matchesCount: 0,
        durationMs: 5,
        cacheHit: false,
      });

      tracker.recordSearch({
        terms: ["indexing", "defect"],
        matchesCount: 2,
        durationMs: 10,
        cacheHit: true,
      });

      const s = tracker.getSnapshot();
      expect(s.totalOperations).toBe(3);
      expect(s.search.totalSearches).toBe(3);
      expect(s.search.totalMatches).toBe(6);
      expect(s.search.zeroResultSearches).toBe(1);
      expect(s.search.averageMatchesPerSearch).toBe(2);
      expect(s.search.totalSearchDurationMs).toBe(30);
      expect(s.search.averageSearchDurationMs).toBe(10);
      expect(s.search.cacheHits).toBe(2);
      expect(s.search.cacheMisses).toBe(1);
      expect(s.search.cacheHitRate).toBe(0.6667);
      expect(s.search.lastSearchedAt).not.toBeNull();

      const termMap = new Map(s.search.topTerms.map((t) => [t.term, t.count]));
      expect(termMap.get("memory")).toBe(2);
      expect(termMap.get("indexing")).toBe(2);
      expect(termMap.get("search")).toBe(1);
      expect(termMap.get("defect")).toBe(1);
    });

    test("dispatches events to registered listeners and supports unsubscribing", () => {
      const tracker = new MemoryTelemetryTracker();
      const events: MemoryTelemetryEvent[] = [];

      const unsubscribe = tracker.addListener((event) => {
        events.push(event);
      });

      tracker.recordIndex({ documentsCount: 5, durationMs: 10 });
      tracker.recordSearch({ query: "test", matchesCount: 1, durationMs: 2 });
      expect(events.length).toBe(2);
      expect(events[0]?.type).toBe("index");
      expect(events[1]?.type).toBe("search");

      unsubscribe();
      tracker.recordSearch({ query: "more", matchesCount: 0 });
      expect(events.length).toBe(2);
    });

    test("resets state completely", () => {
      const tracker = new MemoryTelemetryTracker();
      tracker.recordIndex({ documentsCount: 10, tokensCount: 200 });
      tracker.recordSearch({ query: "reset test", matchesCount: 3 });

      tracker.reset();
      const snapshot = tracker.getSnapshot();
      expect(snapshot.totalOperations).toBe(0);
      expect(snapshot.index.totalIndexedDocuments).toBe(0);
      expect(snapshot.search.totalSearches).toBe(0);
      expect(snapshot.search.topTerms).toEqual([]);
      expect(snapshot.lastActivityAt).toBeNull();
    });

    test("exports valid JSON serialization", () => {
      const tracker = new MemoryTelemetryTracker();
      tracker.recordIndex({ documentsCount: 12, tokensCount: 120 });
      const rawJson = tracker.exportJson();
      const parsed = JSON.parse(rawJson) as {
        totalOperations: number;
        index: { totalIndexedDocuments: number };
      };

      expect(parsed.totalOperations).toBe(1);
      expect(parsed.index.totalIndexedDocuments).toBe(12);
    });

    test("formats readable summary string", () => {
      const tracker = new MemoryTelemetryTracker();
      tracker.recordIndex({ documentsCount: 15, tokensCount: 300, durationMs: 50 });
      tracker.recordSearch({
        query: "query test",
        matchesCount: 5,
        durationMs: 12,
        cacheHit: true,
      });

      const summary = tracker.formatSummary();
      expect(summary).toContain("Memory Telemetry Summary:");
      expect(summary).toContain("Total Operations: 2");
      expect(summary).toContain("Indexed Docs: 15");
      expect(summary).toContain("Searches: 1");
      expect(summary).toContain("Cache Hit Rate: 100.0%");
    });
  });

  describe("Global Memory Telemetry Functions", () => {
    test("operates against global singleton tracker", () => {
      const tracker = getGlobalMemoryTelemetryTracker();
      expect(tracker).toBeInstanceOf(MemoryTelemetryTracker);

      recordMemoryIndexTelemetry({ documentsCount: 8, tokensCount: 160, durationMs: 10 });
      recordMemorySearchTelemetry({
        query: "global search",
        matchesCount: 2,
        durationMs: 4,
        cacheHit: false,
      });

      const s = getMemoryTelemetrySnapshot();
      expect(s.totalOperations).toBe(2);
      expect(s.index.totalIndexedDocuments).toBe(8);
      expect(s.search.totalSearches).toBe(1);

      const summary = formatMemoryTelemetrySummary();
      expect(summary).toContain("Total Operations: 2");
      expect(summary).toContain("Indexed Docs: 8");

      const customSummary = formatMemoryTelemetrySummary(s);
      expect(customSummary).toContain("Indexed Docs: 8");
    });
  });
});
