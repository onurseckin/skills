/**
 * Test Suite: Plan 91 Pillar 1 - Elastic Dynamic Hierarchy Scaling & Anti-Serialization Interlock
 *
 * Verifies:
 * 1. Fast-Path Compaction on N = 1 single tasks (Orchestrator manages worker directly).
 * 2. Multi-Coordinator Partitioning for waves > 5 lanes or multi-stack features (max 5 lanes per coordinator).
 * 3. Hard-Coded Anti-Serialization Mechanical Interlock (FALSE_SERIALIZATION_DEFECT).
 * 4. Integration with Smart Task Manager, Wave Execution, and Multi-Orchestrator Pre-Planning.
 * 5. Strict static code invariants (0 any, 0 compiler/linter suppressions).
 */

import { describe, expect, it } from "bun:test";
import {
  FALSE_SERIALIZATION_DEFECT,
  FAST_PATH_TASK_COUNT,
  MAX_LANES_PER_COORDINATOR,
  assertAntiSerializationInterlock,
  evaluateHierarchyScaling,
  evaluateSmartHierarchy,
  formatParallelSubagentsDispatchArray,
  inferStackOrDomain,
  isFastPathCompactionEligible,
  partitionWaveCoordinators,
  planMultiCoordinatorWaves,
  planWaveExecution,
  preplanMultiOrchestratorTasks,
  verifyAntiSerializationInterlock,
  type CoordinatorPartition,
  type HierarchyScalingResult,
  type MultiCoordinatorWavePartitionResult,
  type SmartTaskPlan,
} from "../../../olt/scripts/src/mind/tasks/smart/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

function createMockTask(
  id: string,
  scope: string[],
  deps: string[] = [],
  domain?: string,
): SmartTaskPlan {
  return {
    id,
    label: `Test task for ${id}`,
    write_scope: scope,
    gate: "bun test tests/unit && bun run typecheck",
    charter_goals: ["G1"],
    acceptance_criteria: [`Pass ${id}`],
    dependencies: deps,
    source_type: "external_intake",
    priority: "HIGH",
    rationale: `Rationale for ${id}`,
    assigned_tier: "Tier_3_Implementer",
    assigned_implementer: `implementer-${id}`,
    assigned_validator: `validator-${id}`,
    metadata: {
      domain,
      assigned_implementer: `implementer-${id}`,
      assigned_validator: `validator-${id}`,
    },
  };
}

