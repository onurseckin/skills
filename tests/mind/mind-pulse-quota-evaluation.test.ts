import { describe, expect, test } from "bun:test";
import {
  checkPulseQuotaFreeze,
  evaluateMindPulseQuota,
} from "../../olt/scripts/src/mind/pulsing/index.ts";
import type { UnifiedTelemetryReport } from "../../olt/scripts/src/telemetry/types.ts";

describe("Mind Pulse Quota Telemetry Evaluation & Host Isolation", () => {
  function createMockReport(
    overrides: {
      platformId: string;
      isDetected: boolean;
      quotaPercent: number | null;
      modelName?: string;
    }[],
  ): UnifiedTelemetryReport {
    return {
      timestamp: new Date().toISOString(),
      results: overrides.map((o) => ({
        platformId: o.platformId,
        isDetected: o.isDetected,
        primaryTierUsed: "tier1_cli_command",
        metrics:
          o.quotaPercent !== null
            ? [
                {
                  platformId: o.platformId,
                  canonicalProvider: o.platformId,
                  rawMetricName: o.modelName ?? `${o.platformId}-default`,
                  remainingPercentage: o.quotaPercent,
                  remainingFraction: o.quotaPercent / 100,
                  confidence: "high",
                  sourceTier: "tier1_cli_command",
                  windowType: "session",
                  rawPayload: { quotaInfo: { resetTime: "2026-09-01T12:00:00.000Z" } },
                },
              ]
            : [],
        rawObservations: {},
        errors: [],
      })),
      summary: {
        totalCollectors: overrides.length,
        detectedPlatforms: overrides.filter((o) => o.isDetected).length,
        lowestRemainingQuota: 50,
      },
    };
  }

  test("evaluates nominal active host quota without triggering circuit breaker", async () => {
    const report = createMockReport([
      { platformId: "antigravity", isDetected: true, quotaPercent: 85.5 },
      { platformId: "claude_code", isDetected: true, quotaPercent: 5.0 }, // Inactive host with low quota
    ]);

    const evalResult = await evaluateMindPulseQuota({
      host: "antigravity",
      cachedReport: report,
    });

    expect(evalResult.activeHost).toBe("antigravity");
    expect(evalResult.status).toBe("nominal");
    expect(evalResult.isCircuitBreakerTripped).toBe(false);
    expect(evalResult.lowestRemainingQuota).toBe(85.5);
    expect(evalResult.constrainedModels).toHaveLength(0);
    expect(checkPulseQuotaFreeze(evalResult)).toBe(false);
  });

  test("isolates active host quota from stale external provider cache", async () => {
    const report = createMockReport([
      {
        platformId: "claude_code",
        isDetected: true,
        quotaPercent: 92.0,
        modelName: "claude-3-7-sonnet",
      },
      { platformId: "openai", isDetected: true, quotaPercent: 2.0, modelName: "gpt-4o" }, // Stale external cache
    ]);

    const evalResult = await evaluateMindPulseQuota({
      host: "claude-code",
      cachedReport: report,
    });

    expect(evalResult.activeHost).toBe("claude-code");
    expect(evalResult.status).toBe("nominal");
    expect(evalResult.isCircuitBreakerTripped).toBe(false);
    expect(evalResult.lowestRemainingQuota).toBe(92.0);
    expect(evalResult.constrainedModels).toHaveLength(0);
    expect(checkPulseQuotaFreeze(evalResult)).toBe(false);
  });

  test("triggers critical status and circuit breaker when active host quota is <= 10%", async () => {
    const report = createMockReport([
      {
        platformId: "antigravity",
        isDetected: true,
        quotaPercent: 7.5,
        modelName: "gemini-2.5-pro",
      },
    ]);

    const evalResult = await evaluateMindPulseQuota({
      host: "antigravity",
      cachedReport: report,
    });

    expect(evalResult.status).toBe("critical");
    expect(evalResult.isCircuitBreakerTripped).toBe(true);
    expect(evalResult.lowestRemainingQuota).toBe(7.5);
    expect(evalResult.constrainedModels).toContain("gemini-2.5-pro");
    expect(checkPulseQuotaFreeze(evalResult)).toBe(true);
    expect(evalResult.warningMessages.length).toBeGreaterThan(0);
  });

  test("triggers warning status when active host quota is between 10% and 20%", async () => {
    const report = createMockReport([
      { platformId: "cursor", isDetected: true, quotaPercent: 15.0, modelName: "cursor-fast" },
    ]);

    const evalResult = await evaluateMindPulseQuota({
      host: "cursor",
      cachedReport: report,
    });

    expect(evalResult.status).toBe("warning");
    expect(evalResult.isCircuitBreakerTripped).toBe(false);
    expect(evalResult.lowestRemainingQuota).toBe(15.0);
    expect(evalResult.constrainedModels).toHaveLength(0);
    expect(checkPulseQuotaFreeze(evalResult)).toBe(false);
    expect(evalResult.warningMessages.some((msg) => msg.includes("Low quota warning"))).toBe(true);
  });

  test("handles unmeasured active host gracefully", async () => {
    const report = createMockReport([
      { platformId: "antigravity", isDetected: true, quotaPercent: null },
    ]);

    const evalResult = await evaluateMindPulseQuota({
      host: "antigravity",
      cachedReport: report,
    });

    expect(evalResult.status).toBe("unknown");
    expect(evalResult.isCircuitBreakerTripped).toBe(false);
    expect(evalResult.lowestRemainingQuota).toBeNull();
    expect(evalResult.metrics).toHaveLength(0);
    expect(checkPulseQuotaFreeze(evalResult)).toBe(false);
  });

  test("supports custom threshold percentage", async () => {
    const report = createMockReport([
      { platformId: "codex", isDetected: true, quotaPercent: 22.0, modelName: "codex-davinci" },
    ]);

    const evalResult = await evaluateMindPulseQuota({
      host: "codex",
      thresholdPercentage: 25.0, // custom high threshold
      cachedReport: report,
    });

    expect(evalResult.status).toBe("critical");
    expect(evalResult.isCircuitBreakerTripped).toBe(true);
    expect(evalResult.thresholdPercentage).toBe(25.0);
    expect(evalResult.constrainedModels).toContain("codex-davinci");
  });
});
