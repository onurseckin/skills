import { describe, expect, it } from "bun:test";
import {
  calculateRemainingHeadroom,
  calculateUtilizationRatio,
  createResourceGovernor,
  isStateStricter,
  type ExternalThrottleEvent,
  type ResourceGovernor,
  type ResourceType,
} from "../../../../olt/scripts/src/mind/lifecycle/resource-governor.ts";

describe("Mind Assembly Lifecycle Governance Exhaustive Suite", () => {
  const makeGovernor = (limits?: {
    maxRpm?: number;
    maxTpm?: number;
    maxDailyCompute?: number;
    maxConcurrency?: number;
  }): ResourceGovernor =>
    createResourceGovernor({
      limits: {
        maxRpm: limits?.maxRpm ?? 100,
        maxTpm: limits?.maxTpm ?? 10_000,
        maxDailyCompute: limits?.maxDailyCompute ?? 100_000,
        maxConcurrency: limits?.maxConcurrency ?? 10,
      },
      warningThreshold: 0.8,
      criticalThreshold: 0.95,
      recoveryThreshold: 0.5,
      windowDurationRpmMs: 60_000,
      windowDurationTpmMs: 60_000,
    });

  describe("Utility Invariants & Headroom Computations", () => {
    it("computes utilization ratios and clamps to [0.0, 1.0]", () => {
      expect(calculateUtilizationRatio(0, 100)).toBe(0);
      expect(calculateUtilizationRatio(50, 100)).toBe(0.5);
      expect(calculateUtilizationRatio(100, 100)).toBe(1);
      expect(calculateUtilizationRatio(150, 100)).toBe(1);
      expect(calculateUtilizationRatio(10, 0)).toBe(1);
    });

    it("computes remaining headroom with floor of zero", () => {
      expect(calculateRemainingHeadroom(30, 100)).toBe(70);
      expect(calculateRemainingHeadroom(100, 100)).toBe(0);
      expect(calculateRemainingHeadroom(120, 100)).toBe(0);
      expect(calculateRemainingHeadroom(5, 0)).toBe(0);
    });

    it("evaluates strict state ordering correctly", () => {
      expect(isStateStricter("WARNING", "NOMINAL")).toBe(true);
      expect(isStateStricter("EXHAUSTED", "WARNING")).toBe(true);
      expect(isStateStricter("HIBERNATING", "EXHAUSTED")).toBe(true);
      expect(isStateStricter("NOMINAL", "HIBERNATING")).toBe(false);
    });
  });

  describe("Initial Headroom & State Progression", () => {
    it("initializes in NOMINAL state with full headroom across all dimensions", () => {
      const gov = makeGovernor();
      const status = gov.getStatus();

      expect(status.state).toBe("NOMINAL");
      expect(status.throttleCount).toBe(0);
      expect(status.lastThrottleEvent).toBeUndefined();

      const dimensions: ResourceType[] = ["API_RPM", "API_TPM", "DAILY_COMPUTE", "CONCURRENCY"];
      for (const dim of dimensions) {
        expect(status.headroom[dim].currentUsage).toBe(0);
        expect(status.headroom[dim].utilizationRatio).toBe(0);
        expect(status.headroom[dim].remainingHeadroom).toBeGreaterThan(0);
      }
    });

    it("progresses states: NOMINAL -> WARNING -> HIBERNATING based on utilization", () => {
      const gov = makeGovernor({ maxRpm: 100 });
      const now = 1_000_000;

      // 50% usage: NOMINAL
      let status = gov.recordUsage({ requests: 50 }, now);
      expect(status.state).toBe("NOMINAL");

      // 85% usage: WARNING
      status = gov.recordUsage({ requests: 35 }, now);
      expect(status.state).toBe("WARNING");
      expect(status.headroom.API_RPM.utilizationRatio).toBe(0.85);

      // 96% usage: HIBERNATING (criticalThreshold = 0.95)
      status = gov.recordUsage({ requests: 11 }, now);
      expect(status.state).toBe("HIBERNATING");
    });

    it("invokes onStateChange listeners and transitions to RECOVERING state", () => {
      const transitions: Array<[string, string]> = [];
      const gov = makeGovernor({ maxRpm: 100 });
      gov.onStateChange((from, to) => {
        transitions.push([from, to]);
      });

      const t0 = 1_000_000;
      // 85% usage triggers WARNING
      gov.recordUsage({ requests: 85 }, t0);
      expect(transitions).toEqual([["NOMINAL", "WARNING"]]);

      // At t0 + 60_001, initial 85 requests roll off, and 65 requests are active (above recovery 0.50, below warning 0.80)
      const t1 = t0 + 60_001;
      const status = gov.recordUsage({ requests: 65 }, t1);

      expect(status.state).toBe("RECOVERING");
      expect(transitions).toEqual([
        ["NOMINAL", "WARNING"],
        ["WARNING", "RECOVERING"],
      ]);
    });
  });

  describe("External Throttle Ingestion & Recovery", () => {
    it("forces HIBERNATING state, records throttle event and estimated recovery", () => {
      const gov = makeGovernor();
      const now = 1_000_000;
      const event: ExternalThrottleEvent = {
        resourceType: "API_RPM",
        retryAfterMs: 30_000,
        reason: "Rate limit exceeded (HTTP 429)",
        statusCode: 429,
      };

      const status = gov.recordExternalThrottle(event, now);
      expect(status.state).toBe("HIBERNATING");
      expect(status.throttleCount).toBe(1);
      expect(status.lastThrottleEvent?.statusCode).toBe(429);
      expect(status.estimatedRecoveryMs).toBe(30_000);

      // Halfway through throttle window
      const midStatus = gov.getStatus(now + 15_000);
      expect(midStatus.state).toBe("HIBERNATING");
      expect(midStatus.estimatedRecoveryMs).toBe(15_000);

      // After throttle window expires
      const expiredStatus = gov.getStatus(now + 31_000);
      expect(expiredStatus.state).toBe("NOMINAL");
      expect(expiredStatus.estimatedRecoveryMs).toBe(0);
    });
  });

  describe("Dispatch Admissibility & Capacity Gating", () => {
    it("admits dispatches when nominal and rejects when capacity is exceeded", () => {
      const gov = makeGovernor({ maxConcurrency: 5, maxRpm: 10, maxTpm: 10_000 });
      const now = 1_000_000;

      expect(gov.canDispatch(1, 0, 1, now).allowed).toBe(true);

      // Concurrency rejection
      const concReject = gov.canDispatch(1, 0, 6, now);
      expect(concReject.allowed).toBe(false);
      expect(concReject.limitingResource).toBe("CONCURRENCY");
      expect(concReject.reason).toContain("Concurrency capacity exceeded");

      // RPM rejection
      const rpmReject = gov.canDispatch(11, 0, 1, now);
      expect(rpmReject.allowed).toBe(false);
      expect(rpmReject.limitingResource).toBe("API_RPM");
      expect(rpmReject.reason).toContain("RPM capacity exceeded");

      // TPM rejection
      const tpmReject = gov.canDispatch(1, 15_000, 1, now);
      expect(tpmReject.allowed).toBe(false);
      expect(tpmReject.limitingResource).toBe("API_TPM");
      expect(tpmReject.reason).toContain("TPM capacity exceeded");
    });

    it("rejects all dispatches while in HIBERNATING state", () => {
      const gov = makeGovernor();
      const now = 1_000_000;

      gov.recordExternalThrottle(
        { resourceType: "API_RPM", retryAfterMs: 10_000, reason: "429" },
        now,
      );
      const result = gov.canDispatch(1, 0, 1, now);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("HIBERNATING");
    });
  });

  describe("Sliding Window Roll-off, Concurrency & Reset", () => {
    it("rolls off usage as virtual time advances past the sliding window", () => {
      const gov = makeGovernor({ maxRpm: 100 });
      const t0 = 1_000_000;

      gov.recordUsage({ requests: 90 }, t0);
      expect(gov.getStatus(t0).headroom.API_RPM.currentUsage).toBe(90);

      // Advance time by 61 seconds (past windowDurationRpmMs = 60_000)
      const t1 = t0 + 61_000;
      const rolledStatus = gov.getStatus(t1);
      expect(rolledStatus.headroom.API_RPM.currentUsage).toBe(0);
      expect(rolledStatus.state).toBe("NOMINAL");
    });

    it("acquires, clamps, and releases concurrency seats", () => {
      const gov = makeGovernor({ maxConcurrency: 3 });

      expect(gov.acquireConcurrency(2)).toBe(true);
      expect(gov.getStatus().headroom.CONCURRENCY.currentUsage).toBe(2);

      // Exceeds limit (2 + 2 > 3)
      expect(gov.acquireConcurrency(2)).toBe(false);

      expect(gov.releaseConcurrency(1)).toBe(1);
      expect(gov.getStatus().headroom.CONCURRENCY.currentUsage).toBe(1);

      expect(gov.releaseConcurrency(5)).toBe(0);
      expect(gov.getStatus().headroom.CONCURRENCY.currentUsage).toBe(0);
    });

    it("resets individual and all resource windows completely", () => {
      const gov = makeGovernor();
      gov.recordUsage({ requests: 50, tokens: 5000, computeUnits: 1000 });
      gov.acquireConcurrency(5);

      gov.resetWindow("API_RPM");
      expect(gov.getStatus().headroom.API_RPM.currentUsage).toBe(0);
      expect(gov.getStatus().headroom.API_TPM.currentUsage).toBe(5000);

      gov.resetWindow(); // Resets all
      const status = gov.getStatus();
      expect(status.headroom.API_TPM.currentUsage).toBe(0);
      expect(status.headroom.DAILY_COMPUTE.currentUsage).toBe(0);
      expect(status.headroom.CONCURRENCY.currentUsage).toBe(0);
    });
  });
});
