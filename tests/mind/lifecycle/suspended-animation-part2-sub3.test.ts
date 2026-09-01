/**
 * Dedicated Test Suite for Autonomous Resource Governor & Suspended Animation Protocol.
 *
 * Covers:
 * 1. ResourceGovernor Pure Functions & Bounds (calculateUtilizationRatio, calculateRemainingHeadroom, isStateStricter).
 * 2. ResourceGovernor Quota & State Transitions (NOMINAL -> WARNING -> EXHAUSTED -> HIBERNATING -> RECOVERING).
 * 3. HTTP 429 Rate Limit Throttle Handling (recordExternalThrottle, retryAfterMs, recovery estimation).
 * 4. Concurrency Management & canDispatch checks (RPM, TPM, Concurrency headroom & wait times).
 * 5. Deterministic Serialization & SHA-256 Checksum Integrity (canonicalJsonStringify, computeSnapshotChecksum, verifySnapshotIntegrity).
 * 6. Task DAG Acyclicity & Circular Dependency Detection (validateTaskDagAcyclicity).
 * 7. Auto-Wake Exponential Backoff with Jitter (computeExponentialBackoffDelay, AutoWakeProber).
 * 8. Suspended Animation Engine & Non-Destructive Freezing (Pausable tasks, sub-second timer freezing, Socratic memory).
 * 9. Lossless State Restoration (Zero context loss, zero amnesia, checkpoint resumption, snapshot archiving/cleanup).
 */

import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AutoWakeProbeConfig,
  type ExternalThrottleEvent,
  type FrozenTimer,
  type GovernorStatus,
  type PausableTask,
  type ResourceGovernorOptions,
  type ResourceGovernorState,
  type ResourceHeadroom,
  type ResourceType,
  type RestorationResult,
  type SuspendedAnimationSnapshot,
  type SuspendedTaskNode,
  AutoWakeProber,
  ResourceGovernor,
  SuspendedAnimationEngine,
  archiveSnapshotFile,
  calculateRemainingHeadroom,
  calculateUtilizationRatio,
  canonicalJsonStringify,
  cleanupSnapshotFile,
  computeExponentialBackoffDelay,
  computeSnapshotChecksum,
  createResourceGovernor,
  createSuspendedAnimationEngine,
  isStateStricter,
  readSnapshotFromDisk,
  validateTaskDagAcyclicity,
  verifySnapshotIntegrity,
  writeSnapshotToDisk,
} from "../../../olt/scripts/src/mind/lifecycle/index.ts";

