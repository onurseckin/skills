import { describe, expect, it } from "bun:test";
import {
  createFleetConcurrencyController,
  computeFleetSaturationRatio,
  isFleetSaturated,
  isRateLimitRisk,
  getPriorityWeight,
  MAX_FLEET_CONCURRENCY_CAP,
  FleetConcurrencyController,
  type FleetSeat,
} from "../../olt/scripts/src/mind/concurrency-cap.ts";

describe("Fleet Concurrency Controller (Max 50 Subagents Cap)", () => {
  describe("hard ceiling of max 50 subagents", () => {
    it("allows acquiring up to exactly 50 seats", () => {
      const controller = createFleetConcurrencyController();
      for (let i = 0; i < 50; i++) {
        const res = controller.tryAcquireSeat({
          agentId: `agent-${i}`,
          tier: i % 2 === 0 ? "TIER_3" : "TIER_4",
          priority: "HIGH",
        });
        expect(res.granted).toBe(true);
        expect(res.seat).toBeDefined();
        expect(res.seat?.seatIndex).toBe(i);
      }
      expect(controller.getActiveCount()).toBe(50);
      expect(controller.isSaturated()).toBe(true);

      const excess = controller.tryAcquireSeat({
        agentId: "agent-51",
        tier: "TIER_3",
        priority: "CRITICAL",
      });
      expect(excess.granted).toBe(false);
      expect(excess.queued).toBe(true);
      expect(excess.queuePosition).toBe(1);
    });

    it("prevents duplicate seat allocations for identical agentId", () => {
      const controller = createFleetConcurrencyController();
      const first = controller.tryAcquireSeat({ agentId: "agent-dup", tier: "TIER_2" });
      const second = controller.tryAcquireSeat({ agentId: "agent-dup", tier: "TIER_2" });
      expect(first.granted).toBe(true);
      expect(second.granted).toBe(true);
      expect(first.seat?.seatId).toBe(second.seat?.seatId);
      expect(controller.getActiveCount()).toBe(1);
    });
  });

  describe("priority queuing", () => {
    it("prioritizes CRITICAL and HIGH tasks over LOW and BACKGROUND tasks", async () => {
      const controller = new FleetConcurrencyController({ maxCap: 2 });
      await controller.acquireSeat({ agentId: "worker-1", tier: "TIER_3", priority: "LOW" });
      await controller.acquireSeat({ agentId: "worker-2", tier: "TIER_3", priority: "LOW" });

      const lowPromise = controller.acquireSeat({
        agentId: "queued-low",
        tier: "TIER_3",
        priority: "LOW",
      });
      const criticalPromise = controller.acquireSeat({
        agentId: "queued-crit",
        tier: "TIER_3",
        priority: "CRITICAL",
      });
      const highPromise = controller.acquireSeat({
        agentId: "queued-high",
        tier: "TIER_3",
        priority: "HIGH",
      });

      expect(controller.getQueuedCount()).toBe(3);

      controller.releaseSeat("worker-1");
      const firstDrained = await criticalPromise;
      expect(firstDrained.agentId).toBe("queued-crit");

      controller.releaseSeat("worker-2");
      const secondDrained = await highPromise;
      expect(secondDrained.agentId).toBe("queued-high");

      controller.releaseSeat(firstDrained.seatId);
      const thirdDrained = await lowPromise;
      expect(thirdDrained.agentId).toBe("queued-low");
    });

    it("respects FIFO order for tasks with equal priority", async () => {
      const controller = new FleetConcurrencyController({ maxCap: 1 });
      await controller.acquireSeat({ agentId: "active-1", tier: "TIER_3", priority: "MEDIUM" });

      const firstQueued = controller.acquireSeat({
        agentId: "med-1",
        tier: "TIER_3",
        priority: "MEDIUM",
      });
      const secondQueued = controller.acquireSeat({
        agentId: "med-2",
        tier: "TIER_3",
        priority: "MEDIUM",
      });

      controller.releaseSeat("active-1");
      const firstResolved = await firstQueued;
      expect(firstResolved.agentId).toBe("med-1");

      controller.releaseSeat(firstResolved.seatId);
      const secondResolved = await secondQueued;
      expect(secondResolved.agentId).toBe("med-2");
    });
  });

  describe("deterministic seat recycling and reclamation", () => {
    it("recycles seat indices deterministically in ascending order", () => {
      const controller = createFleetConcurrencyController({ maxCap: 5 });
      const seats: FleetSeat[] = [];
      for (let i = 0; i < 5; i++) {
        const res = controller.tryAcquireSeat({ agentId: `agent-${i}`, tier: "TIER_3" });
        if (res.seat) seats.push(res.seat);
      }
      expect(seats.map((s) => s.seatIndex)).toEqual([0, 1, 2, 3, 4]);

      controller.releaseSeat("agent-1");
      controller.releaseSeat("agent-3");

      const new1 = controller.tryAcquireSeat({ agentId: "new-1", tier: "TIER_3" });
      const new2 = controller.tryAcquireSeat({ agentId: "new-2", tier: "TIER_3" });

      expect(new1.seat?.seatIndex).toBe(1);
      expect(new2.seat?.seatIndex).toBe(3);
    });

    it("reclaims stale seats whose lease has expired", () => {
      const controller = createFleetConcurrencyController({
        maxCap: 2,
        defaultLeaseDurationMs: 1000,
      });
      const baseTime = 10000;
      controller.tryAcquireSeat(
        { agentId: "agent-stale-1", tier: "TIER_3", leaseDurationMs: 500 },
        baseTime,
      );
      controller.tryAcquireSeat(
        { agentId: "agent-valid-2", tier: "TIER_3", leaseDurationMs: 2000 },
        baseTime,
      );

      expect(controller.getActiveCount()).toBe(2);

      const reclaimed = controller.reclaimStaleSeats(baseTime + 600);
      expect(reclaimed).toBe(1);
      expect(controller.getActiveCount()).toBe(1);
      expect(controller.getSeat("agent-stale-1")).toBeUndefined();
      expect(controller.getSeat("agent-valid-2")).toBeDefined();
    });

    it("renews seat leases successfully", () => {
      const controller = createFleetConcurrencyController({ maxCap: 2 });
      const baseTime = 5000;
      const res = controller.tryAcquireSeat(
        { agentId: "agent-1", tier: "TIER_3", leaseDurationMs: 1000 },
        baseTime,
      );
      expect(res.seat?.expiresAtMs).toBe(6000);

      const renewed = controller.renewSeat("agent-1", 3000, baseTime + 500);
      expect(renewed).toBe(true);
      expect(controller.getSeat("agent-1")?.expiresAtMs).toBe(9000);
    });
  });

  describe("rate-limit exhaustion prevention & telemetry", () => {
    it("flags rateLimitRisk when active count crosses threshold ratio", () => {
      const controller = createFleetConcurrencyController({
        maxCap: 50,
        rateLimitThresholdRatio: 0.9,
      });
      for (let i = 0; i < 44; i++) {
        controller.tryAcquireSeat({ agentId: `sub-${i}`, tier: "TIER_3" });
      }
      let stats = controller.getStats();
      expect(stats.activeCount).toBe(44);
      expect(stats.rateLimitRisk).toBe(false);

      controller.tryAcquireSeat({ agentId: "sub-44", tier: "TIER_3" });
      stats = controller.getStats();
      expect(stats.activeCount).toBe(45);
      expect(stats.saturationRatio).toBe(0.9);
      expect(stats.rateLimitRisk).toBe(true);
    });

    it("computes accurate seatsByTier and queueByPriority statistics", () => {
      const controller = createFleetConcurrencyController({ maxCap: 3 });
      controller.tryAcquireSeat({ agentId: "c1", tier: "COORDINATOR", priority: "CRITICAL" });
      controller.tryAcquireSeat({ agentId: "s1", tier: "SUPERVISOR", priority: "HIGH" });
      controller.tryAcquireSeat({ agentId: "i1", tier: "IMPLEMENTER", priority: "MEDIUM" });

      void controller.acquireSeat({ agentId: "q1", tier: "VALIDATOR", priority: "LOW" });
      void controller.acquireSeat({ agentId: "q2", tier: "VALIDATOR", priority: "BACKGROUND" });

      const stats = controller.getStats();
      expect(stats.seatsByTier["COORDINATOR"]).toBe(1);
      expect(stats.seatsByTier["SUPERVISOR"]).toBe(1);
      expect(stats.seatsByTier["IMPLEMENTER"]).toBe(1);
      expect(stats.queueByPriority["LOW"]).toBe(1);
      expect(stats.queueByPriority["BACKGROUND"]).toBe(1);
      expect(stats.availableSeats).toBe(0);
      expect(stats.isSaturated).toBe(true);
    });
  });

  describe("timeout and queue management", () => {
    it("times out queued seat requests exceeding timeoutMs", async () => {
      const controller = createFleetConcurrencyController({ maxCap: 1 });
      controller.tryAcquireSeat({ agentId: "held", tier: "TIER_3" });

      const timeoutPromise = controller.acquireSeat({
        agentId: "queued-timeout",
        tier: "TIER_3",
        timeoutMs: 20,
      });

      await expect(timeoutPromise).rejects.toThrow("FLEET_CONCURRENCY_TIMEOUT");
      expect(controller.getQueuedCount()).toBe(0);
    });

    it("clears and resets the controller cleanly", async () => {
      const controller = createFleetConcurrencyController({ maxCap: 2 });
      controller.tryAcquireSeat({ agentId: "a1", tier: "TIER_3" });
      controller.tryAcquireSeat({ agentId: "a2", tier: "TIER_3" });
      const queuedPromise = controller.acquireSeat({ agentId: "q1", tier: "TIER_3" });

      expect(controller.getActiveCount()).toBe(2);
      expect(controller.getQueuedCount()).toBe(1);

      controller.reset();
      await expect(queuedPromise).rejects.toThrow("Fleet controller reset");
      expect(controller.getActiveCount()).toBe(0);
      expect(controller.getQueuedCount()).toBe(0);
      expect(controller.isSaturated()).toBe(false);
    });
  });

  describe("pure calculation helpers", () => {
    it("evaluates saturation ratio, saturation flag, rate limit risk, and priority weights", () => {
      expect(MAX_FLEET_CONCURRENCY_CAP).toBe(50);
      expect(computeFleetSaturationRatio(25, 50)).toBe(0.5);
      expect(computeFleetSaturationRatio(50, 50)).toBe(1.0);
      expect(isFleetSaturated(50, 50)).toBe(true);
      expect(isFleetSaturated(49, 50)).toBe(false);
      expect(isRateLimitRisk(45, 50, 0.9)).toBe(true);
      expect(isRateLimitRisk(40, 50, 0.9)).toBe(false);
      expect(getPriorityWeight("CRITICAL")).toBe(100);
      expect(getPriorityWeight("HIGH")).toBe(75);
      expect(getPriorityWeight("MEDIUM")).toBe(50);
      expect(getPriorityWeight("LOW")).toBe(25);
      expect(getPriorityWeight("BACKGROUND")).toBe(10);
    });
  });
});
