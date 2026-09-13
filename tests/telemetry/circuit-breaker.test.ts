import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  CRITICAL_WRAP_UP_MESSAGE,
  DEFAULT_QUOTA_THRESHOLD,
  QuotaCircuitBreaker,
  checkQuotaCircuitBreaker,
  getTelemetryQuotaProvider,
  resolveMeasuredQuotaPercentage,
  setTelemetryQuotaProvider,
  streamQuotaTelemetryRecord,
  verifyCronSuspension,
  verifyZeroKillInvariant,
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
      expect(checkQuotaCircuitBreaker(NaN).remainingPercentage).toBe(0);
      expect(checkQuotaCircuitBreaker(NaN).tripped).toBe(true);
      expect(checkQuotaCircuitBreaker(Infinity).remainingPercentage).toBe(0);
      expect(checkQuotaCircuitBreaker(Infinity).tripped).toBe(true);
      expect(checkQuotaCircuitBreaker({ remainingPercentage: NaN }).remainingPercentage).toBe(0);
      expect(checkQuotaCircuitBreaker({ remainingPercentage: NaN }).tripped).toBe(true);
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

    it("trips asynchronously when TelemetryNormalizationEngine reports low quota", async () => {
      const breaker = new QuotaCircuitBreaker();
      const mockEngine = {
        probeAll: async () => createReport(4.0),
      } as unknown as TelemetryNormalizationEngine;

      const result = await breaker.evaluateAsync(mockEngine);
      expect(result.isTriggered).toBe(true);
      expect(result.lowestRemainingQuota).toBe(4.0);
      expect(result.wrapUpDirectives.length).toBeGreaterThan(0);
      expect(result.wrapUpDirectives[0]?.forbidKill).toBe(true);
      expect(result.wrapUpDirectives[0]?.action).toBe("idle");
      expect(result.wrapUpDirectives[0]?.message).toBe(CRITICAL_WRAP_UP_MESSAGE);
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

  describe("resolveMeasuredQuotaPercentage & telemetry quota providers", () => {
    it("resolves numbers, fractions, and clamps to [0, 100]", () => {
      expect(resolveMeasuredQuotaPercentage(0.45)).toBe(45);
      expect(resolveMeasuredQuotaPercentage(80)).toBe(80);
      expect(resolveMeasuredQuotaPercentage(150)).toBe(100);
      expect(resolveMeasuredQuotaPercentage(-10)).toBe(0);
      expect(resolveMeasuredQuotaPercentage(NaN)).toBeUndefined();
      expect(resolveMeasuredQuotaPercentage(Infinity)).toBeUndefined();
      expect(resolveMeasuredQuotaPercentage(-Infinity)).toBeUndefined();
    });

    it("resolves percentages from various structured objects", () => {
      expect(resolveMeasuredQuotaPercentage({ remainingPercentage: 42 })).toBe(42);
      expect(resolveMeasuredQuotaPercentage({ quotaPercentage: 55 })).toBe(55);
      expect(resolveMeasuredQuotaPercentage({ quota_percentage: 60 })).toBe(60);
      expect(resolveMeasuredQuotaPercentage({ remaining_percentage: 65 })).toBe(65);
      expect(resolveMeasuredQuotaPercentage({ lowestRemainingQuota: 70 })).toBe(70);
      expect(resolveMeasuredQuotaPercentage({ remainingPercent: 75 })).toBe(75);
      expect(resolveMeasuredQuotaPercentage({ remainingFraction: 0.8 })).toBe(80);
      expect(resolveMeasuredQuotaPercentage({ remaining: 25, total: 100 })).toBe(25);
      expect(resolveMeasuredQuotaPercentage({ used: 30, total: 100 })).toBe(70);
    });

    it("resolves lowest percentage from results and metrics arrays", () => {
      const reportLike = {
        results: [
          {
            metrics: [{ remainingPercentage: 80 }, { remainingPercentage: 22 }],
          },
          {
            metrics: [{ remainingPercentage: 45 }],
          },
        ],
      };
      expect(resolveMeasuredQuotaPercentage(reportLike)).toBe(22);

      const flatMetrics = {
        metrics: [{ remainingPercentage: 90 }, { remainingPercentage: 15 }],
      };
      expect(resolveMeasuredQuotaPercentage(flatMetrics)).toBe(15);
    });

    it("integrates with setTelemetryQuotaProvider and getTelemetryQuotaProvider", () => {
      expect(getTelemetryQuotaProvider()).toBeUndefined();

      setTelemetryQuotaProvider(() => 64);
      expect(getTelemetryQuotaProvider()).toBeDefined();
      expect(resolveMeasuredQuotaPercentage()).toBe(64);

      setTelemetryQuotaProvider(() => ({ remainingPercentage: 38 }));
      expect(resolveMeasuredQuotaPercentage()).toBe(38);

      setTelemetryQuotaProvider(() => {
        throw new Error("Provider boom");
      });
      expect(resolveMeasuredQuotaPercentage()).toBeUndefined();

      setTelemetryQuotaProvider(undefined);
      expect(getTelemetryQuotaProvider()).toBeUndefined();
      expect(resolveMeasuredQuotaPercentage()).toBeUndefined();
    });
  });

  describe("streamQuotaTelemetryRecord & persistence invariants", () => {
    it("appends structured telemetry records into .olt/telemetry.jsonl", () => {
      const vfs = new VirtualMemoryFS();
      const session = createVirtualFSSession(vfs);
      const tmpDir = "/virtual/cb-stream-test";
      try {
        const record = {
          timestamp: new Date().toISOString(),
          source: "circuit-breaker" as const,
          quotaRemainingPercentage: 8.5,
          circuitBreakerTripped: true,
          cronsSuspended: true,
          workersPreservedInRam: true,
          activeHost: "antigravity",
        };

        streamQuotaTelemetryRecord(tmpDir, record);

        const content = vfs.readFileSync(join(tmpDir, ".olt", "telemetry.jsonl"), "utf-8");
        const parsed = JSON.parse(content.trim());
        expect(parsed.source).toBe("circuit-breaker");
        expect(parsed.quotaRemainingPercentage).toBe(8.5);
        expect(parsed.circuitBreakerTripped).toBe(true);
        expect(parsed.cronsSuspended).toBe(true);
        expect(parsed.workersPreservedInRam).toBe(true);
        expect(parsed.activeHost).toBe("antigravity");
      } finally {
        session.cleanup();
      }
    });

    it("silently catches file I/O errors without throwing", () => {
      expect(() => {
        streamQuotaTelemetryRecord("/dev/null/forbidden/directory/path", {
          timestamp: new Date().toISOString(),
          source: "circuit-breaker",
          quotaRemainingPercentage: 5,
          circuitBreakerTripped: true,
          cronsSuspended: true,
          workersPreservedInRam: true,
        });
      }).not.toThrow();
    });
  });

  describe("verifyZeroKillInvariant & verifyCronSuspension invariants", () => {
    it("verifies zero-kill invariant returns preserved: true and defectRequired: false when no worker was killed", () => {
      const activeRunning = verifyZeroKillInvariant(true, false);
      expect(activeRunning.preserved).toBe(true);
      expect(activeRunning.defectRequired).toBe(false);

      const idle = verifyZeroKillInvariant(false, false);
      expect(idle.preserved).toBe(true);
      expect(idle.defectRequired).toBe(false);
    });

    it("verifies zero-kill invariant flags defect when worker is terminated mid-freeze", () => {
      const terminatedActive = verifyZeroKillInvariant(true, true);
      expect(terminatedActive.preserved).toBe(false);
      expect(terminatedActive.defectRequired).toBe(true);

      const terminatedIdle = verifyZeroKillInvariant(false, true);
      expect(terminatedIdle.preserved).toBe(false);
      expect(terminatedIdle.defectRequired).toBe(true);
    });

    it("verifies cron suspension threshold logic and null safety", () => {
      expect(verifyCronSuspension(null)).toBe(false);
      expect(verifyCronSuspension(0)).toBe(true);
      expect(verifyCronSuspension(5)).toBe(true);
      expect(verifyCronSuspension(DEFAULT_QUOTA_THRESHOLD)).toBe(true);
      expect(verifyCronSuspension(DEFAULT_QUOTA_THRESHOLD + 0.01)).toBe(false);
      expect(verifyCronSuspension(50)).toBe(false);
      expect(verifyCronSuspension(100)).toBe(false);
    });
  });
});
