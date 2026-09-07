import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  loadDagSnapshot,
  parseSnapshot,
  persistDagSnapshot,
  withSnapshotLock,
  type QuotaDagSnapshot,
} from "../../../../olt/scripts/src/telemetry/snapshot/index.ts";
import * as evaluatorModule from "../../../../olt/scripts/src/mind/pulsing/evaluator.ts";
import * as snapshotModule from "../../../../olt/scripts/src/telemetry/snapshot/index.ts";
import { managePulseSupervisoryCadence } from "../../../../olt/scripts/src/mind/pulsing/cadence.ts";
import type {
  PulseQuotaEvaluation,
  PulseSupervisoryCadenceOptions,
} from "../../../../olt/scripts/src/mind/pulsing/types.ts";
import {
  cleanupVirtualMindFS,
  scratchRoot,
  setupVirtualMindFS,
} from "../../fixtures/mind-fixture.ts";

function createFrozenSnapshot(repoRoot: string): QuotaDagSnapshot {
  return {
    version: "2",
    repositoryRoot: repoRoot,
    runRoot: repoRoot,
    frozenAt: "2026-09-01T12:00:00.000Z",
    status: "frozen",
    tasks: [],
    agents: [],
    cronsSuspended: [],
    uncommittedFiles: [],
    lowestQuotaObserved: 5,
    constrainedModels: ["gpt-4"],
    autoWakeSchedule: {
      resetTime: "2026-09-01T12:05:00.000Z",
      resumeTime: "2026-09-01T12:05:30.000Z",
    },
  };
}

