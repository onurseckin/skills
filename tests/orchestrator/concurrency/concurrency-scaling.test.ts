import { describe, expect, test } from "bun:test";
import {
  calculateBrentConcurrency,
  calculateBrentDecomposition,
  calculateDynamicWaveCapacity,
  setTelemetryQuotaProvider,
} from "../../../olt/scripts/src/orchestrator/velocity-rebalancer.ts";
import { createSampleCapsuleSpecs, createSampleTaskSpecs } from "./fixture.ts";
import { CONCURRENCY_SUITES } from "./index.ts";

describe("Domain 20: Brent Work/Span Dynamic Concurrency Scaling (P = ceil(W / S))", () => {
  test("calculates P = ceil(W / S) when W is large and S is small", () => {
    const p = calculateBrentConcurrency(30, 3);
    expect(p).toBe(10);
  });

  test("clamps P to maxParallelism when theoretical P exceeds maximum", () => {
    const p = calculateBrentConcurrency(100, 2, 5, 15);
    expect(p).toBe(15);
  });

  test("clamps P to minParallelism when theoretical P is below minimum but W >= minParallelism", () => {
    const p = calculateBrentConcurrency(10, 5, 5, 15);
    expect(p).toBe(5);
  });

  test("scales down P to W when total work units W < minParallelism", () => {
    const p = calculateBrentConcurrency(3, 1, 5, 15);
    expect(p).toBe(3);
  });

  test("returns 0 when workUnits is 0", () => {
    const p = calculateBrentConcurrency(0, 1);
    expect(p).toBe(0);
  });

  test("handles non-integer division ceiling correctly", () => {
    const p1 = calculateBrentConcurrency(11, 4, 1, 10);
    expect(p1).toBe(3);

    const p2 = calculateBrentConcurrency(25, 4, 2, 10);
    expect(p2).toBe(7);
  });

  test("calculateDynamicWaveCapacity computes capacity based on total task efforts", () => {
    const tasks = [{ effort: 5 }, { effort: 10 }, { effort: 15 }];
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

  test("concurrency fixtures and suite registry are valid", () => {
    const tasks = createSampleTaskSpecs();
    expect(tasks.length).toBe(3);
    expect(tasks[0]?.id).toBe("task-a");

    const specs = createSampleCapsuleSpecs();
    expect(specs.length).toBe(3);
    expect(specs[0]?.id).toBe("cap-alpha");

    expect(CONCURRENCY_SUITES.length).toBe(7);
  });

  test("when quota > 10%, standard decomposition concurrency is used (P = ceil(W/S))", () => {
    const p12 = calculateBrentConcurrency(30, 3, 5, 15, 12);
    expect(p12).toBe(10);

    const p15 = calculateBrentConcurrency(30, 3, 5, 15, 15);
    expect(p15).toBe(10);

    const p50 = calculateBrentConcurrency(30, 3, 5, 15, 50);
    expect(p50).toBe(10);

    const planNominal = calculateBrentDecomposition({
      workUnits: 20,
      spanLength: 2,
      minParallelism: 4,
      maxParallelism: 10,
      quotaPercentage: 12,
    });
    expect(planNominal.optimal_parallelism).toBe(10);
    expect(planNominal.sub_partitions.length).toBe(10);
  });

  test("when quota <= 10% (e.g. 8%), decomposition concurrency is throttled to 1", () => {
    const p10 = calculateBrentConcurrency(30, 3, 5, 15, 10);
    expect(p10).toBe(1);

    const p8 = calculateBrentConcurrency(30, 3, 5, 15, 8);
    expect(p8).toBe(1);

    const p0 = calculateBrentConcurrency(30, 3, 5, 15, 0);
    expect(p0).toBe(1);

    const planThrottled = calculateBrentDecomposition({
      workUnits: 20,
      spanLength: 2,
      minParallelism: 4,
      maxParallelism: 10,
      quotaPercentage: 8,
    });
    expect(planThrottled.optimal_parallelism).toBe(1);
    expect(planThrottled.sub_partitions.length).toBe(1);
  });

  test("wires quota query function, quota state object, and telemetry quota provider", () => {
    const planFn = calculateBrentDecomposition({
      workUnits: 18,
      spanLength: 2,
      minParallelism: 2,
      maxParallelism: 9,
      getQuotaPercentage: () => 8,
    });
    expect(planFn.optimal_parallelism).toBe(1);
    expect(planFn.sub_partitions.length).toBe(1);

    const planState = calculateBrentDecomposition({
      workUnits: 18,
      spanLength: 2,
      minParallelism: 2,
      maxParallelism: 9,
      quotaState: { remainingPercentage: 8 },
    });
    expect(planState.optimal_parallelism).toBe(1);
    expect(planState.sub_partitions.length).toBe(1);

    setTelemetryQuotaProvider(() => 8);
    const planGlobalLow = calculateBrentDecomposition({
      workUnits: 18,
      spanLength: 2,
      minParallelism: 2,
      maxParallelism: 9,
    });
    expect(planGlobalLow.optimal_parallelism).toBe(1);

    setTelemetryQuotaProvider(() => 60);
    const planGlobalNominal = calculateBrentDecomposition({
      workUnits: 18,
      spanLength: 2,
      minParallelism: 2,
      maxParallelism: 9,
    });
    expect(planGlobalNominal.optimal_parallelism).toBe(9);

    setTelemetryQuotaProvider(undefined);
  });
});
