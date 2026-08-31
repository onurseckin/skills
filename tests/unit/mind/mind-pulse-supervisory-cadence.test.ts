import { describe, expect, test } from "bun:test";
import {
  PULSE_WRAP_UP_DIRECTIVES,
  managePulseSupervisoryCadence,
} from "../../../olt/scripts/src/mind/pulsing/index.ts";
import type { UnifiedTelemetryReport } from "../../../olt/scripts/src/telemetry/types.ts";

describe("Mind Pulse Supervisory Cadence & Freeze Management", () => {
  function createMockReport(
    quotaPercent: number | null,
    platformId = "antigravity",
  ): UnifiedTelemetryReport {
    return {
      timestamp: new Date().toISOString(),
      results: [
        {
          platformId,
          isDetected: true,
          primaryTierUsed: "tier1_cli_command",
          metrics:
            quotaPercent !== null
              ? [
                  {
                    platformId,
                    canonicalProvider: platformId,
                    rawMetricName: `${platformId}-model`,
                    remainingPercentage: quotaPercent,
                    remainingFraction: quotaPercent / 100,
                    confidence: "high",
                    sourceTier: "tier1_cli_command",
                    windowType: "session",
                    rawPayload: { quotaInfo: { resetTime: "2026-09-01T15:00:00.000Z" } },
                  },
                ]
              : [],
          rawObservations: {},
          errors: [],
        },
      ],
      summary: {
        totalCollectors: 1,
        detectedPlatforms: 1,
        lowestRemainingQuota: quotaPercent,
      },
    };
  }

  test("maintains normal cadence when quota is nominal", async () => {
    const report = createMockReport(80.0);
    const result = await managePulseSupervisoryCadence({
      runRoot: "/test/run",
      baseIntervalMs: 300_000, // 5m
      host: "antigravity",
      cachedReport: report,
      captureSnapshotOnFreeze: false,
    });

    expect(result.shouldFreeze).toBe(false);
    expect(result.nextScheduledIntervalMs).toBe(300_000);
    expect(result.wrapUpDirectives).toHaveLength(0);
    expect(result.quotaEvaluation.status).toBe("nominal");
    expect(result.badges).toContain("[BREAKER: NOMINAL]");
  });

  test("maintains normal cadence with warning logged when quota is low (<20%)", async () => {
    const report = createMockReport(16.5);
    const result = await managePulseSupervisoryCadence({
      runRoot: "/test/run",
      baseIntervalMs: 300_000,
      host: "antigravity",
      cachedReport: report,
      captureSnapshotOnFreeze: false,
    });

    expect(result.shouldFreeze).toBe(false);
    expect(result.nextScheduledIntervalMs).toBe(300_000);
    expect(result.quotaEvaluation.status).toBe("warning");
    expect(result.quotaEvaluation.warningMessages.length).toBeGreaterThan(0);
  });

  test("triggers freeze, wrap-up directives, and auto-wake interval when quota <= 10%", async () => {
    const report = createMockReport(4.2);
    const result = await managePulseSupervisoryCadence({
      runRoot: "/test/run",
      baseIntervalMs: 300_000,
      host: "antigravity",
      cachedReport: report,
      captureSnapshotOnFreeze: false,
    });

    expect(result.shouldFreeze).toBe(true);
    expect(result.wrapUpDirectives).toEqual(
      expect.arrayContaining(Array.from(PULSE_WRAP_UP_DIRECTIVES)),
    );
    expect(result.quotaEvaluation.isCircuitBreakerTripped).toBe(true);
    expect(result.bannerMarkdown).toContain("CRITICAL QUOTA CIRCUIT-BREAKER ACTIVATED");
  });
});
