import { describe, expect, it } from "bun:test";
import {
  CRITICAL_WRAP_UP_MESSAGE,
  DEFAULT_QUOTA_THRESHOLD,
  QuotaCircuitBreaker,
  checkQuotaCircuitBreaker,
} from "../../olt/scripts/src/telemetry/circuit-breaker.ts";
import type { TelemetryNormalizationEngine } from "../../olt/scripts/src/telemetry/engine.ts";
import type { UnifiedTelemetryReport } from "../../olt/scripts/src/telemetry/types.ts";

function createReport(
  remainingPercentage: number | null,
  isDetected = true,
): UnifiedTelemetryReport {
  return {
    timestamp: "2026-09-01T12:00:00.000Z",
    results: [
      {
        platformId: "antigravity",
        isDetected,
        primaryTierUsed: "tier1_cli_command",
        metrics:
          remainingPercentage !== null
            ? [
                {
                  rawMetricName: "gemini-2.5-pro",
                  canonicalProvider: "google",
                  windowType: "5_hour",
                  remainingPercentage,
                  sourceTier: "tier1_cli_command",
                  confidence: "verified_exact",
                  rawPayload: {},
                },
              ]
            : [],
        rawObservations: {},
        errors: [],
      },
    ],
    summary: {
      totalCollectors: 1,
      detectedPlatforms: isDetected ? 1 : 0,
      lowestRemainingQuota: remainingPercentage,
      activeWarnings: [],
    },
  };
}

