import { describe, expect, test } from "bun:test";
import {
  assertUnboundedConcurrencySafety,
  validateDepthInvariants,
  type DepthMetrics,
  type UnboundedWavePartition,
} from "../../../../olt/scripts/src/engine/scheduler/index.ts";

describe("Unlimited Depth DAG: Concurrency Safety & Invariants", () => {
  describe("assertUnboundedConcurrencySafety", () => {
    test("passes on waves with isolated write scopes and compliant parallelism", () => {
      const waves: UnboundedWavePartition[] = [
        {
          wave: 1,
          taskIds: ["t1", "t2"],
          tasks: [
            {
              id: "t1",
              priority: 1,
              created_order: 1,
              effort: 1,
              requirement_ids: [],
              write_scope: ["src/a.ts"],
            },
            {
              id: "t2",
              priority: 1,
              created_order: 2,
              effort: 1,
              requirement_ids: [],
              write_scope: ["src/b.ts"],
            },
          ],
          depth: 1,
          parallelism: 2,
          validatorPairings: [],
          isolatedWriteScopes: ["src/a.ts", "src/b.ts"],
          isUnbounded: true,
        },
      ];

      expect(() => assertUnboundedConcurrencySafety(waves, 4)).not.toThrow();
    });

    test("throws INVALID_STATE on write scope conflict in same wave", () => {
      const waves: UnboundedWavePartition[] = [
        {
          wave: 1,
          taskIds: ["t1", "t2"],
          tasks: [
            {
              id: "t1",
              priority: 1,
              created_order: 1,
              effort: 1,
              requirement_ids: [],
              write_scope: ["src/shared.ts"],
            },
            {
              id: "t2",
              priority: 1,
              created_order: 2,
              effort: 1,
              requirement_ids: [],
              write_scope: ["src/shared.ts"],
            },
          ],
          depth: 1,
          parallelism: 2,
          validatorPairings: [],
          isolatedWriteScopes: ["src/shared.ts"],
          isUnbounded: true,
        },
      ];

      expect(() => assertUnboundedConcurrencySafety(waves, 4)).toThrow(
        "conflict on write or resource scope",
      );
    });

    test("throws INVALID_STATE on wave exceeding max_parallel ceiling", () => {
      const waves: UnboundedWavePartition[] = [
        {
          wave: 1,
          taskIds: ["t1", "t2", "t3"],
          tasks: [
            {
              id: "t1",
              priority: 1,
              created_order: 1,
              effort: 1,
              requirement_ids: [],
              write_scope: ["src/a.ts"],
            },
            {
              id: "t2",
              priority: 1,
              created_order: 2,
              effort: 1,
              requirement_ids: [],
              write_scope: ["src/b.ts"],
            },
            {
              id: "t3",
              priority: 1,
              created_order: 3,
              effort: 1,
              requirement_ids: [],
              write_scope: ["src/c.ts"],
            },
          ],
          depth: 1,
          parallelism: 3,
          validatorPairings: [],
          isolatedWriteScopes: ["src/a.ts", "src/b.ts", "src/c.ts"],
          isUnbounded: true,
        },
      ];

      expect(() => assertUnboundedConcurrencySafety(waves, 2)).toThrow(
        "exceeds max_parallel limit",
      );
    });
  });

  describe("validateDepthInvariants", () => {
    test("validates compliant depth metrics", () => {
      const metrics: DepthMetrics = {
        totalTasks: 10,
        maxWaveDepth: 4,
        criticalPathLength: 4,
        criticalPathTasks: ["t1", "t2", "t3", "t4"],
        longestChainEffort: 8,
        maxConcurrentWidth: 3,
        averageConcurrency: 2.5,
        unboundedSafetyVerified: true,
        validatorPairingRate: 1.0,
      };

      const result = validateDepthInvariants(metrics);
      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
    });

    test("detects violations for unverified concurrency safety and incomplete validator pairing", () => {
      const metrics: DepthMetrics = {
        totalTasks: 5,
        maxWaveDepth: 2,
        criticalPathLength: 2,
        criticalPathTasks: ["t1", "t2"],
        longestChainEffort: 4,
        maxConcurrentWidth: 3,
        averageConcurrency: 2.5,
        unboundedSafetyVerified: false,
        validatorPairingRate: 0.8,
      };

      const result = validateDepthInvariants(metrics, {
        require_strict_validator_pairing: true,
      });
      expect(result.valid).toBe(false);
      expect(result.violations).toContain(
        "strict validator pairing rate must be 1.0 (100% paired)",
      );
      expect(result.violations).toContain("unbounded concurrency safety must be verified");
    });

    test("detects violation when configured max_depth is exceeded", () => {
      const metrics: DepthMetrics = {
        totalTasks: 10,
        maxWaveDepth: 6,
        criticalPathLength: 6,
        criticalPathTasks: ["t1", "t2", "t3", "t4", "t5", "t6"],
        longestChainEffort: 6,
        maxConcurrentWidth: 2,
        averageConcurrency: 1.67,
        unboundedSafetyVerified: true,
        validatorPairingRate: 1.0,
      };

      const result = validateDepthInvariants(metrics, { max_depth: 4 });
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes("exceeds configured max_depth"))).toBe(true);
    });

    test("validateDepthInvariants checks all individual invariant branches", () => {
      // 1. maxWaveDepth < 0 and criticalPathLength < 0
      const res1 = validateDepthInvariants({
        totalTasks: 2,
        maxWaveDepth: -1,
        criticalPathLength: -1,
        criticalPathTasks: [],
        longestChainEffort: 0,
        maxConcurrentWidth: 1,
        averageConcurrency: 1,
        unboundedSafetyVerified: true,
        validatorPairingRate: 1.0,
      });
      expect(res1.violations).toContain("maxWaveDepth must be non-negative");
      expect(res1.violations).toContain("criticalPathLength must be non-negative");

      // 2. totalTasks > 0 && maxWaveDepth === 0
      const res2 = validateDepthInvariants({
        totalTasks: 2,
        maxWaveDepth: 0,
        criticalPathLength: 1,
        criticalPathTasks: [],
        longestChainEffort: 0,
        maxConcurrentWidth: 1,
        averageConcurrency: 1,
        unboundedSafetyVerified: true,
        validatorPairingRate: 1.0,
      });
      expect(res2.violations).toContain("maxWaveDepth must be > 0 when totalTasks > 0");

      // 3. criticalPathLength > totalTasks
      const res3 = validateDepthInvariants({
        totalTasks: 2,
        maxWaveDepth: 2,
        criticalPathLength: 5,
        criticalPathTasks: [],
        longestChainEffort: 0,
        maxConcurrentWidth: 1,
        averageConcurrency: 1,
        unboundedSafetyVerified: true,
        validatorPairingRate: 1.0,
      });
      expect(res3.violations).toContain("criticalPathLength cannot exceed totalTasks");

      // 4. validatorPairingRate < 0 or > 1
      const res4 = validateDepthInvariants({
        totalTasks: 2,
        maxWaveDepth: 2,
        criticalPathLength: 2,
        criticalPathTasks: [],
        longestChainEffort: 0,
        maxConcurrentWidth: 1,
        averageConcurrency: 1,
        unboundedSafetyVerified: true,
        validatorPairingRate: 1.5,
      });
      expect(res4.violations).toContain("validatorPairingRate must be between 0.0 and 1.0");
    });
  });
});