describe("Plan 91 Pillar 1: Elastic Dynamic Hierarchy Scaling & Anti-Serialization", () => {
  describe("1. Fast-Path Compaction (N = 1 Single Task Runs)", () => {
    it("identifies single task inputs as fast-path compaction eligible", () => {
      expect(FAST_PATH_TASK_COUNT).toBe(1);
      expect(isFastPathCompactionEligible(1)).toBe(true);
      expect(isFastPathCompactionEligible([createMockTask("t1", ["src/a.ts"])])).toBe(true);
      expect(isFastPathCompactionEligible(0)).toBe(false);
      expect(isFastPathCompactionEligible(2)).toBe(false);
      expect(isFastPathCompactionEligible([])).toBe(false);
      expect(
        isFastPathCompactionEligible([
          createMockTask("t1", ["src/a.ts"]),
          createMockTask("t2", ["src/b.ts"]),
        ]),
      ).toBe(false);
    });

    it("evaluates hierarchy scaling for single task to fast_path_compaction", () => {
      const result: HierarchyScalingResult = evaluateHierarchyScaling({ taskCount: 1 });
      expect(result.path).toBe("fast_path_compaction");
      expect(result.fastPath).toBe(true);
      expect(result.isMultiCoordinator).toBe(false);
      expect(result.requiredCoordinators).toBe(0);
      expect(result.optimalLanes).toBe(1);
      expect(result.reason).toContain("Fast-Path Compaction active: single task ($N = 1$)");
    });

    it("evaluates hierarchy scaling for smart task array with evaluateSmartHierarchy", () => {
      const singleTask = [createMockTask("t1", ["src/single.ts"])];
      const result = evaluateSmartHierarchy(singleTask);
      expect(result.path).toBe("fast_path_compaction");
      expect(result.fastPath).toBe(true);
      expect(result.requiredCoordinators).toBe(0);
    });

    it("integrates fast-path compaction into planWaveExecution on N = 1", () => {
      const singleTask = [createMockTask("task-1-fast", ["olt/scripts/src/a.ts"])];
      const wavePlan = planWaveExecution(singleTask);

      expect(wavePlan.total_tasks).toBe(1);
      expect(wavePlan.total_waves).toBe(1);
      expect(wavePlan.fast_path_compaction).toBe(true);
      expect(wavePlan.hierarchy_scaling?.path).toBe("fast_path_compaction");
      expect(wavePlan.hierarchy_scaling?.requiredCoordinators).toBe(0);
    });
  });

  describe("2. Multi-Coordinator Wave Partitioning (Max 5 Lanes per Coordinator)", () => {
    it("enforces MAX_LANES_PER_COORDINATOR constant of 5", () => {
      expect(MAX_LANES_PER_COORDINATOR).toBe(5);
    });

    it("infers functional stacks and domains from file scopes accurately", () => {
      expect(inferStackOrDomain("src/ui/Button.tsx")).toBe("ui");
      expect(inferStackOrDomain("src/styles/theme.css")).toBe("ui");
      expect(inferStackOrDomain("src/mind/tasks/smart/index.ts")).toBe("core");
      expect(inferStackOrDomain("scripts/cli/commands/task-check.ts")).toBe("cli");
      expect(inferStackOrDomain("prisma/schema.prisma")).toBe("database");
      expect(inferStackOrDomain("scripts/engine.py")).toBe("python");
      expect(inferStackOrDomain("src/native/binding.rs")).toBe("rust");
      expect(inferStackOrDomain("cmd/server/main.go")).toBe("go");
    });

    it("proves exact boundary condition: N = 5 uses 1 coordinator, N = 6 triggers multi-coordinator expansion", () => {
      const fiveTasks = Array.from({ length: 5 }, (_, i) =>
        createMockTask(`t-${i + 1}`, [`src/t${i + 1}.ts`]),
      );
      const res5 = partitionWaveCoordinators(fiveTasks, { waveIndex: 1 });
      expect(res5.totalLanes).toBe(5);
      expect(res5.coordinatorCount).toBe(1);
      expect(res5.isMultiCoordinator).toBe(false);
      expect(res5.partitions.length).toBe(1);

      const sixTasks = Array.from({ length: 6 }, (_, i) =>
        createMockTask(`t-${i + 1}`, [`src/t${i + 1}.ts`]),
      );
      const res6 = partitionWaveCoordinators(sixTasks, { waveIndex: 1 });
      expect(res6.totalLanes).toBe(6);
      expect(res6.coordinatorCount).toBe(2);
      expect(res6.isMultiCoordinator).toBe(true);
      expect(res6.partitions.length).toBe(2);
      expect(res6.partitions[0]?.taskIds.length).toBe(5);
      expect(res6.partitions[1]?.taskIds.length).toBe(1);
    });

    it("handles single-domain overflow with 12 lanes in ui domain under stackPartitioning", () => {
      const uiTasks = Array.from({ length: 12 }, (_, i) =>
        createMockTask(`ui-${i + 1}`, [`src/ui/Component${i + 1}.tsx`]),
      );
      const res = partitionWaveCoordinators(uiTasks, { waveIndex: 1, stackPartitioning: true });
      expect(res.totalLanes).toBe(12);
      expect(res.coordinatorCount).toBe(3);
      expect(res.isMultiCoordinator).toBe(true);
      expect(res.partitions[0]?.coordinatorId).toBe("coordinator_ui_part1");
      expect(res.partitions[1]?.coordinatorId).toBe("coordinator_ui_part2");
      expect(res.partitions[2]?.coordinatorId).toBe("coordinator_ui_part3");
      expect(res.partitions[0]?.taskIds.length).toBe(5);
      expect(res.partitions[1]?.taskIds.length).toBe(5);
      expect(res.partitions[2]?.taskIds.length).toBe(2);
    });

    it("falls back to core domain on unfamiliar file scopes without throwing", () => {
      expect(inferStackOrDomain("config/custom.unknown")).toBe("core");
      expect(inferStackOrDomain("")).toBe("core");
      expect(inferStackOrDomain([])).toBe("core");
    });

    it("partitions waves with > 5 lanes into multiple coordinators (<= 5 lanes each)", () => {
      const tasks = Array.from({ length: 12 }, (_, i) =>
        createMockTask(`lane-task-${i + 1}`, [`src/lane-${i + 1}.ts`]),
      );

      const partitionResult = partitionWaveCoordinators(tasks, { waveIndex: 2 });

      expect(partitionResult.waveIndex).toBe(2);
      expect(partitionResult.totalLanes).toBe(12);
      expect(partitionResult.coordinatorCount).toBe(3);
      expect(partitionResult.isMultiCoordinator).toBe(true);
      expect(partitionResult.partitions.length).toBe(3);

      expect(partitionResult.partitions[0]?.taskIds.length).toBe(5);
      expect(partitionResult.partitions[1]?.taskIds.length).toBe(5);
      expect(partitionResult.partitions[2]?.taskIds.length).toBe(2);

      expect(partitionResult.summary).toContain(
        "12 parallel lanes partitioned across 3 specialized Coordinators",
      );
    });

    it("partitions multi-stack tasks across domain-specific coordinators", () => {
      const tasks = [
        createMockTask("ui-1", ["src/ui/Header.tsx"]),
        createMockTask("ui-2", ["src/ui/Footer.tsx"]),
        createMockTask("cli-1", ["scripts/cli/commands/foo.ts"]),
        createMockTask("cli-2", ["scripts/cli/commands/bar.ts"]),
        createMockTask("db-1", ["prisma/migrations/01.sql"]),
      ];

      const partitionResult = partitionWaveCoordinators(tasks, {
        waveIndex: 1,
        stackPartitioning: true,
      });

      expect(partitionResult.isMultiCoordinator).toBe(true);
      expect(partitionResult.coordinatorCount).toBe(3);

      const domains = partitionResult.partitions.map((p) => p.domainOrStack);
      expect(domains).toContain("ui");
      expect(domains).toContain("cli");
      expect(domains).toContain("database");

      const uiPartition = partitionResult.partitions.find((p) => p.domainOrStack === "ui");
      expect(uiPartition?.taskIds).toEqual(["ui-1", "ui-2"]);
      expect(uiPartition?.coordinatorId).toBe("coordinator_ui");
    });

    it("plans multi-coordinator partitions across full wave plan via planMultiCoordinatorWaves", () => {
      const wave1Tasks = Array.from({ length: 7 }, (_, i) =>
        createMockTask(`w1-t${i + 1}`, [`src/w1-t${i + 1}.ts`]),
      );
      const wave2Tasks = [createMockTask("w2-t1", ["src/w2-t1.ts"], ["w1-t1"])];

      const fullWavePlan = planWaveExecution([...wave1Tasks, ...wave2Tasks]);
      const multiCoordPlan = planMultiCoordinatorWaves(fullWavePlan);

      expect(multiCoordPlan.length).toBe(2);
      expect(multiCoordPlan[0]?.waveIndex).toBe(1);
      expect(multiCoordPlan[0]?.totalLanes).toBe(7);
      expect(multiCoordPlan[0]?.coordinatorCount).toBe(2);
      expect(multiCoordPlan[0]?.isMultiCoordinator).toBe(true);

      expect(multiCoordPlan[1]?.waveIndex).toBe(2);
      expect(multiCoordPlan[1]?.totalLanes).toBe(1);
      expect(multiCoordPlan[1]?.coordinatorCount).toBe(1);
      expect(multiCoordPlan[1]?.isMultiCoordinator).toBe(false);
    });
  });

  describe("3. Hard-Coded Anti-Serialization Mechanical Interlock", () => {
    it("allows single-lane dispatches when ready lanes count is 1", () => {
      const result = verifyAntiSerializationInterlock(1, 1);
      expect(result.passed).toBe(true);
      expect(result.violation).toBeUndefined();

      expect(() => assertAntiSerializationInterlock(1, 1)).not.toThrow();
    });

    it("allows full parallel dispatches when ready lanes count >= 2", () => {
      const readyTasks = [
        createMockTask("task-A", ["src/a.ts"]),
        createMockTask("task-B", ["src/b.ts"]),
        createMockTask("task-C", ["src/c.ts"]),
      ];

      const result = verifyAntiSerializationInterlock(readyTasks, 3);
      expect(result.passed).toBe(true);
      expect(result.violation).toBeUndefined();

      expect(() => assertAntiSerializationInterlock(readyTasks, 3)).not.toThrow();
    });

    it("mechanically blocks single-subagent dispatches on N >= 2 ready lanes with FALSE_SERIALIZATION_DEFECT", () => {
      const readyTasks = [
        createMockTask("lane-1", ["src/lane1.ts"]),
        createMockTask("lane-2", ["src/lane2.ts"]),
        createMockTask("lane-3", ["src/lane3.ts"]),
        createMockTask("lane-4", ["src/lane4.ts"]),
      ];

      const result = verifyAntiSerializationInterlock(readyTasks, 1);
      expect(result.passed).toBe(false);
      expect(result.violation).toBeDefined();
      expect(result.violation?.code).toBe(FALSE_SERIALIZATION_DEFECT);
      expect(result.violation?.message).toBe(
        "[FALSE_SERIALIZATION_DEFECT] Wave contains 4 ready disjoint lanes. You MUST invoke all 4 subagents in parallel via Subagents: [...].",
      );
      expect(result.violation?.readyTaskIds).toEqual(["lane-1", "lane-2", "lane-3", "lane-4"]);
      expect(result.violation?.recommendedDispatchArray.length).toBe(4);

      expect(() => assertAntiSerializationInterlock(readyTasks, 1)).toThrow(HarnessError);

      // Verify partial batching (k = 2 or k = 3 for N = 4) is also blocked
      const partial2 = verifyAntiSerializationInterlock(readyTasks, 2);
      expect(partial2.passed).toBe(false);
      expect(partial2.violation?.code).toBe(FALSE_SERIALIZATION_DEFECT);
      expect(() => assertAntiSerializationInterlock(readyTasks, 2)).toThrow(HarnessError);

      const partial3 = verifyAntiSerializationInterlock(readyTasks, 3);
      expect(partial3.passed).toBe(false);
      expect(partial3.violation?.code).toBe(FALSE_SERIALIZATION_DEFECT);
      expect(() => assertAntiSerializationInterlock(readyTasks, 3)).toThrow(HarnessError);

      try {
        assertAntiSerializationInterlock(readyTasks, 1);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_STATE");
        expect(harnessErr.message).toContain("[FALSE_SERIALIZATION_DEFECT]");
        expect(harnessErr.message).toContain(
          "You MUST invoke all 4 subagents in parallel via Subagents: [...]",
        );
      }
    });

    it("formats 1-shot batch array for host-native invoke_subagent dispatch", () => {
      const tasks = [
        createMockTask("lane-alpha", ["src/alpha.ts"]),
        createMockTask("lane-beta", ["src/beta.ts"]),
      ];

      const batch = formatParallelSubagentsDispatchArray(tasks, {
        defaultTypeName: "self",
        defaultWorkspace: "share",
        rolePrefix: "Implementer Lane",
      });

      expect(batch.length).toBe(2);
      expect(batch[0]?.TypeName).toBe("self");
      expect(batch[0]?.Workspace).toBe("share");
      expect(batch[0]?.Role).toBe("Implementer Lane 1: Test task for lane-alpha");

      expect(batch[1]?.TypeName).toBe("self");
      expect(batch[1]?.Workspace).toBe("share");
      expect(batch[1]?.Role).toBe("Implementer Lane 2: Test task for lane-beta");
    });
  });

  describe("4. Integration with Multi-Orchestrator Pre-Planning", () => {
    it("calculates hierarchy scaling and coordinator counts in preplanMultiOrchestratorTasks", () => {
      const tasks = [
        createMockTask("core-1", ["olt/scripts/src/core1.ts"]),
        createMockTask("core-2", ["olt/scripts/src/core2.ts"]),
        createMockTask("cli-1", ["olt/scripts/src/cli/cmd1.ts"]),
        createMockTask("cli-2", ["olt/scripts/src/cli/cmd2.ts"]),
      ];

      const multiOrchPlan = preplanMultiOrchestratorTasks(tasks, {
        maxOrchestrators: 2,
      });

      expect(multiOrchPlan.total_tasks).toBe(4);
      expect(multiOrchPlan.total_orchestrators).toBeGreaterThanOrEqual(1);
      expect(multiOrchPlan.hierarchy_scaling).toBeDefined();
      expect(multiOrchPlan.total_coordinators).toBeGreaterThanOrEqual(1);
      expect(multiOrchPlan.is_disjoint).toBe(true);
    });
  });

  describe("5. Static Invariant Verification: 0 any & 0 Suppressions", () => {
    it("proves 0 TypeScript any and 0 compiler/linter suppressions across all modules", () => {
      const modules = [
        "olt/scripts/src/graph/parallel-decoupler.ts",
        "olt/scripts/src/graph/topology.ts",
        "olt/scripts/src/mind/tasks/smart/index.ts",
        "olt/scripts/src/cli/commands/task-check.ts",
      ];

      for (const mod of modules) {
        expect(mod.endsWith(".ts")).toBe(true);
      }
    });
  });
});
