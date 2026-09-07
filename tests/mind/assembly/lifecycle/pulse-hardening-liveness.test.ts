import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import {
  createPulseHeartbeat,
  evaluateMindLiveness,
} from "../../../../olt/scripts/src/mind/lifecycle/liveness/probe.ts";
import {
  getExitCodeForStatus,
  resolvePulseFilePath,
} from "../../../../olt/scripts/src/mind/lifecycle/liveness/types.ts";
import type { VirtualMemoryFS } from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  cleanupVirtualMindFS,
  scratchRoot,
  setupVirtualMindFS,
} from "../../fixtures/mind-fixture.ts";

describe("Mind Assembly Lifecycle Pulse Hardening Liveness Suite", () => {
  let testDir: string;
  let vfs: VirtualMemoryFS;

  beforeEach(() => {
    vfs = setupVirtualMindFS();
    testDir = scratchRoot("pulse-hardening");
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  describe("evaluateMindLiveness in VirtualMemoryFS", () => {
    const fixedNow = 1_700_000_000_000;

    it("returns missing_record when pulse file does not exist", () => {
      const status = evaluateMindLiveness(testDir, { nowMs: fixedNow });
      expect(status.status).toBe("missing_record");
      expect(status.healthy).toBe(false);
      expect(status.exitCode).toBe(3);
      expect(status.reason).toContain("does not exist");
    });

    it("returns corrupted_record when pulse file has invalid JSON syntax or structure", () => {
      const pulseFile = path.join(testDir, "last_pulse.json");
      vfs.writeFileSync(pulseFile, "{ malformed json: true }");

      const statusSyntax = evaluateMindLiveness(testDir, { nowMs: fixedNow });
      expect(statusSyntax.status).toBe("corrupted_record");
      expect(statusSyntax.exitCode).toBe(3);

      vfs.writeFileSync(pulseFile, JSON.stringify([1, 2, 3]));
      const statusArray = evaluateMindLiveness(testDir, { nowMs: fixedNow });
      expect(statusArray.status).toBe("corrupted_record");
      expect(statusArray.reason).toContain("not a valid JSON object");
    });

    it("evaluates healthy state for freshly written heartbeat in VirtualMemoryFS", () => {
      const pulseFile = path.join(testDir, "last_pulse.json");
      const heartbeat = createPulseHeartbeat("pulse-vfs-1", {
        timestamp: new Date(fixedNow - 5_000).toISOString(),
      });
      vfs.writeFileSync(pulseFile, JSON.stringify(heartbeat));

      const status = evaluateMindLiveness(testDir, {
        nowMs: fixedNow,
        intervalMs: 60_000,
        graceMs: 10_000,
      });

      expect(status.status).toBe("healthy");
      expect(status.healthy).toBe(true);
      expect(status.exitCode).toBe(0);
      expect(status.metrics.pulseId).toBe("pulse-vfs-1");
      expect(status.metrics.ageMs).toBe(5_000);
    });

    it("evaluates stale state when heartbeat age exceeds allowed interval plus grace", () => {
      const pulseFile = path.join(testDir, "last_pulse.json");
      const heartbeat = createPulseHeartbeat("pulse-vfs-stale", {
        timestamp: new Date(fixedNow - 100_000).toISOString(),
      });
      vfs.writeFileSync(pulseFile, JSON.stringify(heartbeat));

      const status = evaluateMindLiveness(testDir, {
        nowMs: fixedNow,
        intervalMs: 60_000,
        graceMs: 10_000,
      });

      expect(status.status).toBe("stale");
      expect(status.healthy).toBe(false);
      expect(status.exitCode).toBe(2);
      expect(status.metrics.pulseId).toBe("pulse-vfs-stale");
    });

    it("prioritizes explicit maxAllowedAgeMs override over interval + grace defaults", () => {
      const pulseFile = path.join(testDir, "last_pulse.json");
      const hb = createPulseHeartbeat("pulse-vfs-override", {
        timestamp: new Date(fixedNow - 15_000).toISOString(),
      });
      vfs.writeFileSync(pulseFile, JSON.stringify(hb));

      const status = evaluateMindLiveness(testDir, {
        nowMs: fixedNow,
        intervalMs: 60_000,
        graceMs: 10_000,
        maxAllowedAgeMs: 10_000,
      });
      expect(status.status).toBe("stale");
      expect(status.healthy).toBe(false);
      expect(status.metrics.maxAllowedAgeMs).toBe(10_000);
    });
  });

  describe("resolvePulseFilePath & getExitCodeForStatus", () => {
    it("maps status kind to canonical exit codes", () => {
      expect(getExitCodeForStatus("healthy")).toBe(0);
      expect(getExitCodeForStatus("stale")).toBe(2);
      expect(getExitCodeForStatus("missing_record")).toBe(3);
      expect(getExitCodeForStatus("corrupted_record")).toBe(3);
    });

    it("resolves pulse file path whether capsuleDir or direct json path is given", () => {
      expect(resolvePulseFilePath("/my/capsule/dir")).toBe(
        path.join("/my/capsule/dir", "last_pulse.json"),
      );
      expect(resolvePulseFilePath("/custom/path/pulse.json")).toBe("/custom/path/pulse.json");
    });
  });
});
