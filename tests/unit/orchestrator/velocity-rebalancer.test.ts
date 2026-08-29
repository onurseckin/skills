import { describe, expect, it } from "bun:test";
import {
  calculateBrentDecomposition,
  decomposeStragglingTask,
  DEFAULT_MAX_PARALLELISM,
  DEFAULT_MIN_PARALLELISM,
  DEFAULT_TARGET_DURATION_SECONDS,
  partitionScopeDisjoint,
  rebalanceStragglerTask,
  type BrentConcurrencyPlan,
  type BrentDecompositionOptions,
  type RebalancedTaskPackage,
  type StragglingTask,
} from "../../../olt/scripts/src/orchestrator/velocity-rebalancer.ts";

describe("Brent Concurrency Decomposition & Velocity Rebalancer (Wave 2 / Task 2.1)", () => {
  it("calculates optimal parallelism P = ceil(W / S) clamped to [5, 15] for standard workloads", () => {
    // 20 work units, span = 2 -> ceil(20/2) = 10 -> P = 10
    const plan1: BrentConcurrencyPlan = calculateBrentDecomposition({
      workUnits: 20,
      spanLength: 2,
    });
    expect(plan1.optimal_parallelism).toBe(10);
    expect(plan1.active_workers).toBe(10);
    expect(plan1.sub_partitions.length).toBe(10);
    expect(plan1.estimated_subagent_duration_seconds).toBe(DEFAULT_TARGET_DURATION_SECONDS);

    // 100 work units, span = 1 -> ceil(100/1) = 100 -> clamped to max 15
    const plan2 = calculateBrentDecomposition({ workUnits: 100, spanLength: 1 });
    expect(plan2.optimal_parallelism).toBe(DEFAULT_MAX_PARALLELISM);
    expect(plan2.sub_partitions.length).toBe(DEFAULT_MAX_PARALLELISM);

    // 6 work units, span = 2 -> ceil(6/2) = 3 -> clamped to min 5
    const plan3 = calculateBrentDecomposition({ workUnits: 6, spanLength: 2 });
    expect(plan3.optimal_parallelism).toBe(DEFAULT_MIN_PARALLELISM);
    expect(plan3.sub_partitions.length).toBe(DEFAULT_MIN_PARALLELISM);

    // 3 work units (small workload < minP) -> P = 3
    const planSmall = calculateBrentDecomposition({ workUnits: 3, spanLength: 1 });
    expect(planSmall.optimal_parallelism).toBe(3);
    expect(planSmall.sub_partitions.length).toBe(3);

    // 0 work units -> P = 0
    const planZero = calculateBrentDecomposition({ workUnits: 0, spanLength: 1 });
    expect(planZero.optimal_parallelism).toBe(0);
    expect(planZero.sub_partitions.length).toBe(0);
  });

  it("satisfies anti-stub failure criteria: 12 work units with span 1 produces exactly P = 12 sub-partitions", () => {
    // Input of 12 work units with span 1 must produce P = 12 sub-partitions
    const planNoFiles = calculateBrentDecomposition({
      workUnits: 12,
      spanLength: 1,
    });
    expect(planNoFiles.optimal_parallelism).toBe(12);
    expect(planNoFiles.sub_partitions.length).toBe(12);

    // Also verify with explicit 12 scope files
    const files = Array.from({ length: 12 }, (_, i) => `src/file_${i + 1}.ts`);
    const planWithFiles = calculateBrentDecomposition({
      workUnits: 12,
      spanLength: 1,
      scopeFiles: files,
      parentTaskId: "task-12-units",
    });
    expect(planWithFiles.optimal_parallelism).toBe(12);
    expect(planWithFiles.sub_partitions.length).toBe(12);
    for (let i = 0; i < 12; i++) {
      expect(planWithFiles.sub_partitions[i]?.assigned_scope).toEqual([files[i]!]);
    }
  });

  it("partitions file scopes into strictly disjoint sets across varied file list lengths", () => {
    // Case 1: 8 files partitioned into 4 partitions (exact division)
    const files8 = [
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
      "src/e.ts",
      "src/f.ts",
      "src/g.ts",
      "src/h.ts",
    ];
    const partitions8 = partitionScopeDisjoint(files8, 4);
    expect(partitions8.length).toBe(4);
    expect(partitions8.flat().length).toBe(8);

    // Pairwise empty intersection check
    for (let i = 0; i < partitions8.length; i++) {
      for (let j = i + 1; j < partitions8.length; j++) {
        const intersection = partitions8[i]!.filter((f) => partitions8[j]!.includes(f));
        expect(intersection).toEqual([]);
      }
    }

    // Case 2: 7 files partitioned into 3 partitions (uneven distribution: 3, 2, 2)
    const files7 = ["f1.ts", "f2.ts", "f3.ts", "f4.ts", "f5.ts", "f6.ts", "f7.ts"];
    const partitions7 = partitionScopeDisjoint(files7, 3);
    expect(partitions7.length).toBe(3);
    expect(partitions7.flat().length).toBe(7);
    for (let i = 0; i < partitions7.length; i++) {
      for (let j = i + 1; j < partitions7.length; j++) {
        const intersection = partitions7[i]!.filter((f) => partitions7[j]!.includes(f));
        expect(intersection).toEqual([]);
      }
    }

    // Case 3: 1 file with parallelism 5 -> 1 partition only
    const partitions1 = partitionScopeDisjoint(["single.ts"], 5);
    expect(partitions1.length).toBe(1);
    expect(partitions1[0]).toEqual(["single.ts"]);

    // Case 4: Empty file list or zero parallelism
    expect(partitionScopeDisjoint([], 5)).toEqual([]);
    expect(partitionScopeDisjoint(files8, 0)).toEqual([]);
    expect(partitionScopeDisjoint(files8, -1)).toEqual([]);
  });

  it("dynamically decomposes and rebalances straggler tasks into valid high-priority packages", () => {
    const straggler: StragglingTask = {
      id: "task-heavy-auth",
      agent_id: "agent-beta",
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

    // Test decomposeStragglingTask
    const pkg1: RebalancedTaskPackage = decomposeStragglingTask(straggler, {
      targetDurationSeconds: 200,
    });
    expect(pkg1.original_task_id).toBe("task-heavy-auth");
    expect(pkg1.spawned_subtasks.length).toBe(8); // 8 files with span 1 -> P = 8
    expect(Date.parse(pkg1.rebalanced_at)).not.toBeNaN();

    for (const subtask of pkg1.spawned_subtasks) {
      expect(subtask.subtask_id.startsWith("task-heavy-auth-sublane-")).toBe(true);
      expect(subtask.priority).toBe("HIGH_STRAGGLER_REBALANCE");
      expect(subtask.target_duration_seconds).toBe(200);
      expect(subtask.assigned_scope.length).toBeGreaterThan(0);
    }

    // Test rebalanceStragglerTask matches behavior
    const pkg2 = rebalanceStragglerTask(straggler);
    expect(pkg2.original_task_id).toBe("task-heavy-auth");
    expect(pkg2.spawned_subtasks.length).toBe(8);
    for (const subtask of pkg2.spawned_subtasks) {
      expect(subtask.target_duration_seconds).toBe(DEFAULT_TARGET_DURATION_SECONDS);
      expect(subtask.priority).toBe("HIGH_STRAGGLER_REBALANCE");
    }
  });

  it("enforces deterministic hashing and prevents duplicate subtask identifiers", () => {
    const task: StragglingTask = {
      id: "task-deterministic-check",
      scope_files: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts", "src/f.ts"],
      work_units: 6,
      span_length: 1,
    };

    const runA = rebalanceStragglerTask(task);
    const runB = rebalanceStragglerTask(task);

    // Hash determinism: identical task must produce identical subtask IDs across runs
    const idsA = runA.spawned_subtasks.map((s) => s.subtask_id);
    const idsB = runB.spawned_subtasks.map((s) => s.subtask_id);
    expect(idsA).toEqual(idsB);

    // Subtask uniqueness: no duplicates within a single decomposition run
    const uniqueIds = new Set(idsA);
    expect(uniqueIds.size).toBe(idsA.length);

    // Distinct tasks produce distinct subtask IDs
    const taskOther: StragglingTask = { ...task, id: "task-other-id" };
    const runOther = rebalanceStragglerTask(taskOther);
    const idsOther = runOther.spawned_subtasks.map((s) => s.subtask_id);
    for (let i = 0; i < idsA.length; i++) {
      expect(idsA[i]).not.toBe(idsOther[i]);
    }
  });
});
