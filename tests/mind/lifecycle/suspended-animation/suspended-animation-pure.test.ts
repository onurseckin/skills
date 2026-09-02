import { describe, expect, it } from "bun:test";
import {
  AutoWakeProber,
  canonicalJsonStringify,
  computeExponentialBackoffDelay,
  computeSnapshotChecksum,
  type SuspendedAnimationSnapshot,
  type SuspendedTaskNode,
  validateTaskDagAcyclicity,
  verifySnapshotIntegrity,
} from "../../../../olt/scripts/src/mind/lifecycle/suspended-animation.ts";

describe("Suspended Animation Pure Functions Suite", () => {
  describe("canonicalJsonStringify & Checksum Integrity", () => {
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

    it("computes sha256 checksum and verifies valid and tampered snapshots", () => {
      const unsigned = {
        schemaVersion: "1.0.0",
        snapshotId: "snap-test-1",
        suspendedAtIso: "2026-09-01T20:00:00.000Z",
        suspendedAtMs: 1756700000000,
        reason: "Resource threshold exceeded",
        governorState: "HIBERNATING" as const,
        tasksDag: [],
        frozenTimers: [],
        activeWatchdogs: ["stall-watchdog"],
        contextState: { key: "value" },
      };

      const checksum = computeSnapshotChecksum(unsigned);
      expect(typeof checksum).toBe("string");
      expect(checksum.length).toBe(64);

      const validSnapshot: SuspendedAnimationSnapshot = { ...unsigned, checksum };
      expect(verifySnapshotIntegrity(validSnapshot)).toBe(true);

      const tamperedSnapshot: SuspendedAnimationSnapshot = {
        ...validSnapshot,
        reason: "Tampered reason",
      };
      expect(verifySnapshotIntegrity(tamperedSnapshot)).toBe(false);
    });
  });

  describe("validateTaskDagAcyclicity", () => {
    const makeNode = (taskId: string, dependents: readonly string[] = []): SuspendedTaskNode => ({
      taskId,
      title: `Task ${taskId}`,
      status: "SUSPENDED",
      priority: "HIGH",
      dependencies: [],
      dependents,
      suspendedAtMs: Date.now(),
    });

    it("validates acyclic empty, linear, and diamond task graphs", () => {
      expect(validateTaskDagAcyclicity([])).toEqual({ valid: true });

      const linear = [makeNode("A", ["B"]), makeNode("B", ["C"]), makeNode("C", [])];
      expect(validateTaskDagAcyclicity(linear)).toEqual({ valid: true });

      const diamond = [
        makeNode("A", ["B", "C"]),
        makeNode("B", ["D"]),
        makeNode("C", ["D"]),
        makeNode("D", []),
      ];
      expect(validateTaskDagAcyclicity(diamond)).toEqual({ valid: true });
    });

    it("detects self-cycles, two-node cycles, and multi-node cycles", () => {
      const selfLoop = [makeNode("A", ["A"])];
      const selfRes = validateTaskDagAcyclicity(selfLoop);
      expect(selfRes.valid).toBe(false);
      expect(selfRes.cycle).toBeDefined();

      const twoNode = [makeNode("A", ["B"]), makeNode("B", ["A"])];
      const twoRes = validateTaskDagAcyclicity(twoNode);
      expect(twoRes.valid).toBe(false);
      expect(twoRes.cycle).toContain("A");
      expect(twoRes.cycle).toContain("B");

      const disconnectedCycle = [
        makeNode("A", ["B"]),
        makeNode("B", []),
        makeNode("C", ["D"]),
        makeNode("D", ["E"]),
        makeNode("E", ["C"]),
      ];
      const discRes = validateTaskDagAcyclicity(disconnectedCycle);
      expect(discRes.valid).toBe(false);
    });
  });

  describe("Exponential Backoff Calculation & AutoWakeProber", () => {
    const config = {
      baseIntervalMs: 1000,
      backoffFactor: 2.0,
      maxIntervalMs: 8000,
      jitterRatio: 0,
    };

    it("computes deterministic exponential backoff delays with clamping", () => {
      expect(computeExponentialBackoffDelay(1, config)).toBe(1000);
      expect(computeExponentialBackoffDelay(2, config)).toBe(2000);
      expect(computeExponentialBackoffDelay(3, config)).toBe(4000);
      expect(computeExponentialBackoffDelay(4, config)).toBe(8000);
      expect(computeExponentialBackoffDelay(5, config)).toBe(8000);
    });

    it("applies jitter bounds when jitterRatio is positive", () => {
      const jitterConfig = { ...config, jitterRatio: 0.2 };
      for (let i = 0; i < 10; i++) {
        const delay = computeExponentialBackoffDelay(2, jitterConfig);
        expect(delay).toBeGreaterThanOrEqual(1600);
        expect(delay).toBeLessThanOrEqual(2400);
      }
    });

    it("manages AutoWakeProber lifecycle, probing, and replenishment callback", async () => {
      let replenishedCalled = false;
      let probeCount = 0;

      const prober = new AutoWakeProber(
        async (attempt) => {
          probeCount = attempt;
          return attempt >= 2;
        },
        () => {
          replenishedCalled = true;
        },
        config,
      );

      expect(prober.getActiveStatus()).toBe(true);

      const attempt1 = await prober.probeNow();
      expect(attempt1).toBe(false);
      expect(probeCount).toBe(1);
      expect(replenishedCalled).toBe(false);
      expect(prober.getActiveStatus()).toBe(true);

      const attempt2 = await prober.probeNow();
      expect(attempt2).toBe(true);
      expect(probeCount).toBe(2);
      expect(replenishedCalled).toBe(true);
      expect(prober.getActiveStatus()).toBe(false);

      const attempt3 = await prober.probeNow();
      expect(attempt3).toBe(false);
    });

    it("stops prober cleanly via stop()", () => {
      const prober = new AutoWakeProber(
        async () => false,
        () => {},
        config,
      );
      prober.start();
      expect(prober.getActiveStatus()).toBe(true);
      prober.stop();
      expect(prober.getActiveStatus()).toBe(false);
    });

    it("schedules next probe asynchronously via start() timer loop", async () => {
      let attempts = 0;
      let replenished = false;
      const fastConfig = {
        baseIntervalMs: 5,
        backoffFactor: 1.0,
        maxIntervalMs: 10,
        jitterRatio: 0,
      };

      const prober = new AutoWakeProber(
        async (a) => {
          attempts = a;
          return a >= 2;
        },
        () => {
          replenished = true;
        },
        fastConfig,
      );

      prober.start();
      await new Promise((r) => setTimeout(r, 200));

      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(replenished).toBe(true);
      expect(prober.getActiveStatus()).toBe(false);
    });
  });
});
