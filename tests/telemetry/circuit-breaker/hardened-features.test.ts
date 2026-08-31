import { describe, expect, it } from "bun:test";
import {
  MAX_FUTURE_CLOCK_SKEW_MS,
  MAX_STORAGE_CACHE_TTL_MS,
  QuotaCircuitBreaker,
  TokenReservoir,
  evaluateCircuitBreaker,
  extractResetTime,
  validateStorageCacheFreshness,
  type NormalizedQuotaMetric,
  type UnifiedTelemetryReport,
} from "../../../olt/scripts/src/telemetry/index.ts";

function createMetric(
  name: string,
  remainingPercentage: number | null,
  payload: Record<string, unknown> = {},
): NormalizedQuotaMetric {
  return {
    rawMetricName: name,
    canonicalProvider: "google",
    windowType: "5_hour",
    remainingPercentage,
    sourceTier: "tier1_cli_command",
    confidence: remainingPercentage !== null ? "verified_exact" : "unknown",
    rawPayload: payload,
  };
}

function createReport(
  platformId: string,
  metrics: NormalizedQuotaMetric[],
  isDetected = true,
  errors: Error[] = [],
): UnifiedTelemetryReport {
  const lowest = metrics.length > 0 ? metrics[0]!.remainingPercentage : null;
  return {
    timestamp: new Date().toISOString(),
    results: [
      {
        platformId,
        isDetected,
        primaryTierUsed: isDetected ? "tier1_cli_command" : null,
        metrics,
        rawObservations: {},
        errors,
      },
    ],
    summary: { activeHost: platformId, lowestRemainingQuota: lowest },
  };
}

