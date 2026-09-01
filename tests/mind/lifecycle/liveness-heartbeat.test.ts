import { describe, expect, it, spyOn, afterEach } from "bun:test";
import * as fs from "node:fs";
import {
  DEFAULT_LIVENESS_INTERVAL_MS,
  DEFAULT_LIVENESS_GRACE_MS,
  DEFAULT_LIVENESS_THRESHOLD_MS,
  EXIT_CODE_CHECK_FAILURE,
  EXIT_CODE_HEALTHY,
  EXIT_CODE_STALE,
  resolvePulseFilePath,
  getExitCodeForStatus,
  evaluateLivenessFromRecord,
} from "../../../olt/scripts/src/mind/lifecycle/liveness/types.ts";
import { formatLivenessBrief } from "../../../olt/scripts/src/mind/lifecycle/liveness/brief.ts";
import { createPulseHeartbeat } from "../../../olt/scripts/src/mind/lifecycle/liveness/probe.ts";
import type {
  LivenessStatus,
  LivenessStatusKind,
} from "../../../olt/scripts/src/mind/lifecycle/liveness/types.ts";

describe("Mind Lifecycle Liveness Heartbeat Suite", () => {
  const spies: Array<{ mockRestore: () => void }> = [];

  afterEach(() => {
    for (const spy of spies) {
      spy.mockRestore();
    }
    spies.length = 0;
  });

  describe("resolvePulseFilePath", () => {
    it("returns direct path when target is an existing file", () => {
      spies.push(spyOn(fs, "existsSync").mockReturnValue(true));
      spies.push(
        spyOn(fs, "statSync").mockReturnValue({
          isFile: () => true,
        } as unknown as fs.Stats),
      );
      const res = resolvePulseFilePath("/capsules/run-1/custom_pulse.json");
      expect(res).toBe("/capsules/run-1/custom_pulse.json");
    });

    it("falls through if statSync throws and path ends with .json", () => {
      spies.push(spyOn(fs, "existsSync").mockReturnValue(true));
      spies.push(
        spyOn(fs, "statSync").mockImplementation(() => {
          throw new Error("stat failure");
        }),
      );
      const res = resolvePulseFilePath("/capsules/run-1/last_pulse.json");
      expect(res).toBe("/capsules/run-1/last_pulse.json");
    });

    it("returns path if it ends with .json and file does not exist on disk", () => {
      spies.push(spyOn(fs, "existsSync").mockReturnValue(false));
      const res = resolvePulseFilePath("/capsules/custom_pulse.json");
      expect(res).toBe("/capsules/custom_pulse.json");
    });

    it("joins last_pulse.json when given a directory path", () => {
      spies.push(spyOn(fs, "existsSync").mockReturnValue(false));
      const res = resolvePulseFilePath("/capsules/run-1");
      expect(res).toBe("/capsules/run-1/last_pulse.json");
    });
  });

  describe("getExitCodeForStatus", () => {
    it("maps all liveness status kinds to standard CLI exit codes", () => {
      expect(getExitCodeForStatus("healthy")).toBe(EXIT_CODE_HEALTHY);
      expect(getExitCodeForStatus("stale")).toBe(EXIT_CODE_STALE);
      expect(getExitCodeForStatus("missing_record")).toBe(EXIT_CODE_CHECK_FAILURE);
      expect(getExitCodeForStatus("corrupted_record")).toBe(EXIT_CODE_CHECK_FAILURE);
    });
  });

  describe("evaluateLivenessFromRecord", () => {
    it("handles all timestamp candidate keys in precedence order", () => {
      const now = 2_000_000;
      const tClosed = new Date(now - 10_000).toISOString();
      const tAt = new Date(now - 20_000).toISOString();
      const tStarted = new Date(now - 30_000).toISOString();
      const tOpened = new Date(now - 40_000).toISOString();

      const resClosed = evaluateLivenessFromRecord({ closed_at: tClosed, at: tAt }, { nowMs: now });
      expect(resClosed.metrics.pulseTimestamp).toBe(tClosed);

      const resAt = evaluateLivenessFromRecord({ at: tAt, started_at: tStarted }, { nowMs: now });
      expect(resAt.metrics.pulseTimestamp).toBe(tAt);

      const resStarted = evaluateLivenessFromRecord(
        { started_at: tStarted, opened_at: tOpened },
        { nowMs: now },
      );
      expect(resStarted.metrics.pulseTimestamp).toBe(tStarted);

      const resOpened = evaluateLivenessFromRecord({ opened_at: tOpened }, { nowMs: now });
      expect(resOpened.metrics.pulseTimestamp).toBe(tOpened);
    });

    it("returns corrupted_record when all timestamp fields are missing or non-string", () => {
      const res = evaluateLivenessFromRecord({ pulse_id: "p1", invalid_field: 12345 });
      expect(res.status).toBe("corrupted_record");
      expect(res.healthy).toBe(false);
      expect(res.exitCode).toBe(EXIT_CODE_CHECK_FAILURE);
      expect(res.reason).toContain("contains no valid timestamp");
    });

    it("returns corrupted_record when timestamp cannot be parsed into a finite date", () => {
      const res = evaluateLivenessFromRecord({ closed_at: "unparseable-date-string" });
      expect(res.status).toBe("corrupted_record");
      expect(res.healthy).toBe(false);
      expect(res.exitCode).toBe(EXIT_CODE_CHECK_FAILURE);
      expect(res.reason).toContain("unparseable timestamp");
    });

    it("evaluates healthy status when age is within threshold with default options", () => {
      const now = Date.now();
      const res = evaluateLivenessFromRecord({
        pulse_id: "p-def-1",
        closed_at: new Date(now - 5000).toISOString(),
        outcome: "success",
        next_wake_at: new Date(now + 60_000).toISOString(),
      });
      expect(res.status).toBe("healthy");
      expect(res.healthy).toBe(true);
      expect(res.exitCode).toBe(0);
      expect(res.metrics.pulseId).toBe("p-def-1");
      expect(res.metrics.outcome).toBe("success");
      expect(res.metrics.maxAllowedAgeMs).toBe(DEFAULT_LIVENESS_THRESHOLD_MS);
    });

    it("evaluates stale status when age exceeds max allowed threshold", () => {
      const now = 2_000_000;
      const res = evaluateLivenessFromRecord(
        {
          pulse_id: "p-stale-2",
          closed_at: new Date(now - 1_500_000).toISOString(),
        },
        {
          nowMs: now,
          intervalMs: 600_000,
          graceMs: 300_000,
          maxAllowedAgeMs: 900_000,
          capsuleDir: "/custom/dir",
          pulseFile: "/custom/dir/last_pulse.json",
        },
      );
      expect(res.status).toBe("stale");
      expect(res.healthy).toBe(false);
      expect(res.exitCode).toBe(2);
      expect(res.reason).toContain("PAGING OWNER");
      expect(res.capsuleDir).toBe("/custom/dir");
      expect(res.pulseFile).toBe("/custom/dir/last_pulse.json");
    });

    it("handles non-string pulse_id, outcome, and next_wake_at gracefully", () => {
      const now = 2_000_000;
      const res = evaluateLivenessFromRecord(
        {
          pulse_id: 12345,
          outcome: true,
          next_wake_at: 67890,
          closed_at: new Date(now - 1000).toISOString(),
        },
        { nowMs: now },
      );
      expect(res.metrics.pulseId).toBeNull();
      expect(res.metrics.outcome).toBeNull();
      expect(res.metrics.nextWakeAt).toBeNull();
    });
  });

  describe("formatLivenessBrief", () => {
    it("formats healthy status brief with complete metrics and green icon", () => {
      const status: LivenessStatus = {
        status: "healthy",
        healthy: true,
        exitCode: 0,
        reason: "Heartbeat is fresh",
        capsuleDir: "/capsules/run-1",
        pulseFile: "/capsules/run-1/last_pulse.json",
        metrics: {
          pulseId: "pulse-brief-1",
          outcome: "success",
          pulseTimestamp: "2026-09-01T12:00:00.000Z",
          pulseTimeMs: 1788264000000,
          nextWakeAt: "2026-09-01T12:15:00.000Z",
          ageMs: 5000,
          maxAllowedAgeMs: 1200000,
          intervalMs: 900000,
          graceMs: 300000,
        },
      };

      const brief = formatLivenessBrief(status);
      expect(brief).toContain("🟢 HEALTHY");
      expect(brief).toContain("/capsules/run-1");
      expect(brief).toContain("pulse-brief-1");
      expect(brief).toContain("success");
      expect(brief).toContain("2026-09-01T12:00:00.000Z");
      expect(brief).toContain("2026-09-01T12:15:00.000Z");
      expect(brief).toContain("5s (threshold: 1200s)");
    });

    it("formats stale status brief with red icon", () => {
      const status: LivenessStatus = {
        status: "stale",
        healthy: false,
        exitCode: 2,
        reason: "Heartbeat is stale - PAGING OWNER",
        capsuleDir: "/capsules/run-stale",
        pulseFile: "/capsules/run-stale/last_pulse.json",
        metrics: {
          pulseId: "pulse-stale-9",
          outcome: "timeout",
          pulseTimestamp: "2026-09-01T11:00:00.000Z",
          pulseTimeMs: 1788260400000,
          nextWakeAt: null,
          ageMs: 2500000,
          maxAllowedAgeMs: 1200000,
          intervalMs: 900000,
          graceMs: 300000,
        },
      };

      const brief = formatLivenessBrief(status);
      expect(brief).toContain("🔴 STALE");
      expect(brief).toContain("PAGING OWNER");
      expect(brief).not.toContain("Next Wake At");
    });

    it("formats missing or corrupted record brief with warning icon and minimal metrics", () => {
      const status: LivenessStatus = {
        status: "corrupted_record",
        healthy: false,
        exitCode: 3,
        reason: "Invalid JSON object",
        capsuleDir: "/capsules/run-bad",
        pulseFile: "/capsules/run-bad/last_pulse.json",
        metrics: {
          pulseId: null,
          outcome: null,
          pulseTimestamp: null,
          pulseTimeMs: null,
          nextWakeAt: null,
          ageMs: null,
          maxAllowedAgeMs: 1200000,
          intervalMs: 900000,
          graceMs: 300000,
        },
      };

      const brief = formatLivenessBrief(status);
      expect(brief).toContain("⚠️ CORRUPTED_RECORD");
      expect(brief).not.toContain("Pulse ID");
      expect(brief).not.toContain("Age");
    });
  });

  describe("createPulseHeartbeat and evaluate roundtrip", () => {
    it("creates a heartbeat and immediately evaluates it as fresh and healthy", () => {
      const nowMs = Date.now();
      const heartbeat = createPulseHeartbeat("pulse-roundtrip-1", {
        outcome: "active",
        timestamp: new Date(nowMs).toISOString(),
      });
      const result = evaluateLivenessFromRecord(heartbeat, { nowMs: nowMs + 1000 });
      expect(result.status).toBe("healthy");
      expect(result.healthy).toBe(true);
      expect(result.metrics.pulseId).toBe("pulse-roundtrip-1");
    });
  });
});
