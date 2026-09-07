import { describe, expect, it } from "bun:test";
import {
  analyzeLivenessTrends,
  calculateTimeToStaleMs,
  checkStalePulseReclaimReadiness,
  createPulseHeartbeat,
} from "../../../../olt/scripts/src/mind/lifecycle/liveness/probe.ts";

describe("Mind Assembly Lifecycle Pulse Hardening Suite", () => {
  describe("checkStalePulseReclaimReadiness", () => {
    const fixedNow = 1_700_000_000_000;

    it("returns not ready when pulse record has no active open pulse or deadline", () => {
      const resultEmpty = checkStalePulseReclaimReadiness({}, { nowMs: fixedNow });
      expect(resultEmpty.isReadyForReclaim).toBe(false);
      expect(resultEmpty.openPulseId).toBeNull();
      expect(resultEmpty.reason).toContain("No active pulse");

      const resultMissingDeadline = checkStalePulseReclaimReadiness(
        { open: { pulse_id: "pulse-1" } },
        { nowMs: fixedNow },
      );
      expect(resultMissingDeadline.isReadyForReclaim).toBe(false);
      expect(resultMissingDeadline.openPulseId).toBeNull();
    });

    it("returns not ready with error reason on invalid deadline timestamp", () => {
      const record = {
        open: {
          pulse_id: "pulse-bad-date",
          deadline_at: "not-a-timestamp",
        },
      };
      const result = checkStalePulseReclaimReadiness(record, { nowMs: fixedNow });
      expect(result.isReadyForReclaim).toBe(false);
      expect(result.reason).toContain("Invalid deadline");
      expect(result.openPulseId).toBe("pulse-bad-date");
    });

    it("evaluates pulse within deadline and grace as not ready for reclaim", () => {
      const deadlineMs = fixedNow + 30_000;
      const record = {
        open: { pulse_id: "pulse-active-1", deadline_at: new Date(deadlineMs).toISOString() },
      };
      const result = checkStalePulseReclaimReadiness(record, { nowMs: fixedNow, graceMs: 5_000 });
      expect(result.isReadyForReclaim).toBe(false);
      expect(result.deadlinePassedByMs).toBe(0);
      expect(result.reason).toContain("within deadline");
    });

    it("evaluates pulse exactly at deadline boundary (nowMs === effectiveDeadlineMs) as not ready", () => {
      const deadlineMs = fixedNow;
      const record = {
        open: { pulse_id: "pulse-bound", deadline_at: new Date(deadlineMs).toISOString() },
      };
      const result = checkStalePulseReclaimReadiness(record, {
        nowMs: fixedNow + 5_000,
        graceMs: 5_000,
      });
      expect(result.isReadyForReclaim).toBe(false);
      expect(result.deadlinePassedByMs).toBe(0);
    });

    it("flags pulse past deadline + grace as ready for reclaim with overdue duration", () => {
      const deadlineMs = fixedNow - 20_000;
      const record = {
        open: { pulse_id: "pulse-stale-99", deadline_at: new Date(deadlineMs).toISOString() },
      };
      const result = checkStalePulseReclaimReadiness(record, { nowMs: fixedNow, graceMs: 5_000 });
      expect(result.isReadyForReclaim).toBe(true);
      expect(result.deadlinePassedByMs).toBe(20_000);
      expect(result.openPulseId).toBe("pulse-stale-99");
      expect(result.reason).toContain("past deadline by 20s");
    });

    it("correctly handles flat pulse record objects without open wrapper", () => {
      const deadlineMs = fixedNow - 10_000;
      const flatRecord = {
        pulse_id: "pulse-flat",
        deadline_at: new Date(deadlineMs).toISOString(),
      };
      const result = checkStalePulseReclaimReadiness(flatRecord, { nowMs: fixedNow, graceMs: 0 });
      expect(result.isReadyForReclaim).toBe(true);
      expect(result.openPulseId).toBe("pulse-flat");
    });
  });

  describe("calculateTimeToStaleMs & createPulseHeartbeat", () => {
    const fixedNow = 1_700_000_000_000;
    const thresholdMs = 60_000;

    it("computes remaining milliseconds for fresh pulse timestamp", () => {
      const result = calculateTimeToStaleMs(fixedNow - 10_000, thresholdMs, fixedNow);
      expect(result.isStale).toBe(false);
      expect(result.remainingMs).toBe(50_000);
      expect(result.staleByMs).toBe(0);
    });

    it("detects stale status when pulse timestamp exceeds threshold", () => {
      const result = calculateTimeToStaleMs(fixedNow - 80_000, thresholdMs, fixedNow);
      expect(result.isStale).toBe(true);
      expect(result.remainingMs).toBe(0);
      expect(result.staleByMs).toBe(20_000);
    });

    it("handles invalid timestamps gracefully by marking stale", () => {
      const result = calculateTimeToStaleMs("invalid-timestamp", thresholdMs, fixedNow);
      expect(result.isStale).toBe(true);
      expect(result.remainingMs).toBe(0);
      expect(result.staleByMs).toBe(thresholdMs);
    });

    it("creates standard pulse heartbeat records with custom and default parameters", () => {
      const hbDefault = createPulseHeartbeat("pulse-hb-1");
      expect(hbDefault.pulse_id).toBe("pulse-hb-1");
      expect(hbDefault.outcome).toBe("active");
      expect(hbDefault.next_wake_at).toBeNull();
      expect(hbDefault.at).toBeDefined();

      const hbCustom = createPulseHeartbeat("pulse-hb-2", {
        outcome: "completed",
        nextWakeAt: "2026-09-01T12:00:00.000Z",
        timestamp: "2026-09-01T11:59:00.000Z",
      });
      expect(hbCustom.outcome).toBe("completed");
      expect(hbCustom.next_wake_at).toBe("2026-09-01T12:00:00.000Z");
      expect(hbCustom.at).toBe("2026-09-01T11:59:00.000Z");
    });
  });

  describe("analyzeLivenessTrends", () => {
    const fixedNow = 1_700_000_000_000;

    it("returns baseline stats when pulse history is empty", () => {
      const summary = analyzeLivenessTrends([], { nowMs: fixedNow });
      expect(summary.totalPulses).toBe(0);
      expect(summary.healthyCount).toBe(0);
      expect(summary.staleCount).toBe(0);
      expect(summary.healthPercentage).toBe(100);
      expect(summary.consecutiveHealthyStreak).toBe(0);
      expect(summary.latestStatus).toBe("missing_record");
    });

    it("calculates trend statistics, streak, and percentage over multi-pulse history", () => {
      const history = [
        { pulse_id: "p1", at: new Date(fixedNow - 30_000).toISOString() },
        { pulse_id: "p2", at: new Date(fixedNow - 20_000).toISOString() },
        { pulse_id: "p3", at: new Date(fixedNow - 2_000_000).toISOString() },
        { pulse_id: "p4", at: new Date(fixedNow - 5_000).toISOString() },
      ];

      const summary = analyzeLivenessTrends(history, {
        nowMs: fixedNow,
        intervalMs: 60_000,
        graceMs: 10_000,
      });

      expect(summary.totalPulses).toBe(4);
      expect(summary.healthyCount).toBe(3);
      expect(summary.staleCount).toBe(1);
      expect(summary.healthPercentage).toBe(75);
      expect(summary.consecutiveHealthyStreak).toBe(2);
      expect(summary.latestStatus).toBe("healthy");
      expect(summary.maxAgeMs).toBeGreaterThan(0);
    });

    it("handles all-stale history correctly with 0 streak and 0 percentage", () => {
      const history = [
        { pulse_id: "p-stale-1", at: new Date(fixedNow - 500_000).toISOString() },
        { pulse_id: "p-stale-2", at: new Date(fixedNow - 600_000).toISOString() },
      ];
      const summary = analyzeLivenessTrends(history, {
        nowMs: fixedNow,
        intervalMs: 60_000,
        graceMs: 10_000,
      });
      expect(summary.totalPulses).toBe(2);
      expect(summary.healthyCount).toBe(0);
      expect(summary.staleCount).toBe(2);
      expect(summary.healthPercentage).toBe(0);
      expect(summary.consecutiveHealthyStreak).toBe(0);
      expect(summary.latestStatus).toBe("stale");
    });
  });
});
