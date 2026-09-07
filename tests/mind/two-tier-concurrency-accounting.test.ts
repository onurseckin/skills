import { describe, expect, it } from "bun:test";
import { calculateBrentConcurrency } from "../../olt/scripts/src/orchestrator/concurrency/index.ts";
import {
  auditConcurrencySaturation,
  auditSkillConcurrencySaturation,
} from "../../olt/scripts/src/mind/auditing/skill-concurrency-auditor.ts";
import { createFleetConcurrencyController } from "../../olt/scripts/src/mind/concurrency/index.ts";

describe("Epic 13: Two-Tier Concurrency Accounting", () => {
  describe("Tier 0-2 supervisory agents are exempt from saturation caps", () => {
    it("reports a fleet of only supervisors as NOT saturated regardless of count", () => {
      const controller = createFleetConcurrencyController({ maxCap: 3 });
      const supervisorAgentIds = [
        "mind-1",
        "mind-auditor-1",
        "orchestrator-1",
        "coordinator-1",
        "coordinator-2",
        "coordinator-3",
        "coordinator-4",
      ];

      for (const agentId of supervisorAgentIds) {
        const result = controller.tryAcquireSeat({ agentId, tier: "SUPERVISOR" });
        expect(result.granted).toBe(true);
        expect(result.queued).toBeUndefined();
      }

      expect(controller.isSaturated()).toBe(false);
      expect(controller.getActiveCount()).toBe(0);
      expect(controller.getActiveSupervisorCount()).toBe(supervisorAgentIds.length);

      const stats = controller.getStats();
      expect(stats.isSaturated).toBe(false);
      expect(stats.activeCount).toBe(0);
      expect(stats.activeSupervisorCount).toBe(supervisorAgentIds.length);
      expect(stats.availableSeats).toBe(3);
    });

    it("computes saturation purely from Tier 3 worker seats", () => {
      const controller = createFleetConcurrencyController({ maxCap: 2 });

      controller.tryAcquireSeat({ agentId: "implementer-1", tier: "TIER_3" });
      controller.tryAcquireSeat({ agentId: "validator-1", tier: "TIER_3" });
      expect(controller.isSaturated()).toBe(true);

      controller.tryAcquireSeat({ agentId: "mind-1", tier: "SUPERVISOR" });
      controller.tryAcquireSeat({ agentId: "coordinator-1", tier: "SUPERVISOR" });
      controller.tryAcquireSeat({ agentId: "orchestrator-1", tier: "SUPERVISOR" });

      expect(controller.isSaturated()).toBe(true);
      expect(controller.getActiveCount()).toBe(2);
      expect(controller.getActiveSupervisorCount()).toBe(3);
    });

    it("counts only the workers in a mixed fleet of workers and supervisors", () => {
      const controller = createFleetConcurrencyController({ maxCap: 5 });

      controller.tryAcquireSeat({ agentId: "implementer-1", tier: "TIER_3" });
      controller.tryAcquireSeat({ agentId: "validator-1", tier: "TIER_3" });
      controller.tryAcquireSeat({ agentId: "completeness-critic-1", tier: "TIER_3" });

      controller.tryAcquireSeat({ agentId: "mind-1", tier: "SUPERVISOR" });
      controller.tryAcquireSeat({ agentId: "mind-auditor-1", tier: "SUPERVISOR" });
      controller.tryAcquireSeat({ agentId: "orchestrator-1", tier: "SUPERVISOR" });
      controller.tryAcquireSeat({ agentId: "coordinator-1", tier: "SUPERVISOR" });

      const stats = controller.getStats();
      expect(stats.activeCount).toBe(3);
      expect(stats.activeSupervisorCount).toBe(4);
      expect(stats.isSaturated).toBe(false);
      expect(stats.availableSeats).toBe(2);
      expect(stats.seatsByTier["TIER_3"]).toBe(3);
      expect(stats.supervisorsByTier["SUPERVISOR"]).toBe(4);
    });

    it("classifies workers whose agentId carries no recognizable prefix by their declared role label", () => {
      const controller = createFleetConcurrencyController({ maxCap: 1 });

      const coordinatorResult = controller.tryAcquireSeat({
        agentId: "worker-pool-slot-9",
        tier: "COORDINATOR",
      });
      expect(coordinatorResult.granted).toBe(true);
      expect(controller.getActiveCount()).toBe(0);
      expect(controller.getActiveSupervisorCount()).toBe(1);

      const implementerResult = controller.tryAcquireSeat({
        agentId: "worker-pool-slot-10",
        tier: "IMPLEMENTER",
      });
      expect(implementerResult.granted).toBe(true);
      expect(controller.getActiveCount()).toBe(1);
      expect(controller.isSaturated()).toBe(true);
    });

    it("keeps the Tier-3 station-based skill concurrency auditor unaffected by supervisor telemetry", () => {
      const withoutSupervisors = auditConcurrencySaturation({
        totalWorkUnits: 4,
        activeSlots: 4,
        totalSlots: 4,
      });
      const withSupervisors = auditConcurrencySaturation({
        totalWorkUnits: 4,
        activeSlots: 4,
        totalSlots: 4,
        activeSupervisorCount: 12,
      });

      expect(withoutSupervisors.isSaturated).toBe(withSupervisors.isSaturated);
      expect(withoutSupervisors.activeSlots).toBe(withSupervisors.activeSlots);
      expect(withSupervisors.activeSupervisorCount).toBe(12);

      const result = auditSkillConcurrencySaturation({
        totalWorkUnits: 4,
        activeSlots: 0,
        totalSlots: 4,
        activeSupervisorCount: 25,
      });
      expect(result.active_supervisors).toBe(25);
      expect(result.active_workers).toBe(0);
    });
  });

  describe("Brent's Rule: P = ceil(W / S) worker parallelism target", () => {
    it("returns zero parallelism for zero work regardless of span length", () => {
      expect(calculateBrentConcurrency(0, 5, 1, 1000)).toBe(0);
      expect(calculateBrentConcurrency(0, 1, 1, 1000)).toBe(0);
    });

    it("computes exact ceil(W/S) when W divides evenly by S", () => {
      expect(calculateBrentConcurrency(10, 5, 1, 1000)).toBe(2);
      expect(calculateBrentConcurrency(9, 3, 1, 1000)).toBe(3);
    });

    it("rounds up to the next whole worker when W does not divide evenly by S", () => {
      expect(calculateBrentConcurrency(11, 5, 1, 1000)).toBe(3);
      expect(calculateBrentConcurrency(1, 5, 1, 1000)).toBe(1);
      expect(calculateBrentConcurrency(7, 3, 1, 1000)).toBe(3);
    });

    it("treats a span length of zero or below as a span of exactly 1", () => {
      expect(calculateBrentConcurrency(6, 0, 1, 1000)).toBe(6);
      expect(calculateBrentConcurrency(6, -3, 1, 1000)).toBe(6);
    });

    it("clamps the theoretical parallelism to the configured minimum and maximum bounds", () => {
      expect(calculateBrentConcurrency(3, 1, 5, 15)).toBe(3);
      expect(calculateBrentConcurrency(1000, 1, 5, 15)).toBe(15);
      expect(calculateBrentConcurrency(100, 10, 5, 15)).toBe(10);
    });
  });
});
