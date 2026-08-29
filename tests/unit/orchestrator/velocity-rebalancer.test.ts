import { describe, expect, it } from "bun:test";
import {
  calculateBrentDecomposition,
  partitionScopeDisjoint,
  rebalanceStragglerTask,
  type StragglingTask,
} from "../../../olt/scripts/src/orchestrator/velocity-rebalancer.ts";

describe("Brent Concurrency Decomposition & Velocity Rebalancer (Task 2.2)", () => {
  it("calculates optimal parallelism P = ceil(W / S) clamped to [5, 15] for standard workloads", () => {
    // 20 work units, span = 2 -> 20/2 = 10 -> P = 10
    const plan1 = calculateBrentDecomposition({ workUnits: 20, spanLength: 2 });
    expect(plan1.optimal_parallelism).toBe(10);
    expect(plan1.sub_partitions.length).toBe(10);
    expect(plan1.estimated_subagent_duration_seconds).toBe(180);

    // 100 work units, span = 1 -> 100 -> clamped to max 15
    const plan2 = calculateBrentDecomposition({ workUnits: 100, spanLength: 1 });
    expect(plan2.optimal_parallelism).toBe(15);
    expect(plan2.sub_partitions.length).toBe(15);

    // 6 work units, span = 2 -> 6/2 = 3 -> clamped to min 5
    const plan3 = calculateBrentDecomposition({ workUnits: 6, spanLength: 2 });
    expect(plan3.optimal_parallelism).toBe(5);

    // 3 work units (small workload) -> P = 3
    const planSmall = calculateBrentDecomposition({ workUnits: 3, spanLength: 1 });
    expect(planSmall.optimal_parallelism).toBe(3);
    expect(planSmall.sub_partitions.length).toBe(3);
  });

  it("partitions file scopes into strictly disjoint sets with zero overlap", () => {
    const files = [
      "src/module/a.ts",
      "src/module/b.ts",
      "src/module/c.ts",
      "src/module/d.ts",
      "src/module/e.ts",
      "src/module/f.ts",
      "src/module/g.ts",
      "src/module/h.ts",
    ];

    const partitions = partitionScopeDisjoint(files, 4);
    expect(partitions.length).toBe(4);

    const allAllocatedFiles = partitions.flat();
    expect(allAllocatedFiles.length).toBe(files.length);

    // Verify disjoint sets: pairwise intersection must be empty
    for (let i = 0; i < partitions.length; i++) {
      for (let j = i + 1; j < partitions.length; j++) {
        const intersection = partitions[i].filter((f) => partitions[j].includes(f));
        expect(intersection).toEqual([]);
      }
    }
  });

  it("rebalances straggler tasks and generates complete rebalance package", () => {
    const straggler: StragglingTask = {
      id: "task-heavy-refactor",
      agent_id: "agent-alpha",
      scope_files: [
        "src/auth/login.ts",
        "src/auth/logout.ts",
        "src/auth/session.ts",
        "src/auth/token.ts",
        "src/auth/oauth.ts",
        "src/auth/rbac.ts",
        "src/auth/guards.ts",
        "src/auth/index.ts",
      ],
      work_units: 8,
      span_length: 1,
    };

    const pkg = rebalanceStragglerTask(straggler);
    expect(pkg.original_task_id).toBe("task-heavy-refactor");
    expect(pkg.spawned_subtasks.length).toBeGreaterThanOrEqual(5);
    expect(pkg.spawned_subtasks.length).toBeLessThanOrEqual(15);

    for (const subtask of pkg.spawned_subtasks) {
      expect(subtask.subtask_id.startsWith("task-heavy-refactor-sublane-")).toBe(true);
      expect(subtask.priority).toBe("HIGH_STRAGGLER_REBALANCE");
      expect(subtask.target_duration_seconds).toBeGreaterThanOrEqual(120);
      expect(subtask.target_duration_seconds).toBeLessThanOrEqual(240);
      expect(subtask.assigned_scope.length).toBeGreaterThan(0);
    }
  });
});
