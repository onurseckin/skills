import { describe, expect, it } from "bun:test";
import {
  QuotaCircuitBreaker,
  formatCircuitBreakerMarkdown,
} from "../../../olt/scripts/src/telemetry/circuit-breaker.ts";
import type {
  NormalizedQuotaMetric,
  UnifiedTelemetryReport,
} from "../../../olt/scripts/src/telemetry/types.ts";

function createMockMetric(
  modelName: string,
  remainingPercentage: number,
  resetTime?: string,
): NormalizedQuotaMetric {
  return {
    rawMetricName: modelName,
    canonicalProvider: "google",
    windowType: "5_hour",
    remainingPercentage,
    sourceTier: "tier1_cli_command",
    confidence: "verified_exact",
    rawPayload: {
      label: modelName,
      quotaInfo: {
        remainingFraction: remainingPercentage / 100,
        resetTime,
      },
    },
  };
}

function createMockReport(
  metrics: NormalizedQuotaMetric[],
  platform = "antigravity",
): UnifiedTelemetryReport {
  const lowest = metrics.length > 0 ? Math.min(...metrics.map((m) => m.remainingPercentage)) : null;

  return {
    timestamp: new Date().toISOString(),
    results: [
      {
        platformId: platform,
        isDetected: true,
        primaryTierUsed: "tier1_cli_command",
        metrics,
        rawObservations: {},
        errors: [],
      },
    ],
    summary: {
      totalCollectors: 1,
      detectedPlatforms: 1,
      lowestRemainingQuota: lowest,
      activeWarnings: lowest !== null && lowest < 20 ? [`Low quota: ${lowest}%`] : [],
    },
  };
}

describe("Circuit Breaker Markdown & Fail-Closed States", () => {
  const fixedNow = new Date("2026-08-24T12:00:00.000Z").getTime();

  it("formats markdown and ASCII representations clearly", () => {
    const breaker = new QuotaCircuitBreaker();
    const triggeredReport = createMockReport([
      createMockMetric("gemini-2.5-pro", 3.5, "2026-08-24T14:18:42.000Z"),
    ]);

    const triggeredEval = breaker.evaluate(triggeredReport, {
      now: fixedNow,
      activeHost: "antigravity",
    });
    const triggeredMd = formatCircuitBreakerMarkdown(triggeredEval, true);

    expect(triggeredMd).toContain("CRITICAL QUOTA CIRCUIT-BREAKER ACTIVATED (<10%)");
    expect(triggeredMd).toContain("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(triggeredMd).toContain("Target Wakeup Time (ISO)");
    expect(triggeredMd).toContain("AGENT WRAP-UP DIRECTIVES");
    expect(triggeredMd).toContain("Do NOT kill active subagents");
    expect(triggeredMd).toContain("One-Shot Scheduler Registration Payload");
    expect(triggeredMd).toContain("antigravity");

    const nominalReport = createMockReport([
      createMockMetric("gemini-2.5-pro", 95.0, "2026-08-24T14:18:42.000Z"),
    ]);
    const nominalEval = breaker.evaluate(nominalReport, { now: fixedNow });
    const nominalMd = formatCircuitBreakerMarkdown(nominalEval);

    expect(nominalMd).toContain("QUOTA CIRCUIT-BREAKER: STATUS NOMINAL");
    expect(nominalMd).toContain("OK");
  });

  it("fails closed for offline or undetected platforms", () => {
    const breaker = new QuotaCircuitBreaker();
    const offlineReport: UnifiedTelemetryReport = {
      timestamp: new Date().toISOString(),
      results: [
        {
          platformId: "antigravity",
          isDetected: false,
          primaryTierUsed: null,
          metrics: [],
          rawObservations: {},
          errors: [],
          reason: "Daemon Offline · No Quota in Storage",
        },
        {
          platformId: "claude",
          isDetected: false,
          primaryTierUsed: null,
          metrics: [],
          rawObservations: {},
          errors: [],
          reason: "No Claude Session · No API Key",
        },
        {
          platformId: "codex",
          isDetected: false,
          primaryTierUsed: null,
          metrics: [],
          rawObservations: {},
          errors: [],
          reason: "No Codex Sessions · No API Key",
        },
      ],
      summary: {
        totalCollectors: 3,
        detectedPlatforms: 0,
        lowestRemainingQuota: null,
        activeWarnings: [],
      },
    };

    const result = breaker.evaluate(offlineReport, { now: fixedNow });

    expect(result.status).toBe("QUOTA_UNKNOWN_CIRCUIT_BROKEN");
    expect(result.isTriggered).toBe(true);
    expect(result.lowestRemainingQuota).toBeNull();
    expect(result.constrainedModels.length).toBe(0);
    expect(result.wrapUpDirectives.length).toBe(1);
    expect(result.autoWakeSchedule).not.toBeNull();
    expect(result.summary).toContain("unavailable or unmeasured");
  });
});
