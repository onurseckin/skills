import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSuspendedAnimationEngine,
  type PausableTask,
  type SuspendedAnimationEngine,
} from "../../../../olt/scripts/src/mind/lifecycle/suspended-animation.ts";

describe("Suspended Animation Engine Lifecycle Suite", () => {
  let tempDir: string;
  let engine: SuspendedAnimationEngine;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `suspend-engine-cov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(tempDir, { recursive: true });
    engine = createSuspendedAnimationEngine();
  });

  afterEach(() => {
    engine.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Task & Timer Registration and Freezing", () => {
    it("suspends pausable tasks, calls onPause, freezes timers, and records watchdogs", async () => {
      let pauseCalled = false;
      let resumeCheckpoint: Readonly<Record<string, unknown>> | undefined;

      const task: PausableTask = {
        taskId: "task-test-01",
        title: "Test Task",
        status: "RUNNING",
        priority: "HIGH",
        onPause: () => {
          pauseCalled = true;
        },
        getCheckpointData: () => ({ offset: 42 }),
        onResume: (checkpoint) => {
          resumeCheckpoint = checkpoint;
        },
      };

      engine.registerPausableTask(task);
      engine.registerWatchdog("health-watchdog");

      const unregisterTimer = engine.registerTimer({
        id: "timer-unreg",
        durationMs: 5000,
      });
      unregisterTimer(); // removed immediately

      engine.registerTimer({
        id: "timer-active",
        durationMs: 10_000,
        startedAtMs: 1_000_000,
        expiresAtMs: 1_010_000,
      });

      engine.setContextState({ loopCount: 3 });
      engine.setSocraticMemory({ hypothesis: "active" });

      const now = 1_004_000;
      const snapshot = await engine.initiateSuspension({
        reason: "Resource threshold warning",
        repoRoot: tempDir,
        nowMs: now,
      });

      expect(pauseCalled).toBe(true);
      expect(engine.getIsSuspended()).toBe(true);
      expect(snapshot.tasksDag.length).toBe(1);
      expect(snapshot.tasksDag[0]?.taskId).toBe("task-test-01");
      expect(snapshot.tasksDag[0]?.checkpointData).toEqual({ offset: 42 });

      // Check frozen timers
      expect(snapshot.frozenTimers.length).toBe(1);
      expect(snapshot.frozenTimers[0]?.id).toBe("timer-active");
      expect(snapshot.frozenTimers[0]?.elapsedMs).toBe(4000);
      expect(snapshot.frozenTimers[0]?.remainingDurationMs).toBe(6000);

      expect(snapshot.activeWatchdogs).toContain("health-watchdog");
      expect(snapshot.contextState).toEqual({ loopCount: 3 });
      expect(snapshot.socraticMemory).toEqual({ hypothesis: "active" });

      // Resume from disk snapshot
      const restoreResult = await engine.resumeFromSnapshot(tempDir);
      expect(restoreResult.success).toBe(true);
      expect(restoreResult.restoredTaskCount).toBe(1);
      expect(restoreResult.restoredTimerCount).toBe(1);
      expect(restoreResult.socraticMemoryRestored).toBe(true);
      expect(restoreResult.verification.checksumValid).toBe(true);
      expect(restoreResult.verification.dagAcyclic).toBe(true);
      expect(resumeCheckpoint).toEqual({ offset: 42 });
      expect(engine.getIsSuspended()).toBe(false);
    });

    it("supports deleteSnapshotOnSuccess: false option during resumption", async () => {
      const snapshotPath = join(tempDir, "preserved-snapshot.json");
      await engine.initiateSuspension({
        reason: "Test preservation",
        customSnapshotPath: snapshotPath,
      });

      expect(existsSync(snapshotPath)).toBe(true);

      const res = await engine.resumeFromSnapshot(snapshotPath, {
        deleteSnapshotOnSuccess: false,
      });

      expect(res.success).toBe(true);
      expect(existsSync(snapshotPath)).toBe(true); // preserved on disk
    });

    it("returns failure RestorationResult when no snapshot is found on disk", async () => {
      const res = await engine.resumeFromSnapshot(join(tempDir, "missing-snapshot.json"));
      expect(res.success).toBe(false);
      expect(res.restoredTaskCount).toBe(0);
      expect(res.message).toContain("No valid suspended snapshot found");
    });

    it("clears state and resets flags on dispose()", () => {
      engine.registerWatchdog("dog-1");
      engine.setContextState({ a: 1 });
      engine.dispose();
      expect(engine.getIsSuspended()).toBe(false);
    });
  });
});
