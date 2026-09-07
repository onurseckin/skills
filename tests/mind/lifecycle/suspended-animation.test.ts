import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { setupVirtualMindFS, cleanupVirtualMindFS, scratchRoot } from "../fixtures/mind-fixture.ts";
import {
  AutoWakeProber,
  archiveSnapshotFile,
  canonicalJsonStringify,
  cleanupSnapshotFile,
  computeExponentialBackoffDelay,
  computeSnapshotChecksum,
  createSuspendedAnimationEngine,
  readSnapshotFromDisk,
  resolveSuspendedStatePath,
  validateTaskDagAcyclicity,
  verifySnapshotIntegrity,
  writeSnapshotToDisk,
  type PausableTask,
  type SuspendedAnimationEngine,
  type SuspendedAnimationSnapshot,
  type SuspendedTaskNode,
} from "../../../olt/scripts/src/mind/lifecycle/suspended-animation.ts";

describe("Suspended Animation Lifecycle Suite", () => {
  let testDir: string;
  let engine: SuspendedAnimationEngine;

  beforeEach(() => {
    setupVirtualMindFS();
    testDir = scratchRoot("suspended-animation");
    engine = createSuspendedAnimationEngine();
  });

  afterEach(() => {
    engine.dispose();
    cleanupVirtualMindFS();
  });

  const createDummySnapshot = (id = "snap-1"): SuspendedAnimationSnapshot => {
    const unsigned = {
      schemaVersion: "1.0.0",
      snapshotId: id,
      suspendedAtIso: "2026-09-01T20:00:00.000Z",
      suspendedAtMs: 1756700000000,
      reason: "Resource threshold exceeded",
      governorState: "HIBERNATING" as const,
      tasksDag: [],
      frozenTimers: [],
      activeWatchdogs: ["stall-watchdog"],
      contextState: { active: true },
    };
    return { ...unsigned, checksum: computeSnapshotChecksum(unsigned) };
  };

  describe("Canonical JSON & Checksum Integrity", () => {
    it("stringifies primitives, arrays, and objects with sorted keys deterministically", () => {
      expect(canonicalJsonStringify(null)).toBe("null");
      expect(canonicalJsonStringify(123)).toBe("123");
      expect(canonicalJsonStringify("text")).toBe('"text"');
      expect(canonicalJsonStringify(true)).toBe("true");

      const unordered = { z: 1, a: 2, m: { y: "b", x: "a" } };
      expect(canonicalJsonStringify(unordered)).toBe('{"a":2,"m":{"x":"a","y":"b"},"z":1}');

      const arr = [{ b: 1, a: 2 }, [3, { d: 4, c: 5 }]];
      expect(canonicalJsonStringify(arr)).toBe('[{"a":2,"b":1},[3,{"c":5,"d":4}]]');
    });

    it("verifies valid snapshot and detects tampering", () => {
      const valid = createDummySnapshot("snap-valid");
      expect(verifySnapshotIntegrity(valid)).toBe(true);

      const tampered: SuspendedAnimationSnapshot = {
        ...valid,
        reason: "Tampered reason string",
      };
      expect(verifySnapshotIntegrity(tampered)).toBe(false);
    });
  });

  describe("Task DAG Acyclicity Validation", () => {
    const makeNode = (
      taskId: string,
      dependents: readonly string[] = [],
      dependencies: readonly string[] = [],
    ): SuspendedTaskNode => ({
      taskId,
      title: `Task ${taskId}`,
      status: "SUSPENDED",
      priority: "NORMAL",
      dependencies,
      dependents,
      suspendedAtMs: 1000,
    });

    it("handles empty DAG, linear chains, and fork-join diamond topologies", () => {
      expect(validateTaskDagAcyclicity([]).valid).toBe(true);

      const linear = [makeNode("A", ["B"]), makeNode("B", ["C"]), makeNode("C", [])];
      expect(validateTaskDagAcyclicity(linear).valid).toBe(true);

      const diamond = [
        makeNode("A", ["B", "C"]),
        makeNode("B", ["D"]),
        makeNode("C", ["D"]),
        makeNode("D", []),
      ];
      expect(validateTaskDagAcyclicity(diamond).valid).toBe(true);
    });

    it("accepts disconnected graph components", () => {
      const disconnected = [
        makeNode("A", ["B"]),
        makeNode("B", []),
        makeNode("X", ["Y"]),
        makeNode("Y", []),
      ];
      expect(validateTaskDagAcyclicity(disconnected).valid).toBe(true);
    });

    it("detects self-referential loops and multi-node circular dependencies", () => {
      const selfLoop = [makeNode("A", ["A"])];
      const selfRes = validateTaskDagAcyclicity(selfLoop);
      expect(selfRes.valid).toBe(false);
      expect(selfRes.cycle).toBeDefined();

      const circular = [makeNode("A", ["B"]), makeNode("B", ["C"]), makeNode("C", ["A"])];
      const cycleRes = validateTaskDagAcyclicity(circular);
      expect(cycleRes.valid).toBe(false);
      expect(cycleRes.cycle?.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Exponential Backoff & AutoWakeProber Synchronous Execution", () => {
    it("computes bounded backoff delays with and without jitter", () => {
      const config = {
        baseIntervalMs: 1000,
        backoffFactor: 2.0,
        maxIntervalMs: 8000,
        jitterRatio: 0,
      };
      expect(computeExponentialBackoffDelay(1, config)).toBe(1000);
      expect(computeExponentialBackoffDelay(2, config)).toBe(2000);
      expect(computeExponentialBackoffDelay(3, config)).toBe(4000);
      expect(computeExponentialBackoffDelay(4, config)).toBe(8000);
      expect(computeExponentialBackoffDelay(10, config)).toBe(8000);

      const jitterConfig = { ...config, jitterRatio: 0.1 };
      const val = computeExponentialBackoffDelay(1, jitterConfig);
      expect(val).toBeGreaterThanOrEqual(900);
      expect(val).toBeLessThanOrEqual(1100);
    });

    it("executes probeNow synchronously and transitions prober state", async () => {
      let probeCount = 0;
      let replenished = false;
      const prober = new AutoWakeProber(
        async () => {
          probeCount++;
          return probeCount >= 2;
        },
        () => {
          replenished = true;
        },
      );

      expect(prober.getActiveStatus()).toBe(true);
      const first = await prober.probeNow();
      expect(first).toBe(false);
      expect(replenished).toBe(false);
      expect(prober.getActiveStatus()).toBe(true);

      const second = await prober.probeNow();
      expect(second).toBe(true);
      expect(replenished).toBe(true);
      expect(prober.getActiveStatus()).toBe(false);

      prober.stop();
      expect(prober.getActiveStatus()).toBe(false);
    });
  });

  describe("Virtual Disk Operations & Corruption Handling", () => {
    it("resolves suspended state path correctly for dirs and files", () => {
      const direct = path.join(testDir, "custom-suspend.json");
      expect(resolveSuspendedStatePath(direct)).toBe(direct);
      expect(resolveSuspendedStatePath(testDir)).toBe(
        path.join(testDir, ".olt", "suspended-state.json"),
      );
    });

    it("writes, reads, archives, and cleans up snapshot files in VirtualMemoryFS", () => {
      const snapshot = createDummySnapshot("snap-vfs-1");
      writeSnapshotToDisk(testDir, snapshot);

      const targetPath = resolveSuspendedStatePath(testDir);
      expect(fs.existsSync(targetPath)).toBe(true);

      const loaded = readSnapshotFromDisk(testDir);
      expect(loaded).not.toBeNull();
      expect(loaded?.snapshotId).toBe("snap-vfs-1");

      const archivePath = archiveSnapshotFile(testDir);
      expect(archivePath).not.toBeNull();
      expect(fs.existsSync(archivePath!)).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(false);

      expect(cleanupSnapshotFile(archivePath!)).toBe(true);
      expect(fs.existsSync(archivePath!)).toBe(false);
    });

    it("returns null when disk snapshot is missing, malformed, or checksum corrupted", () => {
      expect(readSnapshotFromDisk(path.join(testDir, "nonexistent"))).toBeNull();

      const targetPath = resolveSuspendedStatePath(testDir);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });

      fs.writeFileSync(targetPath, "{ invalid json", "utf-8");
      expect(readSnapshotFromDisk(testDir)).toBeNull();

      const corruptedSnapshot = {
        ...createDummySnapshot("snap-corrupted"),
        checksum: "0000000000000000000000000000000000000000000000000000000000000000",
      };
      fs.writeFileSync(targetPath, JSON.stringify(corruptedSnapshot), "utf-8");
      expect(readSnapshotFromDisk(testDir)).toBeNull();
    });
  });

  describe("Engine Suspension, Checkpoint Resumption & Edge Cases", () => {
    it("returns error result gracefully when resuming without a snapshot on disk", async () => {
      const result = await engine.resumeFromSnapshot(testDir);
      expect(result.success).toBe(false);
      expect(result.restoredTaskCount).toBe(0);
      expect(result.message).toContain("No valid suspended snapshot found on disk.");
    });

    it("pauses tasks, saves timers and socratic memory, restores them on resume", async () => {
      let pauseInvoked = false;
      let restoredCheckpoint: Readonly<Record<string, unknown>> | undefined;

      const task: PausableTask = {
        taskId: "task-alpha",
        title: "Alpha Worker",
        status: "RUNNING",
        priority: "HIGH",
        getCheckpointData: () => ({ cursor: 128, partition: 3 }),
        onPause: () => {
          pauseInvoked = true;
        },
        onResume: (checkpoint) => {
          restoredCheckpoint = checkpoint;
        },
      };

      engine.registerPausableTask(task);
      engine.registerTimer({ id: "timer-alpha", durationMs: 10_000, startedAtMs: 1_000_000 });
      engine.registerWatchdog("liveness-watchdog");
      engine.setSocraticMemory({ hypothesis: "empirically-proven" });
      engine.setContextState({ userSession: "active" });

      const snapshot = await engine.initiateSuspension({
        reason: "Resource quota exceeded",
        repoRoot: testDir,
      });

      expect(pauseInvoked).toBe(true);
      expect(engine.getIsSuspended()).toBe(true);
      expect(snapshot.tasksDag.length).toBe(1);
      expect(snapshot.frozenTimers.length).toBe(1);
      expect(snapshot.socraticMemory).toEqual({ hypothesis: "empirically-proven" });

      const resumeResult = await engine.resumeFromSnapshot(testDir, {
        deleteSnapshotOnSuccess: true,
      });

      expect(resumeResult.success).toBe(true);
      expect(resumeResult.restoredTaskCount).toBe(1);
      expect(resumeResult.restoredTimerCount).toBe(1);
      expect(resumeResult.socraticMemoryRestored).toBe(true);
      expect(resumeResult.verification.checksumValid).toBe(true);
      expect(resumeResult.verification.dagAcyclic).toBe(true);
      expect(restoredCheckpoint).toEqual({ cursor: 128, partition: 3 });
      expect(engine.getIsSuspended()).toBe(false);
    });
  });
});
