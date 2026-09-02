import { describe, expect, it } from "bun:test";
import {
  calculateCacheHitRate,
  createMemoryTelemetryTracker,
  getGlobalMemoryTelemetryTracker,
  recordMemoryIndexTelemetry,
  recordMemorySearchTelemetry,
  getMemoryTelemetrySnapshot,
  resetMemoryTelemetry,
  formatMemoryTelemetrySummary,
  computeCognitiveTelemetry,
  MemoryTelemetryTracker,
  type MemoryTelemetryEvent,
} from "../../../olt/scripts/src/mind/memory/telemetry.ts";

describe("Memory Telemetry Module", () => {
  describe("calculateCacheHitRate", () => {
    it("computes hit rates accurately and handles edge cases", () => {
      expect(calculateCacheHitRate(0, 0)).toBe(0);
      expect(calculateCacheHitRate(-1, -1)).toBe(0);
      expect(calculateCacheHitRate(10, 0)).toBe(1);
      expect(calculateCacheHitRate(1, 3)).toBe(0.25);
      expect(calculateCacheHitRate(1, 2)).toBe(0.3333);
    });
  });

  describe("MemoryTelemetryTracker", () => {
    it("initializes with empty baseline snapshot", () => {
      const tracker = new MemoryTelemetryTracker();
      const snapshot = tracker.getSnapshot();

      expect(snapshot.totalOperations).toBe(0);
      expect(snapshot.uptimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof snapshot.startedAt).toBe("string");
      expect(snapshot.lastActivityAt).toBeNull();
      expect(snapshot.index.totalIndexedDocuments).toBe(0);
      expect(snapshot.index.totalTokensIndexed).toBe(0);
      expect(snapshot.index.averageTokensPerDocument).toBe(0);
      expect(snapshot.index.documentsByKind.capsule).toBe(0);
      expect(snapshot.search.totalSearches).toBe(0);
      expect(snapshot.search.cacheHitRate).toBe(0);
      expect(snapshot.search.topTerms).toEqual([]);
    });

    it("records indexing operations and calculates averages and byKind breakdown", () => {
      const tracker = new MemoryTelemetryTracker();
      tracker.recordIndex({
        documentsCount: 10,
        tokensCount: 500,
        durationMs: 40,
        byKind: { capsule: 6, defect: 4, decision: 0 },
      });
      tracker.recordIndex({
        documentsCount: 10,
        tokensCount: 300,
        durationMs: 60,
        byKind: { decision: 5, charter: 3, report: 2 },
      });

      const snap = tracker.getSnapshot();
      expect(snap.index.totalIndexedDocuments).toBe(20);
      expect(snap.index.totalTokensIndexed).toBe(800);
      expect(snap.index.indexOperationsCount).toBe(2);
      expect(snap.index.totalIndexingDurationMs).toBe(100);
      expect(snap.index.averageTokensPerDocument).toBe(40);
      expect(snap.index.averageIndexingDurationMs).toBe(50);
      expect(snap.index.documentsByKind.capsule).toBe(6);
      expect(snap.index.documentsByKind.defect).toBe(4);
      expect(snap.index.documentsByKind.decision).toBe(5);
      expect(snap.index.documentsByKind.charter).toBe(3);
      expect(snap.index.documentsByKind.report).toBe(2);
      expect(typeof snap.index.lastIndexedAt).toBe("string");
      expect(typeof snap.lastActivityAt).toBe("string");
    });

    it("sanitizes negative index metrics to zero", () => {
      const tracker = new MemoryTelemetryTracker();
      tracker.recordIndex({
        documentsCount: -5,
        tokensCount: -100,
        durationMs: -20,
      });
      const snap = tracker.getSnapshot();
      expect(snap.index.totalIndexedDocuments).toBe(0);
      expect(snap.index.totalTokensIndexed).toBe(0);
      expect(snap.index.totalIndexingDurationMs).toBe(0);
    });

    it("records searches, tracks cache hits/misses, zero results, and top terms", () => {
      const tracker = new MemoryTelemetryTracker();
      tracker.recordSearch({
        query: "Memory Architecture Search",
        matchesCount: 5,
        durationMs: 25,
        cacheHit: true,
      });
      tracker.recordSearch({
        query: "memory testing",
        matchesCount: 0,
        durationMs: 15,
        cacheHit: false,
      });
      tracker.recordSearch({
        terms: ["architecture", "custom_term"],
        matchesCount: 2,
        durationMs: 10,
      });

      const snap = tracker.getSnapshot();
      expect(snap.search.totalSearches).toBe(3);
      expect(snap.search.totalMatches).toBe(7);
      expect(snap.search.zeroResultSearches).toBe(1);
      expect(snap.search.averageMatchesPerSearch).toBe(2.33);
      expect(snap.search.totalSearchDurationMs).toBe(50);
      expect(snap.search.averageSearchDurationMs).toBe(16.67);
      expect(snap.search.cacheHits).toBe(1);
      expect(snap.search.cacheMisses).toBe(1);
      expect(snap.search.cacheHitRate).toBe(0.5);

      const termsMap = Object.fromEntries(snap.search.topTerms.map((t) => [t.term, t.count]));
      expect(termsMap["memory"]).toBe(2);
      expect(termsMap["architecture"]).toBe(2);
      expect(termsMap["search"]).toBe(1);
      expect(termsMap["testing"]).toBe(1);
      expect(termsMap["custom_term"]).toBe(1);
    });

    it("supports listener registration, event broadcasting, unsubscribe, and error containment", () => {
      const tracker = new MemoryTelemetryTracker();
      const events: MemoryTelemetryEvent[] = [];
      const unsubscribe = tracker.addListener((e) => {
        events.push(e);
      });
      tracker.addListener(() => {
        throw new Error("faulty listener");
      });

      tracker.recordIndex({ documentsCount: 2, durationMs: 10 });
      tracker.recordSearch({ query: "test", matchesCount: 1, durationMs: 5 });
      tracker.reset();

      expect(events.length).toBe(3);
      expect(events[0].type).toBe("index");
      expect(events[1].type).toBe("search");
      expect(events[2].type).toBe("reset");

      unsubscribe();
      tracker.recordIndex({ documentsCount: 1 });
      expect(events.length).toBe(3);
    });

    it("exports JSON and formats summary text", () => {
      const tracker = new MemoryTelemetryTracker();
      tracker.recordIndex({ documentsCount: 4, tokensCount: 200, durationMs: 20 });
      tracker.recordSearch({ query: "find", matchesCount: 2, durationMs: 10 });

      const jsonStr = tracker.exportJson();
      const parsed = JSON.parse(jsonStr);
      expect(parsed.totalOperations).toBe(2);
      expect(parsed.index.totalIndexedDocuments).toBe(4);

      const summary = tracker.formatSummary();
      expect(summary).toContain("Memory Telemetry Summary:");
      expect(summary).toContain("Total Operations: 2");
      expect(summary).toContain("Indexed Docs: 4");
    });
  });

  describe("Global Telemetry Tracker and Functions", () => {
    it("operates on global singleton tracker", () => {
      resetMemoryTelemetry();
      const globalTracker = getGlobalMemoryTelemetryTracker();
      expect(globalTracker).toBeInstanceOf(MemoryTelemetryTracker);

      const freshTracker = createMemoryTelemetryTracker();
      expect(freshTracker).not.toBe(globalTracker);

      recordMemoryIndexTelemetry({ documentsCount: 12, tokensCount: 600, durationMs: 30 });
      recordMemorySearchTelemetry({ query: "global query", matchesCount: 3, durationMs: 15 });

      const snap = getMemoryTelemetrySnapshot();
      expect(snap.totalOperations).toBe(2);
      expect(snap.index.totalIndexedDocuments).toBe(12);
      expect(snap.search.totalSearches).toBe(1);

      const summary = formatMemoryTelemetrySummary();
      expect(summary).toContain("Total Operations: 2");

      resetMemoryTelemetry();
      const postReset = getMemoryTelemetrySnapshot();
      expect(postReset.totalOperations).toBe(0);
    });
  });

  describe("computeCognitiveTelemetry", () => {
    it("computes cognitive health from tracker, snapshot, and option wrappers", () => {
      const tracker = new MemoryTelemetryTracker();
      const emptyCog = computeCognitiveTelemetry(tracker);
      expect(emptyCog.status).toBe("empty");
      expect(emptyCog.healthScore).toBe(100);
      expect(emptyCog.totalOperations).toBe(0);
      expect(emptyCog.averageLatencyMs).toBe(0);

      tracker.recordIndex({ documentsCount: 10, tokensCount: 400, durationMs: 20 });
      tracker.recordSearch({
        query: "healthy search",
        matchesCount: 4,
        durationMs: 10,
        cacheHit: true,
      });

      const cogFromTracker = computeCognitiveTelemetry(tracker);
      expect(cogFromTracker.status).toBe("healthy");
      expect(cogFromTracker.healthScore).toBe(100);
      expect(cogFromTracker.totalOperations).toBe(2);
      expect(cogFromTracker.averageLatencyMs).toBe(15);
      expect(cogFromTracker.cacheHitRate).toBe(1);

      const snapshot = tracker.getSnapshot();
      const cogFromSnapshot = computeCognitiveTelemetry(snapshot);
      expect(cogFromSnapshot.healthScore).toBe(100);

      const cogFromOptsTracker = computeCognitiveTelemetry({ tracker });
      expect(cogFromOptsTracker.healthScore).toBe(100);

      const cogFromOptsSnapshot = computeCognitiveTelemetry({ snapshot });
      expect(cogFromOptsSnapshot.healthScore).toBe(100);
    });

    it("evaluates health score penalties and degraded status", () => {
      const degradedTracker = new MemoryTelemetryTracker();
      // Record slow index (> 100ms)
      degradedTracker.recordIndex({ documentsCount: 5, durationMs: 250 });
      // Record searches with 100% zero-results, slow search latency (> 50ms), and poor cache hit rate (< 20%)
      degradedTracker.recordSearch({
        query: "missing 1",
        matchesCount: 0,
        durationMs: 120,
        cacheHit: false,
      });
      degradedTracker.recordSearch({
        query: "missing 2",
        matchesCount: 0,
        durationMs: 120,
        cacheHit: false,
      });
      degradedTracker.recordSearch({
        query: "missing 3",
        matchesCount: 0,
        durationMs: 120,
        cacheHit: false,
      });
      degradedTracker.recordSearch({
        query: "missing 4",
        matchesCount: 0,
        durationMs: 120,
        cacheHit: false,
      });

      const cog = computeCognitiveTelemetry(degradedTracker);
      expect(cog.healthScore).toBeLessThan(60);
      expect(cog.status).toBe("degraded");
      expect(typeof cog.timestamp).toBe("string");
      expect(cog.summary).toContain("Memory Telemetry Summary:");
    });

    it("falls back to global tracker snapshot when called without arguments", () => {
      resetMemoryTelemetry();
      const cog = computeCognitiveTelemetry();
      expect(cog.status).toBe("empty");
      expect(cog.totalOperations).toBe(0);
    });
  });
});
