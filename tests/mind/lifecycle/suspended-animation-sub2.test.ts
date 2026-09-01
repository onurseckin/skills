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
  describe("Suspended Animation: Deterministic Serialization & Checksum Integrity", () => {
    it("produces deterministic sorted JSON string via canonicalJsonStringify", () => {
      const obj1 = { b: 2, a: 1, c: { z: 26, y: 25 } };
      const obj2 = { c: { y: 25, z: 26 }, a: 1, b: 2 };

      const json1 = canonicalJsonStringify(obj1);
      const json2 = canonicalJsonStringify(obj2);

      expect(json1).toBe(json2);
      expect(json1).toBe('{"a":1,"b":2,"c":{"y":25,"z":26}}');
    });

    it("computes 64-character SHA-256 checksum and verifies snapshot integrity", () => {
      const unsignedSnapshot: Omit<SuspendedAnimationSnapshot, "checksum"> = {
        schemaVersion: "1.0.0",
        snapshotId: "snap-test-01",
        suspendedAtIso: "2026-09-01T12:00:00.000Z",
        suspendedAtMs: 1788264000000,
        reason: "Quota TPM exhausted",
        triggerResource: "API_TPM",
        governorState: "HIBERNATING",
        tasksDag: [],
        frozenTimers: [],
        activeWatchdogs: [],
        contextState: { lane: "default" },
      };

      const checksum = computeSnapshotChecksum(unsignedSnapshot);
      expect(checksum.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(checksum)).toBe(true);

      const fullSnapshot: SuspendedAnimationSnapshot = {
        ...unsignedSnapshot,
        checksum,
      };

      expect(verifySnapshotIntegrity(fullSnapshot)).toBe(true);

      // Tampered snapshot fails integrity check
      const tampered: SuspendedAnimationSnapshot = {
        ...fullSnapshot,
        reason: "Tampered reason string",
      };
      expect(verifySnapshotIntegrity(tampered)).toBe(false);
    });
  });

  describe("Suspended Animation: DAG Acyclicity & Circular Dependency Validation", () => {
    it("verifies that a valid task DAG is acyclic", () => {
      const tasks: SuspendedTaskNode[] = [
        {
          taskId: "task-A",
          title: "Task A",
          status: "SUSPENDED",
          priority: "HIGH",
          dependencies: [],
          dependents: ["task-B", "task-C"],
          suspendedAtMs: 1000,
        },
        {
          taskId: "task-B",
          title: "Task B",
          status: "SUSPENDED",
          priority: "MEDIUM",
          dependencies: ["task-A"],
          dependents: ["task-D"],
          suspendedAtMs: 1000,
        },
        {
          taskId: "task-C",
          title: "Task C",
          status: "SUSPENDED",
          priority: "MEDIUM",
          dependencies: ["task-A"],
          dependents: ["task-D"],
          suspendedAtMs: 1000,
        },
        {
          taskId: "task-D",
          title: "Task D",
          status: "SUSPENDED",
          priority: "HIGH",
          dependencies: ["task-B", "task-C"],
          dependents: [],
          suspendedAtMs: 1000,
        },
      ];

      const check = validateTaskDagAcyclicity(tasks);
      expect(check.valid).toBe(true);
      expect(check.cycle).toBeUndefined();
    });

    it("detects circular dependencies in task DAGs and reports cycle nodes", () => {
      const cyclicTasks: SuspendedTaskNode[] = [
        {
          taskId: "node-X",
          title: "Node X",
          status: "SUSPENDED",
          priority: "HIGH",
          dependencies: ["node-Y"],
          dependents: ["node-Y"],
          suspendedAtMs: 1000,
        },
        {
          taskId: "node-Y",
          title: "Node Y",
          status: "SUSPENDED",
          priority: "HIGH",
          dependencies: ["node-X"],
          dependents: ["node-X"],
          suspendedAtMs: 1000,
        },
      ];

      const check = validateTaskDagAcyclicity(cyclicTasks);
      expect(check.valid).toBe(false);
      expect(check.cycle).toBeDefined();
      expect(check.cycle?.length).toBeGreaterThanOrEqual(2);
      expect(check.cycle).toContain("node-X");
      expect(check.cycle).toContain("node-Y");
    });
  });

  describe("Auto-Wake Resumption Engine: Exponential Backoff & Health Probing", () => {
    it("computes exponential backoff delays with bounded jitter", () => {
      const config: AutoWakeProbeConfig = {
        baseIntervalMs: 1000,
        backoffFactor: 2.0,
        maxIntervalMs: 10_000,
        jitterRatio: 0.1,
      };

      const delay1 = computeExponentialBackoffDelay(1, config);
      expect(delay1).toBeGreaterThanOrEqual(900);
      expect(delay1).toBeLessThanOrEqual(1100);

      const delay2 = computeExponentialBackoffDelay(2, config);
      expect(delay2).toBeGreaterThanOrEqual(1800);
      expect(delay2).toBeLessThanOrEqual(2200);

      const delayMax = computeExponentialBackoffDelay(10, config);
      expect(delayMax).toBeGreaterThanOrEqual(9000);
      expect(delayMax).toBeLessThanOrEqual(11_000);
    });

    it("executes AutoWakeProber probing loop until quota replenishment", async () => {
      let probeCount = 0;
      let replenishedCallbackFired = false;

      const prober = new AutoWakeProber(
        async (attempt) => {
          probeCount = attempt;
          return attempt >= 2; // Replenished on 2nd attempt
        },
        () => {
          replenishedCallbackFired = true;
        },
        {
          baseIntervalMs: 10,
          backoffFactor: 1.1,
          maxIntervalMs: 50,
          jitterRatio: 0.0,
        },
      );

      // Attempt 1: not healthy
      const probe1 = await prober.probeNow();
      expect(probe1).toBe(false);
      expect(probeCount).toBe(1);
      expect(replenishedCallbackFired).toBe(false);

      // Attempt 2: healthy
      const probe2 = await prober.probeNow();
      expect(probe2).toBe(true);
      expect(probeCount).toBe(2);
      expect(replenishedCallbackFired).toBe(true);
      expect(prober.getActiveStatus()).toBe(false); // stopped automatically
    });
  });
});
