import { beforeEach, describe, expect, test } from "bun:test";
import {
  computeCognitiveTelemetry,
  createMemoryTelemetryTracker,
  getGlobalMemoryTelemetryTracker,
  getMemoryTelemetrySnapshot,
  recordMemoryIndexTelemetry,
  recordMemorySearchTelemetry,
  resetMemoryTelemetry,
  type CognitiveTelemetry,
  type MemoryTelemetrySnapshot,
  type MemoryTelemetryTracker,
} from "../../../olt/scripts/src/mind/memory/index.ts";

describe("computeCognitiveTelemetry", () => {
  beforeEach(() => {
    resetMemoryTelemetry();
  });

  test("is exported as a function from memory index barrel", () => {
    expect(typeof computeCognitiveTelemetry).toBe("function");
  });

  test("computes empty telemetry state when no operations recorded", () => {
    const telemetry = computeCognitiveTelemetry();
    expect(telemetry.status).toBe("empty");
    expect(telemetry.totalOperations).toBe(0);
    expect(telemetry.cacheHitRate).toBe(0);
    expect(telemetry.averageLatencyMs).toBe(0);
    expect(telemetry.healthScore).toBe(100);
    expect(typeof telemetry.timestamp).toBe("string");
    expect(telemetry.summary.length).toBeGreaterThan(0);
    expect(telemetry.index.totalIndexedDocuments).toBe(0);
    expect(telemetry.search.totalSearches).toBe(0);
  });

  test("computes telemetry from global tracker when operations are recorded", () => {
    recordMemoryIndexTelemetry({
      documentsCount: 5,
      tokensCount: 250,
      durationMs: 20,
      byKind: { capsule: 3, defect: 2 },
    });
    recordMemorySearchTelemetry({
      query: "capsule verification",
      matchesCount: 2,
      durationMs: 10,
      cacheHit: true,
    });
    recordMemorySearchTelemetry({
      query: "defect analysis",
      matchesCount: 1,
      durationMs: 15,
      cacheHit: false,
    });

    const telemetry: CognitiveTelemetry = computeCognitiveTelemetry();
    expect(telemetry.status).toBe("healthy");
    expect(telemetry.totalOperations).toBe(3);
    expect(telemetry.index.totalIndexedDocuments).toBe(5);
    expect(telemetry.index.totalTokensIndexed).toBe(250);
    expect(telemetry.search.totalSearches).toBe(2);
    expect(telemetry.search.totalMatches).toBe(3);
    expect(telemetry.cacheHitRate).toBe(0.5);
    expect(telemetry.averageLatencyMs).toBe(15);
    expect(telemetry.healthScore).toBeGreaterThanOrEqual(60);
    expect(telemetry.summary).toContain("Total Operations: 3");
  });

  test("computes telemetry from isolated MemoryTelemetryTracker instance", () => {
    const customTracker: MemoryTelemetryTracker = createMemoryTelemetryTracker();
    customTracker.recordIndex({
      documentsCount: 12,
      tokensCount: 1200,
      durationMs: 40,
      byKind: { decision: 6, charter: 6 },
    });
    customTracker.recordSearch({
      query: "governance charter",
      matchesCount: 4,
      durationMs: 8,
      cacheHit: true,
    });

    const telemetry = computeCognitiveTelemetry(customTracker);
    expect(telemetry.status).toBe("healthy");
    expect(telemetry.totalOperations).toBe(2);
    expect(telemetry.index.totalIndexedDocuments).toBe(12);
    expect(telemetry.index.documentsByKind.decision).toBe(6);
    expect(telemetry.index.documentsByKind.charter).toBe(6);
    expect(telemetry.search.totalSearches).toBe(1);
    expect(telemetry.cacheHitRate).toBe(1);
    expect(telemetry.averageLatencyMs).toBe(24);

    const globalTelemetry = computeCognitiveTelemetry();
    expect(globalTelemetry.totalOperations).toBe(0);
  });

  test("computes telemetry directly from MemoryTelemetrySnapshot", () => {
    const customTracker = createMemoryTelemetryTracker();
    customTracker.recordIndex({
      documentsCount: 8,
      tokensCount: 800,
      durationMs: 16,
    });
    customTracker.recordSearch({
      query: "architecture overview",
      matchesCount: 3,
      durationMs: 12,
      cacheHit: true,
    });
    const snapshot: MemoryTelemetrySnapshot = customTracker.getSnapshot();

    const telemetry = computeCognitiveTelemetry(snapshot);
    expect(telemetry.status).toBe("healthy");
    expect(telemetry.totalOperations).toBe(2);
    expect(telemetry.index.totalIndexedDocuments).toBe(8);
    expect(telemetry.search.totalMatches).toBe(3);
    expect(telemetry.averageLatencyMs).toBe(14);
  });

  test("computes telemetry from ComputeCognitiveTelemetryOptions wrapper", () => {
    const customTracker = createMemoryTelemetryTracker();
    customTracker.recordIndex({ documentsCount: 4, tokensCount: 400, durationMs: 10 });
    customTracker.recordSearch({
      query: "pulse cadence",
      matchesCount: 1,
      durationMs: 6,
      cacheHit: true,
    });

    const telemetryFromTrackerOpt = computeCognitiveTelemetry({ tracker: customTracker });
    expect(telemetryFromTrackerOpt.totalOperations).toBe(2);
    expect(telemetryFromTrackerOpt.status).toBe("healthy");

    const snapshot = customTracker.getSnapshot();
    const telemetryFromSnapshotOpt = computeCognitiveTelemetry({ snapshot });
    expect(telemetryFromSnapshotOpt.totalOperations).toBe(2);
    expect(telemetryFromSnapshotOpt.status).toBe("healthy");
  });

  test("detects degraded cognitive status on high failure and latency rates", () => {
    const degradedTracker = createMemoryTelemetryTracker();
    degradedTracker.recordIndex({
      documentsCount: 1,
      tokensCount: 10,
      durationMs: 400,
    });
    for (let i = 0; i < 10; i += 1) {
      degradedTracker.recordSearch({
        query: `nonexistent-query-${i}`,
        matchesCount: 0,
        durationMs: 150,
        cacheHit: false,
      });
    }

    const telemetry = computeCognitiveTelemetry(degradedTracker);
    expect(telemetry.status).toBe("degraded");
    expect(telemetry.healthScore).toBeLessThan(60);
    expect(telemetry.search.zeroResultSearches).toBe(10);
    expect(telemetry.cacheHitRate).toBe(0);
    expect(telemetry.averageLatencyMs).toBeGreaterThan(100);
  });

  test("verifies timestamp format and summary string contents", () => {
    recordMemoryIndexTelemetry({ documentsCount: 3, tokensCount: 150, durationMs: 10 });
    const telemetry = computeCognitiveTelemetry();

    expect(new Date(telemetry.timestamp).toISOString()).toBe(telemetry.timestamp);
    expect(telemetry.summary).toContain("Indexed Docs: 3");
    expect(telemetry.summary).toContain("Memory Telemetry Summary:");
  });
});
