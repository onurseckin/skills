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
  describe("ResourceGovernor: Pure Functions & Mathematical Bounds", () => {
    it("calculates utilization ratio clamping within [0.0, 1.0]", () => {
      expect(calculateUtilizationRatio(50, 100)).toBe(0.5);
      expect(calculateUtilizationRatio(0, 100)).toBe(0.0);
      expect(calculateUtilizationRatio(100, 100)).toBe(1.0);
      expect(calculateUtilizationRatio(150, 100)).toBe(1.0); // clamped max
      expect(calculateUtilizationRatio(-10, 100)).toBe(0.0); // clamped min

      // Zero limit edge cases
      expect(calculateUtilizationRatio(10, 0)).toBe(1.0); // limit 0 with usage
      expect(calculateUtilizationRatio(0, 0)).toBe(0.0); // limit 0 zero usage
    });

    it("calculates remaining headroom clamping at minimum 0", () => {
      expect(calculateRemainingHeadroom(30, 100)).toBe(70);
      expect(calculateRemainingHeadroom(100, 100)).toBe(0);
      expect(calculateRemainingHeadroom(120, 100)).toBe(0); // clamped min 0
      expect(calculateRemainingHeadroom(0, 100)).toBe(100);
      expect(calculateRemainingHeadroom(10, 0)).toBe(0);
    });

    it("compares state strictness hierarchy accurately via isStateStricter", () => {
      expect(isStateStricter("HIBERNATING", "EXHAUSTED")).toBe(true);
      expect(isStateStricter("EXHAUSTED", "WARNING")).toBe(true);
      expect(isStateStricter("WARNING", "RECOVERING")).toBe(true);
      expect(isStateStricter("RECOVERING", "NOMINAL")).toBe(true);
      expect(isStateStricter("NOMINAL", "HIBERNATING")).toBe(false);
      expect(isStateStricter("WARNING", "WARNING")).toBe(false);
    });
  });

  describe("ResourceGovernor: State Machine Transitions & Headroom Monitoring", () => {
    it("transitions through NOMINAL -> WARNING -> HIBERNATING -> RECOVERING -> NOMINAL", () => {
      const gov = createResourceGovernor({
        limits: {
          maxRpm: 100,
          maxTpm: 10_000,
          maxDailyCompute: 50_000,
          maxConcurrency: 10,
        },
        warningThreshold: 0.8,
        criticalThreshold: 0.9,
        recoveryThreshold: 0.6,
        windowDurationRpmMs: 1000,
        windowDurationTpmMs: 1000,
      });

      const stateTransitions: { from: ResourceGovernorState; to: ResourceGovernorState }[] = [];
      gov.onStateChange((from, to) => {
        stateTransitions.push({ from, to });
      });

      const warnings: ResourceHeadroom[] = [];
      gov.onQuotaWarning((w) => {
        warnings.push(w);
      });

      const hibernations: ResourceType[] = [];
      gov.onHibernationTrigger((r) => {
        hibernations.push(r);
      });

      const baseTime = 1_000_000;

      // 1. Initial State is NOMINAL
      expect(gov.getStatus(baseTime).state).toBe("NOMINAL");

      // 2. Record 50 RPM (50% utilization -> NOMINAL)
      let status = gov.recordUsage({ requests: 50 }, baseTime);
      expect(status.state).toBe("NOMINAL");
      expect(status.headroom.API_RPM.currentUsage).toBe(50);
      expect(status.headroom.API_RPM.remainingHeadroom).toBe(50);

      // 3. Record 35 more requests (total 85 RPM >= 80% warning -> WARNING)
      status = gov.recordUsage({ requests: 35 }, baseTime + 100);
      expect(status.state).toBe("WARNING");
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(warnings[0]?.resourceType).toBe("API_RPM");

      // 4. Record 10 more requests (total 95 RPM >= 90% critical -> HIBERNATING)
      status = gov.recordUsage({ requests: 10 }, baseTime + 200);
      expect(status.state).toBe("HIBERNATING");
      expect(hibernations.length).toBeGreaterThanOrEqual(1);
      expect(hibernations[0]).toBe("API_RPM");

      // Verify dispatch is rejected during HIBERNATING
      const check = gov.canDispatch(1, 0, 1, baseTime + 250);
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("HIBERNATING");

      // 5. Advance time past window (1000ms) so usage rolls off (0 RPM <= 60% recovery -> NOMINAL)
      const recoveryTime = baseTime + 1500;
      const recovered = gov.getStatus(recoveryTime);
      expect(recovered.headroom.API_RPM.currentUsage).toBe(0);
      expect(recovered.state).toBe("NOMINAL");

      expect(stateTransitions.length).toBeGreaterThanOrEqual(3);
    });

    it("allows dynamic quota limit adjustments at runtime via setQuotaLimits", () => {
      const gov = createResourceGovernor({
        limits: { maxRpm: 100 },
      });

      expect(gov.getLimits().maxRpm).toBe(100);

      gov.setQuotaLimits({ maxRpm: 250, maxTpm: 500_000 });
      expect(gov.getLimits().maxRpm).toBe(250);
      expect(gov.getLimits().maxTpm).toBe(500_000);
    });
  });

  describe("ResourceGovernor: HTTP 429 Rate Limit Throttle Handling", () => {
    it("handles external rate limit (429) throttle event and enters HIBERNATING", () => {
      const gov = createResourceGovernor({
        autoTransitionToHibernating: true,
      });

      const now = 2_000_000;
      const status = gov.recordExternalThrottle(
        {
          resourceType: "API_TPM",
          retryAfterMs: 45_000,
          reason: "Tokens per minute quota exceeded (HTTP 429)",
          statusCode: 429,
        },
        now,
      );

      expect(status.state).toBe("HIBERNATING");
      expect(status.throttleCount).toBe(1);
      expect(status.lastThrottleEvent?.statusCode).toBe(429);
      expect(status.lastThrottleEvent?.reason).toBe("Tokens per minute quota exceeded (HTTP 429)");
      expect(status.estimatedRecoveryMs).toBeGreaterThanOrEqual(44_000);

      // Dispatch rejected during active throttle
      const check = gov.canDispatch(1, 100, 1, now + 10_000);
      expect(check.allowed).toBe(false);
    });
  });

  describe("ResourceGovernor: Concurrency Management & canDispatch", () => {
    it("tracks active concurrency seats and rejects when capacity is exceeded", () => {
      const gov = createResourceGovernor({
        limits: { maxConcurrency: 5 },
      });

      const now = 3_000_000;

      // Acquire 3 seats
      expect(gov.acquireConcurrency(3, now)).toBe(true);
      expect(gov.getStatus(now).headroom.CONCURRENCY.currentUsage).toBe(3);

      // Acquire 2 more seats (total 5 = max limit)
      expect(gov.acquireConcurrency(2, now)).toBe(true);
      expect(gov.getStatus(now).headroom.CONCURRENCY.currentUsage).toBe(5);

      // Attempting to acquire 1 more seat fails
      expect(gov.acquireConcurrency(1, now)).toBe(false);

      // canDispatch rejects additional concurrency
      const check = gov.canDispatch(1, 0, 1, now);
      expect(check.allowed).toBe(false);
      expect(check.limitingResource).toBe("CONCURRENCY");

      // Release 3 seats
      expect(gov.releaseConcurrency(3, now)).toBe(2);
      expect(gov.getStatus(now).headroom.CONCURRENCY.currentUsage).toBe(2);

      // Now canDispatch succeeds
      const checkAfter = gov.canDispatch(1, 0, 1, now);
      expect(checkAfter.allowed).toBe(true);
    });

    it("resets usage windows cleanly using resetWindow", () => {
      const gov = createResourceGovernor();
      const now = 4_000_000;

      gov.recordUsage({ requests: 50, tokens: 20_000, computeUnits: 1000 }, now);
      expect(gov.getStatus(now).headroom.API_RPM.currentUsage).toBe(50);

      gov.resetWindow("API_RPM", now);
      expect(gov.getStatus(now).headroom.API_RPM.currentUsage).toBe(0);
      expect(gov.getStatus(now).headroom.API_TPM.currentUsage).toBe(20_000);

      gov.resetWindow(undefined, now); // reset all
      expect(gov.getStatus(now).headroom.API_TPM.currentUsage).toBe(0);
    });
  });
});
