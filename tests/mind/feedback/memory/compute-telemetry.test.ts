import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  computeCognitiveTelemetry,
  createMemoryTelemetryTracker,
  getGlobalMemoryTelemetryTracker,
  recordMemoryIndexTelemetry,
  recordMemorySearchTelemetry,
  resetMemoryTelemetry,
  MemoryTelemetryTracker,
  type MemoryTelemetrySnapshot,
} from "../../../../olt/scripts/src/mind/memory/telemetry.ts";

describe("Compute Cognitive Telemetry Module", () => {
  beforeEach(() => {
    resetMemoryTelemetry();
  });

  afterEach(() => {
    resetMemoryTelemetry();
  });

  it("handles baseline empty state with empty status and perfect health score", () => {
    const tracker = createMemoryTelemetryTracker();
    const telemetry = computeCognitiveTelemetry(tracker);

    expect(telemetry.status).toBe("empty");
    expect(telemetry.healthScore).toBe(100);
    expect(telemetry.totalOperations).toBe(0);
    expect(telemetry.averageLatencyMs).toBe(0);
    expect(telemetry.cacheHitRate).toBe(0);
    expect(telemetry.index.totalIndexedDocuments).toBe(0);
    expect(telemetry.search.totalSearches).toBe(0);
    expect(typeof telemetry.timestamp).toBe("string");
    expect(telemetry.summary).toContain("Total Operations: 0");
  });

  it("resolves inputs across all 5 parameter permutations", () => {
    const tracker = new MemoryTelemetryTracker();
    tracker.recordIndex({ documentsCount: 10, tokensCount: 200, durationMs: 15 });
    tracker.recordSearch({ query: "input test", matchesCount: 3, durationMs: 5, cacheHit: true });
    const snapshot: MemoryTelemetrySnapshot = tracker.getSnapshot();

    // 1. Direct Tracker instance
    const fromTracker = computeCognitiveTelemetry(tracker);
    expect(fromTracker.totalOperations).toBe(2);
    expect(fromTracker.healthScore).toBe(100);
    expect(fromTracker.status).toBe("healthy");

    // 2. Direct Snapshot object
    const fromSnapshot = computeCognitiveTelemetry(snapshot);
    expect(fromSnapshot.totalOperations).toBe(2);
    expect(fromSnapshot.healthScore).toBe(100);

    // 3. Option wrapper { tracker }
    const fromOptsTracker = computeCognitiveTelemetry({ tracker });
    expect(fromOptsTracker.totalOperations).toBe(2);
    expect(fromOptsTracker.healthScore).toBe(100);

    // 4. Option wrapper { snapshot }
    const fromOptsSnapshot = computeCognitiveTelemetry({ snapshot });
    expect(fromOptsSnapshot.totalOperations).toBe(2);
    expect(fromOptsSnapshot.healthScore).toBe(100);

    // 5. Undefined argument (global fallback)
    recordMemoryIndexTelemetry({ documentsCount: 5, tokensCount: 100, durationMs: 10 });
    recordMemorySearchTelemetry({ query: "global item", matchesCount: 1, durationMs: 8 });
    const fromGlobal = computeCognitiveTelemetry();
    expect(fromGlobal.totalOperations).toBe(2);
    expect(fromGlobal.status).toBe("healthy");
    expect(fromGlobal.index.totalIndexedDocuments).toBe(5);
    expect(getGlobalMemoryTelemetryTracker().getSnapshot().totalOperations).toBe(2);

    // 6. Empty options object {} (falls back to global tracker snapshot)
    const fromEmptyOpts = computeCognitiveTelemetry({});
    expect(fromEmptyOpts.totalOperations).toBe(2);
    expect(fromEmptyOpts.status).toBe("healthy");
  });

  it("maintains healthy status under clean operations and moderate penalty degradation", () => {
    const cleanTracker = createMemoryTelemetryTracker();
    cleanTracker.recordIndex({ documentsCount: 20, tokensCount: 1000, durationMs: 30 });
    cleanTracker.recordSearch({
      query: "clean search",
      matchesCount: 5,
      durationMs: 20,
      cacheHit: true,
    });

    const cleanResult = computeCognitiveTelemetry(cleanTracker);
    expect(cleanResult.healthScore).toBe(100);
    expect(cleanResult.status).toBe("healthy");
    expect(cleanResult.averageLatencyMs).toBe(25);

    // Moderate degradation: 50% zero-result searches (penalty: Math.round(0.5 * 30) = 15 pts)
    const moderateTracker = createMemoryTelemetryTracker();
    moderateTracker.recordIndex({ documentsCount: 5, durationMs: 20 });
    moderateTracker.recordSearch({
      query: "found",
      matchesCount: 2,
      durationMs: 15,
      cacheHit: true,
    });
    moderateTracker.recordSearch({
      query: "not found",
      matchesCount: 0,
      durationMs: 15,
      cacheHit: true,
    });

    const moderateResult = computeCognitiveTelemetry(moderateTracker);
    expect(moderateResult.healthScore).toBe(85);
    expect(moderateResult.healthScore).toBeGreaterThanOrEqual(60);
    expect(moderateResult.status).toBe("healthy");
  });

  it("transitions to degraded status when health score falls below 60 threshold", () => {
    const degradedTracker = createMemoryTelemetryTracker();
    // Index duration > 100ms incurs penalty: Math.min(20, Math.round((180 - 100) / 10)) = 8 pts
    degradedTracker.recordIndex({ documentsCount: 4, durationMs: 180 });
    // 100% zero-result searches: penalty 30 pts
    // Low cache hit rate (<0.20): penalty 20 pts
    // Search duration > 50ms: Math.min(30, Math.round((110 - 50) / 5)) = 12 pts
    // Total deductions = 8 + 30 + 20 + 12 = 70 pts -> healthScore = 30
    degradedTracker.recordSearch({
      query: "miss one",
      matchesCount: 0,
      durationMs: 110,
      cacheHit: false,
    });
    degradedTracker.recordSearch({
      query: "miss two",
      matchesCount: 0,
      durationMs: 110,
      cacheHit: false,
    });

    const degradedResult = computeCognitiveTelemetry(degradedTracker);
    expect(degradedResult.healthScore).toBeLessThan(60);
    expect(degradedResult.status).toBe("degraded");
    expect(degradedResult.totalOperations).toBe(3);
    expect(degradedResult.summary).toContain("Memory Telemetry Summary:");
  });

  it("applies all penalties simultaneously and clamps health score to zero", () => {
    const extremeTracker = createMemoryTelemetryTracker();
    // High index latency (>100ms) with large penalty (capped at 20)
    extremeTracker.recordIndex({ documentsCount: 1, durationMs: 500 });
    // 100% zero-results (-30), low cache hit rate (-20), extreme search latency (>50ms, capped at -30)
    for (let i = 0; i < 5; i++) {
      extremeTracker.recordSearch({
        query: `extreme-miss-${i}`,
        matchesCount: 0,
        durationMs: 300,
        cacheHit: false,
      });
    }

    const result = computeCognitiveTelemetry(extremeTracker);
    // Total penalties: 20 (index) + 30 (zero results) + 20 (cache) + 30 (search latency) = 100
    expect(result.healthScore).toBe(0);
    expect(result.status).toBe("degraded");
    expect(result.averageLatencyMs).toBeGreaterThan(100);
  });

  it("calculates accurate aggregate latency across index and search operations", () => {
    const tracker = createMemoryTelemetryTracker();
    tracker.recordIndex({ documentsCount: 10, durationMs: 40 });
    tracker.recordIndex({ documentsCount: 10, durationMs: 60 });
    tracker.recordSearch({ query: "q1", matchesCount: 1, durationMs: 20 });
    tracker.recordSearch({ query: "q2", matchesCount: 2, durationMs: 30 });

    const result = computeCognitiveTelemetry(tracker);
    // Total operations = 2 index + 2 search = 4
    // Total duration = 40 + 60 + 20 + 30 = 150ms
    // Average latency = 150 / 4 = 37.5ms
    expect(result.totalOperations).toBe(4);
    expect(result.averageLatencyMs).toBe(37.5);
    expect(result.summary).toContain("Total Operations: 4");
  });

  it("applies isolated search latency penalty while remaining healthy", () => {
    const tracker = createMemoryTelemetryTracker();
    tracker.recordIndex({ documentsCount: 5, durationMs: 20 });
    // Average search latency 100ms > 50ms: Math.min(30, Math.round((100 - 50) / 5)) = 10 pts penalty
    // Zero result penalty = 0, Cache hit penalty = 0 (100% hits)
    // Health score: 100 - 10 = 90 (>= 60, status remains "healthy")
    tracker.recordSearch({
      query: "latency test",
      matchesCount: 2,
      durationMs: 100,
      cacheHit: true,
    });

    const result = computeCognitiveTelemetry(tracker);
    expect(result.healthScore).toBe(90);
    expect(result.status).toBe("healthy");
    expect(result.search.averageSearchDurationMs).toBe(100);
  });
});
