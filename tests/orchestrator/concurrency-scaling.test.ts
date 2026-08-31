import { describe, expect, test } from "bun:test";
import {
  calculateBrentConcurrency,
  calculateBrentDecomposition,
  calculateDynamicWaveCapacity,
} from "../../olt/scripts/src/orchestrator/velocity-rebalancer.ts";

describe("Domain 20: Brent Work/Span Dynamic Concurrency Scaling (P = ceil(W / S))", () => {
  test("calculates P = ceil(W / S) when W is large and S is small", () => {
    // 30 work units with span 3 -> theoretical P = 10 (within default [5, 15])
    const p = calculateBrentConcurrency(30, 3);
    expect(p).toBe(10);
  });

  test("clamps P to maxParallelism when theoretical P exceeds maximum", () => {
    // 100 work units with span 2 -> theoretical P = 50 -> clamped to 15
    const p = calculateBrentConcurrency(100, 2, 5, 15);
    expect(p).toBe(15);
  });

  test("clamps P to minParallelism when theoretical P is below minimum but W >= minParallelism", () => {
    // 10 work units with span 5 -> theoretical P = 2 -> clamped to minParallelism (5)
    const p = calculateBrentConcurrency(10, 5, 5, 15);
    expect(p).toBe(5);
  });

  test("scales down P to W when total work units W < minParallelism", () => {
    // 3 work units with span 1 -> theoretical P = 3 -> scales to 3 (not minParallelism 5)
    const p = calculateBrentConcurrency(3, 1, 5, 15);
    expect(p).toBe(3);
  });

  test("returns 0 when workUnits is 0", () => {
    const p = calculateBrentConcurrency(0, 1);
    expect(p).toBe(0);
  });

  test("handles non-integer division ceiling correctly", () => {
    // 11 work units with span 4 -> ceil(11 / 4) = 3 -> scales to 3 if < 5, or clamp
    const p1 = calculateBrentConcurrency(11, 4, 1, 10);
    expect(p1).toBe(3);

    // 25 work units with span 4 -> ceil(25 / 4) = 7
    const p2 = calculateBrentConcurrency(25, 4, 2, 10);
    expect(p2).toBe(7);
  });

  test("calculateDynamicWaveCapacity computes capacity based on total task efforts", () => {
    const tasks = [{ effort: 5 }, { effort: 10 }, { effort: 15 }];
    // Total effort = 30, critical depth = 3 -> ceil(30 / 3) = 10
    const capacity = calculateDynamicWaveCapacity(tasks, 3);
    expect(capacity).toBe(10);
  });

  test("calculateBrentDecomposition generates deterministic sub-partitions with valid target duration", () => {
    const plan = calculateBrentDecomposition({
      workUnits: 20,
      spanLength: 2,
      minParallelism: 4,
      maxParallelism: 10,
      targetDurationSeconds: 180,
    });

    expect(plan.optimal_parallelism).toBe(10);
    expect(plan.active_workers).toBe(10);
    expect(plan.estimated_subagent_duration_seconds).toBe(180);
    expect(plan.sub_partitions.length).toBe(10);
  });
});