describe("Mind Assembly Pulse Freeze Snapshot Suite", () => {
  let testDir: string;
  const spies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    setupVirtualMindFS();
    testDir = scratchRoot("freeze-snapshot");
    fs.mkdirSync(path.join(testDir, ".olt"), { recursive: true });
    fs.mkdirSync(path.join(testDir, ".git"), { recursive: true });
  });

  afterEach(() => {
    for (const s of spies) s.mockRestore();
    spies.length = 0;
    cleanupVirtualMindFS();
  });

  describe("Snapshot Persistence and Loading", () => {
    it("persists snapshot and loads it cleanly in VirtualMemoryFS", () => {
      const snap = createFrozenSnapshot(testDir);
      const savedPath = persistDagSnapshot(snap);
      expect(typeof savedPath).toBe("string");
      expect(savedPath).toContain("quota-dag-snapshot.json");

      const loaded = loadDagSnapshot(testDir);
      expect(loaded).toBeDefined();
      expect(loaded?.status).toBe("frozen");
      expect(loaded?.version).toBe("2");
      expect(loaded?.lowestQuotaObserved).toBe(5);
      expect(loaded?.constrainedModels).toEqual(["gpt-4"]);
      expect(loaded?.autoWakeSchedule.resetTime).toBe("2026-09-01T12:05:00.000Z");
    });

    it("returns undefined when loading non-existent snapshot", () => {
      const emptyDir = path.join(testDir, "sub-empty");
      fs.mkdirSync(emptyDir, { recursive: true });
      expect(loadDagSnapshot(emptyDir)).toBeUndefined();
    });

    it("throws HarnessError on loading malformed snapshot file from disk", () => {
      const snapPath = path.join(testDir, ".olt", "quota-dag-snapshot.json");
      fs.writeFileSync(snapPath, "{ corrupted snapshot file content", "utf8");
      expect(() => loadDagSnapshot(testDir)).toThrow(HarnessError);
    });
  });

  describe("Snapshot Serialization and Parse Integrity", () => {
    it("parses valid JSON representation of QuotaDagSnapshot", () => {
      const snap = createFrozenSnapshot(testDir);
      const raw = JSON.stringify(snap);
      const parsed = parseSnapshot(raw);
      expect(parsed.version).toBe("2");
      expect(parsed.status).toBe("frozen");
      expect(parsed.lowestQuotaObserved).toBe(5);
    });

    it("throws HarnessError on invalid JSON syntax", () => {
      expect(() => parseSnapshot("{ invalid-json")).toThrow(HarnessError);
    });

    it("throws HarnessError when mandatory fields like repositoryRoot or frozenAt are missing or empty", () => {
      const snap = createFrozenSnapshot(testDir);
      const missingRepo = JSON.stringify({ ...snap, repositoryRoot: "" });
      expect(() => parseSnapshot(missingRepo)).toThrow(HarnessError);

      const missingFrozen = JSON.stringify({ ...snap, frozenAt: "not-a-timestamp" });
      expect(() => parseSnapshot(missingFrozen)).toThrow(HarnessError);
    });

    it("throws HarnessError on unsupported version or invalid status", () => {
      const snap = createFrozenSnapshot(testDir);
      const badVersion = JSON.stringify({ ...snap, version: "99" });
      expect(() => parseSnapshot(badVersion)).toThrow(HarnessError);

      const badStatus = JSON.stringify({ ...snap, status: "corrupted_status" });
      expect(() => parseSnapshot(badStatus)).toThrow(HarnessError);
    });

    it("throws HarnessError on malformed autoWakeSchedule or non-array fields", () => {
      const snap = createFrozenSnapshot(testDir);
      const badWake = JSON.stringify({ ...snap, autoWakeSchedule: "not-an-object" });
      expect(() => parseSnapshot(badWake)).toThrow(HarnessError);

      const badTasks = JSON.stringify({ ...snap, tasks: "not-an-array" });
      expect(() => parseSnapshot(badTasks)).toThrow(HarnessError);
    });
  });

  describe("Snapshot Lock Concurrency", () => {
    it("executes critical blocks within withSnapshotLock in VirtualMemoryFS", () => {
      const result = withSnapshotLock(testDir, (snapshotPath) => {
        expect(typeof snapshotPath).toBe("string");
        expect(snapshotPath).toContain("quota-dag-snapshot.json");
        return "lock-executed";
      });
      expect(result).toBe("lock-executed");
    });
  });

  describe("Supervisory Cadence Freeze Snapshot Integration", () => {
    const baseEval: PulseQuotaEvaluation = {
      activeHost: "host-1",
      status: "critical",
      isCircuitBreakerTripped: true,
      lowestRemainingQuota: 5,
      thresholdPercentage: 20,
      constrainedModels: ["model-freeze"],
      metrics: [],
      checkedAt: "2026-09-01T12:00:00.000Z",
      warningMessages: [],
      autoWakeSchedule: {
        durationSeconds: 120,
        targetWakeupIso: "2026-09-01T12:02:00.000Z",
        reason: "quota_reset",
      },
    };

    it("captures and persists DAG snapshot during freeze cadence", async () => {
      spies.push(spyOn(evaluatorModule, "evaluateMindPulseQuota").mockResolvedValue(baseEval));
      spies.push(spyOn(evaluatorModule, "checkPulseQuotaFreeze").mockReturnValue(true));
      spies.push(
        spyOn(snapshotModule, "persistDagSnapshot").mockReturnValue(
          path.join(testDir, "mock-snapshot.json"),
        ),
      );

      const opts: PulseSupervisoryCadenceOptions = {
        runRoot: testDir,
        repoRoot: testDir,
        actor: "pulsar",
        host: "host-1",
        baseIntervalMs: 30000,
        thresholdPercentage: 20,
        captureSnapshotOnFreeze: true,
      };

      const result = await managePulseSupervisoryCadence(opts);
      expect(result.shouldFreeze).toBe(true);
      expect(result.snapshotCaptured).toBe(true);
      expect(result.snapshotPath).toBe(path.join(testDir, "mock-snapshot.json"));
      expect(result.wrapUpDirectives.length).toBeGreaterThan(0);
    });

    it("omits snapshot capture when captureSnapshotOnFreeze is false", async () => {
      spies.push(spyOn(evaluatorModule, "evaluateMindPulseQuota").mockResolvedValue(baseEval));
      spies.push(spyOn(evaluatorModule, "checkPulseQuotaFreeze").mockReturnValue(true));

      const opts: PulseSupervisoryCadenceOptions = {
        runRoot: testDir,
        repoRoot: testDir,
        actor: "pulsar",
        host: "host-1",
        baseIntervalMs: 30000,
        thresholdPercentage: 20,
        captureSnapshotOnFreeze: false,
      };

      const result = await managePulseSupervisoryCadence(opts);
      expect(result.shouldFreeze).toBe(true);
      expect(result.snapshotCaptured).toBe(false);
      expect(result.snapshotPath).toBeUndefined();
    });

    it("gracefully falls back when snapshot capture throws error", async () => {
      spies.push(spyOn(evaluatorModule, "evaluateMindPulseQuota").mockResolvedValue(baseEval));
      spies.push(spyOn(evaluatorModule, "checkPulseQuotaFreeze").mockReturnValue(true));
      spies.push(
        spyOn(snapshotModule, "captureDagSnapshot").mockRejectedValue(new Error("disk error")),
      );

      const opts: PulseSupervisoryCadenceOptions = {
        runRoot: testDir,
        repoRoot: testDir,
        actor: "pulsar",
        host: "host-1",
        baseIntervalMs: 30000,
        thresholdPercentage: 20,
      };

      const result = await managePulseSupervisoryCadence(opts);
      expect(result.shouldFreeze).toBe(true);
      expect(result.snapshotCaptured).toBe(false);
      expect(result.snapshotPath).toBeUndefined();
    });
  });
});
