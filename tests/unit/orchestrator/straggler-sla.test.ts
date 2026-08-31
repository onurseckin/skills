import { describe, expect, test } from "bun:test";
import {
  isTaskStraggling,
  partitionStragglers,
  rebalanceStragglerTask,
  STRAGGLER_SLA_MS,
  STRAGGLER_SLA_SECONDS,
  type StragglingTask,
} from "../../../olt/scripts/src/orchestrator/velocity-rebalancer.ts";

describe("Domain 20: 5-Minute Straggler SLA Partitioning", () => {
  test("STRAGGLER_SLA_SECONDS is exactly 300 seconds (5 minutes)", () => {
    expect(STRAGGLER_SLA_SECONDS).toBe(300);
    expect(STRAGGLER_SLA_MS).toBe(300_000);
  });

  test("isTaskStraggling identifies tasks exceeding the 300s SLA threshold", () => {
    const onScheduleTask: StragglingTask = {
      id: "task-fast",
      elapsed_seconds: 120,
    };
    expect(isTaskStraggling(onScheduleTask)).toBe(false);

    const boundaryTask: StragglingTask = {
      id: "task-boundary",
      elapsed_seconds: 300,
    };
    expect(isTaskStraggling(boundaryTask)).toBe(true);

    const stragglerTask: StragglingTask = {
      id: "task-slow",
      elapsed_seconds: 450,
    };
    expect(isTaskStraggling(stragglerTask)).toBe(true);
  });

  test("isTaskStraggling calculates elapsed time from timestamp if started_at is provided", () => {
    const now = Date.now();
    const recentTask: StragglingTask = {
      id: "task-recent",
      started_at: now - 100_000, // 100 seconds ago
    };
    expect(isTaskStraggling(recentTask)).toBe(false);

    const expiredTask: StragglingTask = {
      id: "task-expired",
      started_at: now - 350_000, // 350 seconds ago
    };
    expect(isTaskStraggling(expiredTask)).toBe(true);
  });

  test("partitionStragglers cleanly partitions pool into on-schedule vs stragglers", () => {
    const tasks: StragglingTask[] = [
      { id: "task-1", elapsed_seconds: 50 },
      {
        id: "task-2",
        elapsed_seconds: 320,
        scope_files: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
      },
      { id: "task-3", elapsed_seconds: 180 },
      { id: "task-4", elapsed_seconds: 600, scope_files: ["src/x.ts", "src/y.ts"] },
    ];

    const report = partitionStragglers(tasks);

    expect(report.onScheduleTasks).toEqual(["task-1", "task-3"]);
    expect(report.stragglerTasks).toEqual(["task-2", "task-4"]);
    expect(report.slaThresholdSeconds).toBe(300);
    expect(report.rebalancedPackages.length).toBe(2);
    expect(report.rebalancedPackages[0]?.original_task_id).toBe("task-2");
    expect(report.rebalancedPackages[1]?.original_task_id).toBe("task-4");
  });

  test("rebalanceStragglerTask decomposes straggler into high-priority sub-tasks with target duration <= 180s", () => {
    const straggler: StragglingTask = {
      id: "task-heavy",
      scope_files: [
        "src/auth/login.ts",
        "src/auth/session.ts",
        "src/auth/token.ts",
        "src/auth/guards.ts",
        "src/auth/permissions.ts",
        "src/auth/jwt.ts",
      ],
      work_units: 6,
      span_length: 1,
    };

    const rebalanced = rebalanceStragglerTask(straggler, {
      minParallelism: 2,
      maxParallelism: 6,
      targetDurationSeconds: 180,
    });

    expect(rebalanced.original_task_id).toBe("task-heavy");
    expect(rebalanced.spawned_subtasks.length).toBeGreaterThan(0);
    for (const sub of rebalanced.spawned_subtasks) {
      expect(sub.priority).toBe("HIGH_STRAGGLER_REBALANCE");
      expect(sub.target_duration_seconds).toBeLessThanOrEqual(180);
      expect(sub.assigned_scope.length).toBeGreaterThan(0);
    }
  });
});
