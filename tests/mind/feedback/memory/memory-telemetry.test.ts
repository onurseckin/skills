import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  calculateCacheHitRate,
  createMemoryTelemetryTracker,
  getGlobalMemoryTelemetryTracker,
  recordMemoryIndexTelemetry,
  recordMemorySearchTelemetry,
  getMemoryTelemetrySnapshot,
  resetMemoryTelemetry,
  formatMemoryTelemetrySummary,
  MemoryTelemetryTracker,
  type MemoryTelemetryEvent,
} from "../../../../olt/scripts/src/mind/memory/telemetry.ts";

describe("Memory Telemetry Tracker Module", () => {
  beforeEach(() => {
    resetMemoryTelemetry();
  });

  afterEach(() => {
    resetMemoryTelemetry();
  });

  describe("calculateCacheHitRate", () => {
    it("handles boundary edge cases and rounds to 4 decimal places", () => {
      expect(calculateCacheHitRate(0, 0)).toBe(0);
      expect(calculateCacheHitRate(-5, -10)).toBe(0);
      expect(calculateCacheHitRate(0, 10)).toBe(0);
      expect(calculateCacheHitRate(15, 0)).toBe(1);
      expect(calculateCacheHitRate(1, 3)).toBe(0.25);
      expect(calculateCacheHitRate(1, 2)).toBe(0.3333);
      expect(calculateCacheHitRate(2, 7)).toBe(0.2222);
    });
  });

  describe("MemoryTelemetryTracker Operations", () => {
    it("initializes tracker with pristine baseline state", () => {
      const tracker = new MemoryTelemetryTracker();
      const snapshot = tracker.getSnapshot();

      expect(snapshot.totalOperations).toBe(0);
      expect(snapshot.uptimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof snapshot.startedAt).toBe("string");
      expect(snapshot.lastActivityAt).toBeNull();
      expect(snapshot.index.totalIndexedDocuments).toBe(0);
      expect(snapshot.index.totalTokensIndexed).toBe(0);
      expect(snapshot.index.averageTokensPerDocument).toBe(0);
      expect(snapshot.index.averageIndexingDurationMs).toBe(0);
      expect(snapshot.index.documentsByKind.capsule).toBe(0);
      expect(snapshot.index.documentsByKind.defect).toBe(0);
      expect(snapshot.index.documentsByKind.decision).toBe(0);
      expect(snapshot.index.documentsByKind.charter).toBe(0);
      expect(snapshot.index.documentsByKind.report).toBe(0);
      expect(snapshot.search.totalSearches).toBe(0);
      expect(snapshot.search.totalMatches).toBe(0);
      expect(snapshot.search.zeroResultSearches).toBe(0);
      expect(snapshot.search.cacheHits).toBe(0);
      expect(snapshot.search.cacheMisses).toBe(0);
      expect(snapshot.search.cacheHitRate).toBe(0);
      expect(snapshot.search.topTerms).toEqual([]);
    });

    it("records indexing operations, kinds breakdown, and sanitizes negative inputs", () => {
      const tracker = new MemoryTelemetryTracker();
      tracker.recordIndex({
        documentsCount: 15,
        tokensCount: 750,
        durationMs: 45,
        byKind: { capsule: 10, defect: 5 },
      });
      tracker.recordIndex({
        documentsCount: 5,
        tokensCount: 250,
        durationMs: 15,
        byKind: { decision: 3, charter: 2 },
      });

      let snap = tracker.getSnapshot();
      expect(snap.index.totalIndexedDocuments).toBe(20);
      expect(snap.index.totalTokensIndexed).toBe(1000);
      expect(snap.index.indexOperationsCount).toBe(2);
      expect(snap.index.totalIndexingDurationMs).toBe(60);
      expect(snap.index.averageTokensPerDocument).toBe(50);
      expect(snap.index.averageIndexingDurationMs).toBe(30);
      expect(snap.index.documentsByKind.capsule).toBe(10);
      expect(snap.index.documentsByKind.defect).toBe(5);
      expect(snap.index.documentsByKind.decision).toBe(3);
      expect(snap.index.documentsByKind.charter).toBe(2);
      expect(snap.index.documentsByKind.report).toBe(0);
      expect(typeof snap.index.lastIndexedAt).toBe("string");
      expect(typeof snap.lastActivityAt).toBe("string");

      // Negative metrics sanitization
      tracker.recordIndex({ documentsCount: -10, tokensCount: -500, durationMs: -20 });
      snap = tracker.getSnapshot();
      expect(snap.index.totalIndexedDocuments).toBe(20);
      expect(snap.index.totalTokensIndexed).toBe(1000);
      expect(snap.index.totalIndexingDurationMs).toBe(60);
    });

    it("records searches, tracks cache performance, and ranks top 10 terms descending", () => {
      const tracker = new MemoryTelemetryTracker();
      // Search 1: Hit with query string
      tracker.recordSearch({
        query: "alpha beta gamma",
        matchesCount: 3,
        durationMs: 12,
        cacheHit: true,
      });
      // Search 2: Miss with zero results and overlapping terms
      tracker.recordSearch({
        query: "BETA DELTA",
        matchesCount: 0,
        durationMs: 8,
        cacheHit: false,
      });
      // Search 3: Explicit terms array
      tracker.recordSearch({
        terms: [
          "beta",
          "gamma",
          "epsilon",
          "zeta",
          "eta",
          "theta",
          "iota",
          "kappa",
          "lambda",
          "mu",
        ],
        matchesCount: 10,
        durationMs: 25,
        cacheHit: true,
      });

      const snap = tracker.getSnapshot();
      expect(snap.search.totalSearches).toBe(3);
      expect(snap.search.totalMatches).toBe(13);
      expect(snap.search.zeroResultSearches).toBe(1);
      expect(snap.search.averageMatchesPerSearch).toBe(4.33);
      expect(snap.search.totalSearchDurationMs).toBe(45);
      expect(snap.search.averageSearchDurationMs).toBe(15);
      expect(snap.search.cacheHits).toBe(2);
      expect(snap.search.cacheMisses).toBe(1);
      expect(snap.search.cacheHitRate).toBe(0.6667);

      // Top terms verification: maximum 10 items, sorted descending
      expect(snap.search.topTerms.length).toBeLessThanOrEqual(10);
      expect(snap.search.topTerms[0]?.term).toBe("beta");
      expect(snap.search.topTerms[0]?.count).toBe(3);
      expect(snap.search.topTerms[1]?.term).toBe("gamma");
      expect(snap.search.topTerms[1]?.count).toBe(2);

      for (let i = 0; i < snap.search.topTerms.length - 1; i++) {
        const curr = snap.search.topTerms[i]?.count ?? 0;
        const next = snap.search.topTerms[i + 1]?.count ?? 0;
        expect(curr).toBeGreaterThanOrEqual(next);
      }
    });

    it("handles whitespace queries gracefully and counts duplicate terms accurately", () => {
      const tracker = new MemoryTelemetryTracker();
      tracker.recordSearch({ query: "", matchesCount: 0 });
      tracker.recordSearch({ query: "   \t\n  ", matchesCount: 1 });
      expect(tracker.getSnapshot().search.topTerms).toEqual([]);

      tracker.recordSearch({ terms: ["dup", "dup", "dup"], matchesCount: 1 });
      const snap = tracker.getSnapshot();
      expect(snap.search.topTerms).toEqual([{ term: "dup", count: 3 }]);
    });

    it("isolates throwing listeners while ensuring reliable event delivery and unsubscribe", () => {
      const tracker = new MemoryTelemetryTracker();
      const receivedEvents: MemoryTelemetryEvent[] = [];

      const unsubscribe = tracker.addListener((e) => {
        receivedEvents.push(e);
      });

      // Throwing listener to test exception isolation
      tracker.addListener(() => {
        throw new Error("listener failure explosion");
      });

      const secondaryEvents: MemoryTelemetryEvent[] = [];
      tracker.addListener((e) => {
        secondaryEvents.push(e);
      });

      tracker.recordIndex({ documentsCount: 5, durationMs: 10 });
      tracker.recordSearch({ query: "find", matchesCount: 1, durationMs: 5 });
      tracker.reset();

      expect(receivedEvents.length).toBe(3);
      expect(secondaryEvents.length).toBe(3);
      expect(receivedEvents[0]?.type).toBe("index");
      expect(receivedEvents[1]?.type).toBe("search");
      expect(receivedEvents[2]?.type).toBe("reset");

      unsubscribe();
      tracker.recordIndex({ documentsCount: 2 });
      expect(receivedEvents.length).toBe(3);
      expect(secondaryEvents.length).toBe(4);
    });

    it("serializes to JSON, formats summaries, and resets cleanly", () => {
      const tracker = new MemoryTelemetryTracker();
      tracker.recordIndex({ documentsCount: 8, tokensCount: 400, durationMs: 20 });
      tracker.recordSearch({ query: "lookup", matchesCount: 2, durationMs: 10, cacheHit: true });

      const json = tracker.exportJson();
      const parsed = JSON.parse(json);
      expect(parsed.totalOperations).toBe(2);
      expect(parsed.index.totalIndexedDocuments).toBe(8);

      const summary = tracker.formatSummary();
      expect(summary).toContain("Memory Telemetry Summary:");
      expect(summary).toContain("Total Operations: 2");
      expect(summary).toContain("Indexed Docs: 8");

      tracker.reset();
      const postReset = tracker.getSnapshot();
      expect(postReset.totalOperations).toBe(0);
      expect(postReset.lastActivityAt).toBeNull();
      expect(postReset.search.topTerms).toEqual([]);
    });
  });

  describe("Global Singleton Utilities", () => {
    it("maintains global state across singleton dispatch functions", () => {
      const globalTracker = getGlobalMemoryTelemetryTracker();
      expect(globalTracker).toBeInstanceOf(MemoryTelemetryTracker);

      const isolated = createMemoryTelemetryTracker();
      expect(isolated).not.toBe(globalTracker);

      recordMemoryIndexTelemetry({ documentsCount: 12, tokensCount: 600, durationMs: 24 });
      recordMemorySearchTelemetry({ query: "singleton test", matchesCount: 4, durationMs: 12 });

      const snapshot = getMemoryTelemetrySnapshot();
      expect(snapshot.totalOperations).toBe(2);
      expect(snapshot.index.totalIndexedDocuments).toBe(12);
      expect(snapshot.search.totalSearches).toBe(1);

      const summary = formatMemoryTelemetrySummary();
      expect(summary).toContain("Total Operations: 2");

      resetMemoryTelemetry();
      const cleared = getMemoryTelemetrySnapshot();
      expect(cleared.totalOperations).toBe(0);
    });
  });
});