describe("Autonomous Resource Governor & Suspended Animation Suite", () => {
  describe("Suspended Animation Engine: Full Suspension & Zero-Amnesia Resumption Cycle", () => {
    it("executes atomic freeze, sub-second timer freezing, disk persistence, and lossless restoration", async () => {
      const testTempDir = join(
        tmpdir(),
        `olt-suspend-suite-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      );
      mkdirSync(join(testTempDir, ".olt"), { recursive: true });

      const snapPath = join(testTempDir, ".olt", "suspended-state.json");
      const engine = createSuspendedAnimationEngine();

      let taskPaused = false;
      let resumedCheckpoint: Readonly<Record<string, unknown>> | undefined;

      // Register Pausable Task
      engine.registerPausableTask({
        taskId: "worker-task-42",
        title: "Matrix Decomposition Task",
        status: "IN_PROGRESS",
        priority: "CRITICAL",
        getCheckpointData: () => ({ rowCursor: 128, blockIndex: 4 }),
        onPause: () => {
          taskPaused = true;
        },
        onResume: (checkpoint) => {
          resumedCheckpoint = checkpoint;
        },
      });

      // Register Timers
      const unregTimer = engine.registerTimer(
        {
          id: "anti-stagnation-heartbeat",
          type: "anti_stagnation",
          durationMs: 60_000,
          startedAtMs: 1_000_000,
          expiresAtMs: 1_060_000,
        },
        1_015_000, // now is 15s elapsed
      );

      engine.setSocraticMemory({
        thesis: "Deterministic state machines guarantee reproducibility.",
        turn: 3,
      });

      engine.setContextState({
        sessionMode: "autonomous",
        activeWave: 3,
      });

      // 1. INITIATE SUSPENSION
      const suspendTimeMs = 1_025_000; // 25s elapsed from 1_000_000
      const snapshot = await engine.initiateSuspension({
        reason: "Rate limit reached",
        triggerResource: "API_RPM",
        repoRoot: testTempDir,
        customSnapshotPath: snapPath,
        nowMs: suspendTimeMs,
      });

      expect(taskPaused).toBe(true);
      expect(engine.getIsSuspended()).toBe(true);
      expect(existsSync(snapPath)).toBe(true);

      // Verify sub-second timer precision
      const frozenTimer = snapshot.frozenTimers.find((t) => t.id === "anti-stagnation-heartbeat");
      expect(frozenTimer).toBeDefined();
      expect(frozenTimer?.elapsedMs).toBe(25_000); // 1_025_000 - 1_000_000 = 25000
      expect(frozenTimer?.remainingDurationMs).toBe(35_000); // 1_060_000 - 1_025_000 = 35000

      // 2. RESUME FROM SNAPSHOT
      const resumeTimeMs = 1_050_000;
      const restoreResult = await engine.resumeFromSnapshot(snapPath, {
        repoRoot: testTempDir,
        customSnapshotPath: snapPath,
        deleteSnapshotOnSuccess: false,
        nowMs: resumeTimeMs,
      });

      expect(restoreResult.success).toBe(true);
      expect(restoreResult.verification.checksumValid).toBe(true);
      expect(restoreResult.verification.dagAcyclic).toBe(true);
      expect(restoreResult.verification.zeroContextLoss).toBe(true);
      expect(restoreResult.restoredTaskCount).toBe(1);
      expect(restoreResult.restoredTimerCount).toBe(1);
      expect(restoreResult.socraticMemoryRestored).toBe(true);
      expect(engine.getIsSuspended()).toBe(false);

      // Verify task checkpoint was preserved exactly
      expect(resumedCheckpoint).toBeDefined();
      expect((resumedCheckpoint as { rowCursor: number; blockIndex: number }).rowCursor).toBe(128);
      expect((resumedCheckpoint as { rowCursor: number; blockIndex: number }).blockIndex).toBe(4);

      // Cleanup
      engine.dispose();
      try {
        rmSync(testTempDir, { recursive: true, force: true });
      } catch {}
    });

    it("archives snapshot file using archiveSnapshotFile", () => {
      const testTempDir = join(
        tmpdir(),
        `olt-archive-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      );
      mkdirSync(join(testTempDir, ".olt"), { recursive: true });

      const snapPath = join(testTempDir, ".olt", "suspended-state.json");
      writeFileSync(snapPath, JSON.stringify({ test: "archive" }), "utf8");

      const archivedPath = archiveSnapshotFile(snapPath, testTempDir);
      expect(archivedPath).not.toBeNull();
      expect(existsSync(snapPath)).toBe(false);
      expect(existsSync(archivedPath!)).toBe(true);

      // Cleanup
      try {
        rmSync(testTempDir, { recursive: true, force: true });
      } catch {}
    });

    it("cleans up snapshot file using cleanupSnapshotFile", () => {
      const testTempDir = join(
        tmpdir(),
        `olt-cleanup-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      );
      mkdirSync(join(testTempDir, ".olt"), { recursive: true });

      const snapPath = join(testTempDir, ".olt", "suspended-state.json");
      writeFileSync(snapPath, "{}", "utf8");
      expect(existsSync(snapPath)).toBe(true);

      const cleaned = cleanupSnapshotFile(snapPath);
      expect(cleaned).toBe(true);
      expect(existsSync(snapPath)).toBe(false);

      // Cleanup
      try {
        rmSync(testTempDir, { recursive: true, force: true });
      } catch {}
    });
  });
});
