import { describe, expect, it, spyOn, afterEach } from "bun:test";
import * as fs from "node:fs";
import {
  evaluateMindLiveness,
  calculateTimeToStaleMs,
  checkStalePulseReclaimReadiness,
  createPulseHeartbeat,
  analyzeLivenessTrends,
} from "../../../olt/scripts/src/mind/lifecycle/liveness/probe.ts";
import {
  EXIT_CODE_CHECK_FAILURE,
  EXIT_CODE_HEALTHY,
  EXIT_CODE_STALE,
} from "../../../olt/scripts/src/mind/lifecycle/liveness/types.ts";

describe("Mind Lifecycle Liveness Probe Suite", () => {
  const spies: Array<{ mockRestore: () => void }> = [];

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  describe("evaluateMindLiveness", () => {
    it("returns missing_record status when pulse file does not exist", () => {
      spies.push(spyOn(fs, "existsSync").mockReturnValue(false));
      const res = evaluateMindLiveness("/mock/capsule");
      expect(res.status).toBe("missing_record");
      expect(res.healthy).toBe(false);
      expect(res.exitCode).toBe(EXIT_CODE_CHECK_FAILURE);
      expect(res.reason).toContain("does not exist");
      expect(res.metrics.pulseId).toBeNull();
    });

    it("returns corrupted_record when readFileSync throws an Error or non-Error", () => {
      spies.push(spyOn(fs, "existsSync").mockReturnValue(true));
      spies.push(
        spyOn(fs, "readFileSync").mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        }),
      );
      const res1 = evaluateMindLiveness("/mock/capsule");
      expect(res1.status).toBe("corrupted_record");
      expect(res1.healthy).toBe(false);
      expect(res1.exitCode).toBe(EXIT_CODE_CHECK_FAILURE);
      expect(res1.reason).toContain("EACCES");

      spies.push(
        spyOn(fs, "readFileSync").mockImplementation(() => {
          throw "Disk failure string";
        }),
      );
      const res2 = evaluateMindLiveness("/mock/capsule");
      expect(res2.status).toBe("corrupted_record");
      expect(res2.reason).toContain("Disk failure string");
    });

    it("returns corrupted_record when JSON is primitive, array, or malformed", () => {
      spies.push(spyOn(fs, "existsSync").mockReturnValue(true));
      spies.push(spyOn(fs, "readFileSync").mockReturnValue("null" as unknown as Buffer));
      expect(evaluateMindLiveness("/mock/capsule").status).toBe("corrupted_record");

      spies.push(spyOn(fs, "readFileSync").mockReturnValue('"just a string"' as unknown as Buffer));
      expect(evaluateMindLiveness("/mock/capsule").status).toBe("corrupted_record");

      spies.push(spyOn(fs, "readFileSync").mockReturnValue("[1, 2, 3]" as unknown as Buffer));
      expect(evaluateMindLiveness("/mock/capsule").status).toBe("corrupted_record");

      spies.push(spyOn(fs, "readFileSync").mockReturnValue("{ invalid json" as unknown as Buffer));
      expect(evaluateMindLiveness("/mock/capsule").status).toBe("corrupted_record");
    });

    it("evaluates healthy status when pulse record is fresh", () => {
      const now = Date.now();
      const freshRecord = JSON.stringify({
        pulse_id: "pulse-fresh-1",
        closed_at: new Date(now - 10_000).toISOString(),
        outcome: "success",
        next_wake_at: new Date(now + 60_000).toISOString(),
      });
      spies.push(spyOn(fs, "existsSync").mockReturnValue(true));
      spies.push(spyOn(fs, "readFileSync").mockReturnValue(freshRecord as unknown as Buffer));

      const res = evaluateMindLiveness("/mock/capsule", {
        nowMs: now,
        intervalMs: 60_000,
        graceMs: 30_000,
        maxAllowedAgeMs: 90_000,
      });
      expect(res.status).toBe("healthy");
      expect(res.healthy).toBe(true);
      expect(res.exitCode).toBe(EXIT_CODE_HEALTHY);
      expect(res.metrics.pulseId).toBe("pulse-fresh-1");
      expect(res.metrics.outcome).toBe("success");
    });

    it("evaluates stale status when pulse record exceeds allowed threshold", () => {
      const now = Date.now();
      const staleRecord = JSON.stringify({
        pulse_id: "pulse-stale-1",
        closed_at: new Date(now - 2_000_000).toISOString(),
        outcome: "active",
      });
      spies.push(spyOn(fs, "existsSync").mockReturnValue(true));
      spies.push(spyOn(fs, "readFileSync").mockReturnValue(staleRecord as unknown as Buffer));

      const res = evaluateMindLiveness("/mock/capsule", { nowMs: now });
      expect(res.status).toBe("stale");
      expect(res.healthy).toBe(false);
      expect(res.exitCode).toBe(EXIT_CODE_STALE);
      expect(res.reason).toContain("PAGING OWNER");
    });
  });

  describe("calculateTimeToStaleMs", () => {
    it("handles number, Date instance, and string ISO timestamps for fresh and stale states", () => {
      const now = 1_000_000;
      const fresh = calculateTimeToStaleMs(now - 100_000, 500_000, now);
      expect(fresh.isStale).toBe(false);
      expect(fresh.remainingMs).toBe(400_000);
      expect(fresh.staleByMs).toBe(0);

      const stale = calculateTimeToStaleMs(now - 600_000, 500_000, now);
      expect(stale.isStale).toBe(true);
      expect(stale.remainingMs).toBe(0);
      expect(stale.staleByMs).toBe(100_000);

      const resDate = calculateTimeToStaleMs(new Date(now - 50_000), 100_000, now);
      expect(resDate.isStale).toBe(false);
      expect(resDate.remainingMs).toBe(50_000);

      const resIso = calculateTimeToStaleMs(new Date(now - 200_000).toISOString(), 100_000, now);
      expect(resIso.isStale).toBe(true);
      expect(resIso.staleByMs).toBe(100_000);
    });

    it("handles invalid pulse timestamps and default parameters gracefully", () => {
      const res1 = calculateTimeToStaleMs("invalid-timestamp-value", 300_000, 1000);
      expect(res1.isStale).toBe(true);
      expect(res1.remainingMs).toBe(0);
      expect(res1.staleByMs).toBe(300_000);

      const res2 = calculateTimeToStaleMs(Date.now() - 1000);
      expect(res2.isStale).toBe(false);
      expect(res2.remainingMs).toBeGreaterThan(0);
    });
  });

  describe("checkStalePulseReclaimReadiness", () => {
    it("returns not ready when pulse_id or deadline_at is missing or invalid", () => {
      const res1 = checkStalePulseReclaimReadiness({});
      expect(res1.isReadyForReclaim).toBe(false);
      expect(res1.openPulseId).toBeNull();
      expect(res1.reason).toContain("No active pulse open");

      const res2 = checkStalePulseReclaimReadiness({ open: { pulse_id: "p1" } });
      expect(res2.isReadyForReclaim).toBe(false);

      const res3 = checkStalePulseReclaimReadiness({
        pulse_id: "p1",
        deadline_at: "not-a-valid-date",
      });
      expect(res3.isReadyForReclaim).toBe(false);
      expect(res3.openPulseId).toBe("p1");
      expect(res3.reason).toContain("Invalid deadline timestamp");
    });

    it("detects overdue pulse ready for reclaim past deadline + grace and active pulse within deadline", () => {
      const deadlineMs = 1_000_000;
      const resOverdue = checkStalePulseReclaimReadiness(
        {
          open: {
            pulse_id: "p-overdue",
            deadline_at: new Date(deadlineMs).toISOString(),
          },
        },
        { nowMs: deadlineMs + 45_000, graceMs: 10_000 },
      );
      expect(resOverdue.isReadyForReclaim).toBe(true);
      expect(resOverdue.openPulseId).toBe("p-overdue");
      expect(resOverdue.deadlinePassedByMs).toBe(45_000);
      expect(resOverdue.reason).toContain("is past deadline by 45s");

      const resActive = checkStalePulseReclaimReadiness(
        {
          pulse_id: "p-active",
          deadline_at: new Date(deadlineMs).toISOString(),
        },
        { nowMs: deadlineMs - 30_000, graceMs: 5_000 },
      );
      expect(resActive.isReadyForReclaim).toBe(false);
      expect(resActive.openPulseId).toBe("p-active");
      expect(resActive.deadlinePassedByMs).toBe(0);
      expect(resActive.reason).toContain("is within deadline");
    });
  });

  describe("createPulseHeartbeat", () => {
    it("creates standard pulse heartbeat with default and custom options", () => {
      const hbDefault = createPulseHeartbeat("pulse-init-1");
      expect(hbDefault.pulse_id).toBe("pulse-init-1");
      expect(hbDefault.outcome).toBe("active");
      expect(hbDefault.next_wake_at).toBeNull();
      expect(typeof hbDefault.at).toBe("string");

      const customTime = "2026-09-01T12:00:00.000Z";
      const wakeTime = "2026-09-01T12:15:00.000Z";
      const hbCustom = createPulseHeartbeat("pulse-custom-2", {
        outcome: "completed",
        nextWakeAt: wakeTime,
        timestamp: customTime,
      });
      expect(hbCustom.pulse_id).toBe("pulse-custom-2");
      expect(hbCustom.outcome).toBe("completed");
      expect(hbCustom.next_wake_at).toBe(wakeTime);
      expect(hbCustom.at).toBe(customTime);
      expect(hbCustom.closed_at).toBe(customTime);
    });
  });

  describe("analyzeLivenessTrends", () => {
    it("returns baseline stats for empty history", () => {
      const trends = analyzeLivenessTrends([]);
      expect(trends.totalPulses).toBe(0);
      expect(trends.healthyCount).toBe(0);
      expect(trends.staleCount).toBe(0);
      expect(trends.healthPercentage).toBe(100);
      expect(trends.meanAgeMs).toBe(0);
      expect(trends.maxAgeMs).toBe(0);
      expect(trends.consecutiveHealthyStreak).toBe(0);
      expect(trends.latestStatus).toBe("missing_record");
    });

    it("analyzes multi-pulse history tracking healthy streaks, null items and age metrics", () => {
      const now = 2_000_000;
      const history: readonly (Record<string, unknown> | null)[] = [
        { pulse_id: "p1", closed_at: new Date(now - 100_000).toISOString() },
        { pulse_id: "p2", closed_at: new Date(now - 200_000).toISOString() },
        { pulse_id: "p3", closed_at: new Date(now - 1_500_000).toISOString() },
        { pulse_id: "p4", closed_at: new Date(now - 50_000).toISOString() },
        null,
        { pulse_id: "p-future", closed_at: new Date(now + 10_000).toISOString() },
      ];

      const trends = analyzeLivenessTrends(
        history as unknown as readonly Record<string, unknown>[],
        { nowMs: now, intervalMs: 900_000, graceMs: 300_000 },
      );

      expect(trends.totalPulses).toBe(6);
      expect(trends.healthyCount).toBe(4);
      expect(trends.staleCount).toBe(1);
      expect(trends.healthPercentage).toBe(80);
      expect(trends.consecutiveHealthyStreak).toBe(2);
      expect(trends.maxAgeMs).toBe(1_500_000);
      expect(trends.meanAgeMs).toBeGreaterThan(0);
      expect(trends.latestStatus).toBe("healthy");
    });
  });
});