describe("Telemetry Circuit Breaker Coverage Suite", () => {
  describe("checkQuotaCircuitBreaker standalone function", () => {
    it("handles numeric fraction quota <= 1.0", () => {
      const verdict = checkQuotaCircuitBreaker(0.08);
      expect(verdict.tripped).toBe(true);
      expect(verdict.remainingPercentage).toBe(8);
      expect(verdict.status).toBe("TRIPPED");
      expect(verdict.wrapUpMessage).toBe(CRITICAL_WRAP_UP_MESSAGE);
      expect(verdict.reason).toContain("Remaining quota 8.00%");
    });

    it("handles numeric percentage quota > 1.0", () => {
      const verdict = checkQuotaCircuitBreaker(75.5);
      expect(verdict.tripped).toBe(false);
      expect(verdict.remainingPercentage).toBe(75.5);
      expect(verdict.status).toBe("OK");
      expect(verdict.reason).toBeUndefined();
      expect(verdict.wrapUpMessage).toBeUndefined();
    });

    it("handles non-positive numeric quota <= 0", () => {
      const verdict = checkQuotaCircuitBreaker(0);
      expect(verdict.tripped).toBe(true);
      expect(verdict.remainingPercentage).toBe(0);
    });

    it("extracts quota from remainingPercentage, remainingPercent, and remainingFraction", () => {
      const v1 = checkQuotaCircuitBreaker({ remainingPercentage: 45 });
      expect(v1.remainingPercentage).toBe(45);
      expect(v1.tripped).toBe(false);

      const v2 = checkQuotaCircuitBreaker({ remainingPercent: 30 });
      expect(v2.remainingPercentage).toBe(30);

      const v3 = checkQuotaCircuitBreaker({ remainingFraction: 0.25 });
      expect(v3.remainingPercentage).toBe(25);
    });

    it("extracts quota from remaining/total and used/total calculations", () => {
      const vRatio = checkQuotaCircuitBreaker({ remaining: 40, total: 200 });
      expect(vRatio.remainingPercentage).toBe(20);

      const vUsed = checkQuotaCircuitBreaker({ used: 160, total: 200 });
      expect(vUsed.remainingPercentage).toBe(20);

      const vOverused = checkQuotaCircuitBreaker({ used: 250, total: 200 });
      expect(vOverused.remainingPercentage).toBe(0);
    });

    it("extracts resetTime and reset_time properties", () => {
      const vTime1 = checkQuotaCircuitBreaker({
        remainingPercentage: 5,
        resetTime: "2026-09-01T15:00:00.000Z",
      });
      expect(vTime1.resetTime).toBe("2026-09-01T15:00:00.000Z");

      const vTime2 = checkQuotaCircuitBreaker({
        remainingPercentage: 5,
        reset_time: "2026-09-01T16:00:00.000Z",
      });
      expect(vTime2.resetTime).toBe("2026-09-01T16:00:00.000Z");
    });

    it("handles unparseable objects, null, undefined, and non-record primitives", () => {
      expect(checkQuotaCircuitBreaker(null).remainingPercentage).toBe(0);
      expect(checkQuotaCircuitBreaker(undefined).remainingPercentage).toBe(0);
      expect(checkQuotaCircuitBreaker("invalid").remainingPercentage).toBe(0);
      expect(checkQuotaCircuitBreaker(true).remainingPercentage).toBe(0);
      expect(checkQuotaCircuitBreaker({}).remainingPercentage).toBe(0);
    });

    it("evaluates custom threshold percentages accurately", () => {
      const verdict = checkQuotaCircuitBreaker(15, 20.0);
      expect(verdict.tripped).toBe(true);
      expect(verdict.thresholdPercentage).toBe(20.0);
      expect(verdict.reason).toContain("threshold 20.00%");
    });
  });

  describe("QuotaCircuitBreaker class lifecycle & methods", () => {
    it("instantiates with custom options and evaluates healthy report", () => {
      const breaker = new QuotaCircuitBreaker({
        thresholdPercentage: 12,
        recoveryThresholdPercentage: 18,
        defaultSafeWindowSeconds: 7200,
        bufferSeconds: 30,
        cooldownSeconds: 120,
        activeHost: "antigravity",
      });

      const report = createReport(80);
      const evalResult = breaker.evaluate(report);

      expect(evalResult.status).toBe("OK");
      expect(evalResult.isTriggered).toBe(false);
      expect(breaker.getLastEvaluation()).toEqual(evalResult);
    });

    it("trips and tracks lastTrippedAt timestamp then clears upon recovery", () => {
      const breaker = new QuotaCircuitBreaker();
      const fixedNow = 1_788_264_000_000;

      const trippedReport = createReport(5);
      const trippedResult = breaker.evaluate(trippedReport, { now: fixedNow });
      expect(trippedResult.isTriggered).toBe(true);
      expect(breaker.getLastEvaluation()?.isTriggered).toBe(true);

      const recoveredReport = createReport(90);
      const recoveredResult = breaker.evaluate(recoveredReport, {
        now: fixedNow + 500_000,
        previousStatus: "QUOTA_EXHAUSTED_CIRCUIT_BROKEN",
      });
      expect(recoveredResult.isTriggered).toBe(false);
    });

    it("resets internal state cleanly with reset() method", () => {
      const breaker = new QuotaCircuitBreaker();
      breaker.evaluate(createReport(5));
      expect(breaker.getLastEvaluation()).toBeDefined();

      breaker.reset();
      expect(breaker.getLastEvaluation()).toBeUndefined();
    });

    it("evaluates asynchronously using TelemetryNormalizationEngine instance", async () => {
      const breaker = new QuotaCircuitBreaker();
      const mockEngine = {
        probeAll: async () => createReport(85),
      } as unknown as TelemetryNormalizationEngine;

      const result = await breaker.evaluateAsync(mockEngine);
      expect(result.status).toBe("OK");
      expect(result.lowestRemainingQuota).toBe(85);
    });

    it("exposes static evaluate and formatMarkdown helpers", () => {
      const report = createReport(5);
      const result = QuotaCircuitBreaker.evaluate(report, { activeHost: "antigravity" });
      expect(result.isTriggered).toBe(true);

      const briefMarkdown = QuotaCircuitBreaker.formatMarkdown(result, false);
      expect(briefMarkdown.length).toBeGreaterThan(0);
      expect(briefMarkdown).toContain("CIRCUIT-BREAKER");

      const detailedMarkdown = QuotaCircuitBreaker.formatMarkdown(result, true);
      expect(detailedMarkdown.length).toBeGreaterThan(briefMarkdown.length);
    });
  });
});
