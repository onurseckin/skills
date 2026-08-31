import { describe, expect, it } from "bun:test";
import {
  QuotaCircuitBreaker,
  CRITICAL_WRAP_UP_MESSAGE,
  AUTO_WAKE_PROMPT,
  DEFAULT_QUOTA_THRESHOLD,
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

describe("QuotaCircuitBreaker Evaluator", () => {
  const fixedNow = new Date("2026-08-24T12:00:00.000Z").getTime();

  it("returns status OK when quota is above 10% threshold", () => {
    const breaker = new QuotaCircuitBreaker();
    const report = createMockReport([
      createMockMetric("gemini-2.5-pro", 85.0, "2026-08-24T14:18:42.000Z"),
      createMockMetric("claude-3-7-sonnet", 42.5, "2026-08-24T15:00:00.000Z"),
    ]);

    const result = breaker.evaluate(report, { now: fixedNow });

    expect(result.status).toBe("OK");
    expect(result.isTriggered).toBe(false);
    expect(result.thresholdPercentage).toBe(DEFAULT_QUOTA_THRESHOLD);
    expect(result.lowestRemainingQuota).toBe(42.5);
    expect(result.constrainedModels.length).toBe(0);
    expect(result.wrapUpDirectives.length).toBe(0);
    expect(result.autoWakeSchedule).toBeNull();
    expect(result.summary).toContain("Quota healthy at 42.50%");
  });

  it("triggers circuit breaker when quota is below 10% (<10%) and calculates resetTime + 60s auto-wake", () => {
    const breaker = new QuotaCircuitBreaker();
    const resetTimeIso = "2026-08-24T14:18:42.000Z";
    const report = createMockReport([
      createMockMetric("gemini-2.5-flash", 80.0, "2026-08-24T16:00:00.000Z"),
      createMockMetric("gemini-2.5-pro", 4.2, resetTimeIso),
    ]);

    const result = breaker.evaluate(report, {
      now: fixedNow,
      activeAgentsCount: 3,
    });

    expect(result.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(result.isTriggered).toBe(true);
    expect(result.lowestRemainingQuota).toBe(4.2);
    expect(result.constrainedModels.length).toBe(1);
    expect(result.constrainedModels[0]!.modelName).toBe("gemini-2.5-pro");
    expect(result.constrainedModels[0]!.remainingPercentage).toBe(4.2);
    expect(result.constrainedModels[0]!.resetTime).toBe(resetTimeIso);

    expect(result.wrapUpDirectives.length).toBe(1);
    expect(result.wrapUpDirectives[0]!.message).toBe(CRITICAL_WRAP_UP_MESSAGE);
    expect(result.wrapUpDirectives[0]!.action).toBe("idle");
    expect(result.wrapUpDirectives[0]!.forbidKill).toBe(true);

    const expectedWakeupIso = "2026-08-24T14:19:42.000Z";
    const expectedDurationSec = 8382;

    expect(result.autoWakeSchedule).not.toBeNull();
    expect(result.autoWakeSchedule!.type).toBe("one_shot_timer");
    expect(result.autoWakeSchedule!.targetWakeupIso).toBe(expectedWakeupIso);
    expect(result.autoWakeSchedule!.durationSeconds).toBe(expectedDurationSec);
    expect(result.autoWakeSchedule!.prompt).toBe(AUTO_WAKE_PROMPT);
    expect(result.autoWakeSchedule!.timerCondition).toBe("never");
    expect(result.autoWakeSchedule!.activeAgentsCount).toBe(3);
  });

  it("triggers freeze at exactly 10.0% boundary condition (<= 10.0%)", () => {
    const breaker = new QuotaCircuitBreaker();
    const resetTimeIso = "2026-08-24T13:30:00.000Z";
    const boundaryReport = createMockReport([
      createMockMetric("boundary-model", 10.0, resetTimeIso),
    ]);

    const result = breaker.evaluate(boundaryReport, { now: fixedNow });

    expect(result.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(result.isTriggered).toBe(true);
    expect(result.lowestRemainingQuota).toBe(10.0);
    expect(result.constrainedModels.length).toBe(1);
  });

  it("remains OK at 10.01% remaining quota (> 10.0%)", () => {
    const breaker = new QuotaCircuitBreaker();
    const aboveReport = createMockReport([
      createMockMetric("safe-model", 10.01, "2026-08-24T13:30:00.000Z"),
    ]);

    const result = breaker.evaluate(aboveReport, { now: fixedNow });

    expect(result.status).toBe("OK");
    expect(result.isTriggered).toBe(false);
    expect(result.lowestRemainingQuota).toBe(10.01);
  });

  it("triggers at exactly 0% remaining quota", () => {
    const breaker = new QuotaCircuitBreaker();
    const resetTimeIso = "2026-08-24T13:00:00.000Z";
    const report = createMockReport([createMockMetric("exhausted-model", 0.0, resetTimeIso)]);

    const result = breaker.evaluate(report, { now: fixedNow });

    expect(result.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(result.isTriggered).toBe(true);
    expect(result.lowestRemainingQuota).toBe(0.0);
    expect(result.autoWakeSchedule!.durationSeconds).toBe(3660);
    expect(result.autoWakeSchedule!.targetWakeupIso).toBe("2026-08-24T13:01:00.000Z");
  });

  it("picks the earliest relevant resetTime when multiple models are constrained", () => {
    const breaker = new QuotaCircuitBreaker();
    const report = createMockReport([
      createMockMetric("model-late", 2.0, "2026-08-24T16:00:00.000Z"),
      createMockMetric("model-earliest", 1.5, "2026-08-24T13:30:00.000Z"),
      createMockMetric("model-mid", 3.0, "2026-08-24T14:45:00.000Z"),
      createMockMetric("model-healthy", 90.0, "2026-08-24T12:30:00.000Z"),
    ]);

    const result = breaker.evaluate(report, { now: fixedNow });

    expect(result.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(result.constrainedModels.length).toBe(3);
    expect(result.autoWakeSchedule!.targetWakeupIso).toBe("2026-08-24T13:31:00.000Z");
    expect(result.autoWakeSchedule!.durationSeconds).toBe(5460);
  });

  it("falls back to default 5-hour safe window (18000s + 60s) when resetTime is missing", () => {
    const breaker = new QuotaCircuitBreaker();
    const report = createMockReport([createMockMetric("unspecified-model", 3.0, undefined)]);

    const result = breaker.evaluate(report, { now: fixedNow });

    expect(result.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
    expect(result.constrainedModels[0]!.resetTime).toBeUndefined();
    expect(result.autoWakeSchedule!.durationSeconds).toBe(18060);
    const expectedWakeupDate = new Date(fixedNow + 18060 * 1000).toISOString();
    expect(result.autoWakeSchedule!.targetWakeupIso).toBe(expectedWakeupDate);
  });

  it("generates targeted wrap-up directives when specific activeAgentIds are supplied", () => {
    const breaker = new QuotaCircuitBreaker();
    const report = createMockReport([
      createMockMetric("gemini-2.5-pro", 2.5, "2026-08-24T13:00:00.000Z"),
    ]);

    const result = breaker.evaluate(report, {
      now: fixedNow,
      activeAgentIds: ["agent-implementer-1", "agent-validator-1"],
    });

    expect(result.wrapUpDirectives.length).toBe(2);
    expect(result.wrapUpDirectives[0]!.recipient).toBe("agent-implementer-1");
    expect(result.wrapUpDirectives[1]!.recipient).toBe("agent-validator-1");
    expect(result.autoWakeSchedule!.activeAgentsCount).toBe(2);
  });
});