describe("Domain 15 Hardened Telemetry & Circuit Breaker Features", () => {
  const fixedNow = new Date("2026-08-24T12:00:00.000Z").getTime();

  describe("Challenge 1: Circuit Trip Hysteresis & Cooldown", () => {
    it("trips at <= 10% and remains tripped at 12% due to 15% recovery threshold", () => {
      const breaker = new QuotaCircuitBreaker();
      const trippedReport = createReport("antigravity", [createMetric("m1", 8.0)]);
      const eval1 = breaker.evaluate(trippedReport, { now: fixedNow });
      expect(eval1.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
      expect(eval1.isTriggered).toBe(true);

      const intermediateReport = createReport("antigravity", [createMetric("m1", 12.0)]);
      const eval2 = breaker.evaluate(intermediateReport, {
        now: fixedNow + 10_000,
        previousStatus: eval1.status,
        lastTrippedAt: fixedNow,
      });
      expect(eval2.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");
      expect(eval2.isTriggered).toBe(true);
    });

    it("recovers to OK only when quota >= 15% and cooldown has elapsed", () => {
      const breaker = new QuotaCircuitBreaker();
      const recoveredReport = createReport("antigravity", [createMetric("m1", 16.0)]);

      const evalCooldown = breaker.evaluate(recoveredReport, {
        now: fixedNow + 30_000,
        previousStatus: "QUOTA_EXHAUSTED_CIRCUIT_BROKEN",
        lastTrippedAt: fixedNow,
        cooldownSeconds: 60,
      });
      expect(evalCooldown.inCooldown).toBe(true);
      expect(evalCooldown.status).toBe("QUOTA_EXHAUSTED_CIRCUIT_BROKEN");

      const evalRecovered = breaker.evaluate(recoveredReport, {
        now: fixedNow + 70_000,
        previousStatus: "QUOTA_EXHAUSTED_CIRCUIT_BROKEN",
        lastTrippedAt: fixedNow,
        cooldownSeconds: 60,
      });
      expect(evalRecovered.inCooldown).toBe(false);
      expect(evalRecovered.status).toBe("OK");
      expect(evalRecovered.isTriggered).toBe(false);
    });
  });

  describe("Challenge 2: Token Reservoir Leases & Concurrency Bounds", () => {
    it("allocates and releases token reservation leases per agent", () => {
      const reservoir = new TokenReservoir();
      const lease1 = reservoir.reserveLease({ agentId: "agent-1", reservedPercentage: 5.0 });
      expect(lease1.leaseId).toBeDefined();
      expect(reservoir.getStatus().activeLeaseCount).toBe(1);
      expect(reservoir.getStatus().totalReservedPercentage).toBe(5.0);

      reservoir.releaseLease(lease1.leaseId);
      expect(reservoir.getStatus().activeLeaseCount).toBe(0);
    });

    it("computes effective quota subtracting concurrency reservations to prevent 0% crash", () => {
      const reservoir = new TokenReservoir({ defaultPerAgentBuffer: 3.0 });
      reservoir.reserveLease({ agentId: "worker-1", reservedPercentage: 4.0 });
      reservoir.reserveLease({ agentId: "worker-2", reservedPercentage: 4.0 });

      const effective = reservoir.calculateEffectiveQuota(15.0, 2);
      expect(effective).toBe(7.0);
    });

    it("prunes expired leases automatically based on TTL", () => {
      const reservoir = new TokenReservoir({ defaultTtlMs: 1000 });
      reservoir.reserveLease({ agentId: "temp-agent", ttlMs: 500 });
      expect(reservoir.getStatus().activeLeaseCount).toBe(1);

      const pruned = reservoir.pruneExpired(Date.now() + 600);
      expect(pruned).toBe(1);
      expect(reservoir.getStatus().activeLeaseCount).toBe(0);
    });
  });

  describe("Challenge 3: Thundering Herd Wakeup & Decorrelated Jitter", () => {
    it("extracts provider backoff headers (Retry-After, x-ratelimit-reset)", () => {
      const m1 = createMetric("retry_model", 2.0, { "retry-after": 120 });
      expect(extractResetTime(m1)).toBe("120");

      const epochMs = fixedNow + 300_000;
      const m2 = createMetric("ratelimit_model", 1.0, {
        "x-ratelimit-reset": Math.floor(epochMs / 1000),
      });
      expect(extractResetTime(m2)).toBe(new Date(epochMs).toISOString());
    });

    it("adds decorrelated jitter and agent stagger when enableJitter is active", () => {
      const report = createReport("antigravity", [
        createMetric("m1", 2.0, { resetTime: "2026-08-24T13:00:00.000Z" }),
      ]);

      const evalNoJitter = evaluateCircuitBreaker(report, { now: fixedNow, bufferSeconds: 60 });
      expect(evalNoJitter.autoWakeSchedule?.durationSeconds).toBe(3660);

      const evalWithJitter = evaluateCircuitBreaker(report, {
        now: fixedNow,
        bufferSeconds: 60,
        enableJitter: true,
        jitterFactor: 0.1,
        jitterSeed: 42,
        activeAgentsCount: 3,
        agentIndex: 2,
      });

      expect(evalWithJitter.autoWakeSchedule?.jitterSeconds).toBeGreaterThan(0);
      expect(evalWithJitter.autoWakeSchedule?.durationSeconds).toBeGreaterThan(3660);
    });
  });

  describe("Challenge 4: Stale Tier-2 Storage Cache TTL & Clock Skew Guard", () => {
    it("validates freshness for recent timestamps", () => {
      const now = Date.now();
      const fresh = validateStorageCacheFreshness(now - 60_000, now);
      expect(fresh.isFresh).toBe(true);
      expect(fresh.ageMs).toBe(60_000);
    });

    it("flags stale cache exceeding 15-minute MAX_STORAGE_CACHE_TTL_MS", () => {
      const now = Date.now();
      const staleTimestamp = now - (MAX_STORAGE_CACHE_TTL_MS + 5000);
      const stale = validateStorageCacheFreshness(staleTimestamp, now);
      expect(stale.isFresh).toBe(false);
      expect(stale.reason).toBe("stale_cache_ttl_expired");
    });

    it("flags future clock skew exceeding 60-second MAX_FUTURE_CLOCK_SKEW_MS", () => {
      const now = Date.now();
      const futureTimestamp = now + (MAX_FUTURE_CLOCK_SKEW_MS + 10_000);
      const drift = validateStorageCacheFreshness(futureTimestamp, now);
      expect(drift.isFresh).toBe(false);
      expect(drift.reason).toBe("future_clock_skew_exceeded");
    });
  });

  describe("Challenge 5: Strict Scoping of Fail-Closed Evaluation to Active Host", () => {
    it("returns OK when active host is nominal even if inactive auxiliary platforms are undetected", () => {
      const multiReport: UnifiedTelemetryReport = {
        timestamp: new Date().toISOString(),
        results: [
          {
            platformId: "antigravity",
            isDetected: true,
            primaryTierUsed: "tier1_cli_command",
            metrics: [createMetric("gemini-2.5-pro", 85.0)],
            rawObservations: {},
            errors: [],
          },
          {
            platformId: "cursor",
            isDetected: false,
            primaryTierUsed: null,
            metrics: [],
            rawObservations: {},
            errors: [new Error("Cursor not installed")],
          },
        ],
        summary: { activeHost: "antigravity", lowestRemainingQuota: 85.0 },
      };

      const breaker = new QuotaCircuitBreaker();
      const evaluation = breaker.evaluate(multiReport, { activeHost: "antigravity" });

      expect(evaluation.status).toBe("OK");
      expect(evaluation.isTriggered).toBe(false);
      expect(evaluation.lowestRemainingQuota).toBe(85.0);
    });
  });
});
