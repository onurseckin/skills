import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  assertAntiSerializationInterlock,
  evaluateHierarchyScaling,
  FALSE_SERIALIZATION_DEFECT,
  FAST_PATH_TASK_COUNT,
  formatParallelSubagentsDispatchArray,
  inferStackOrDomain,
  isFastPathCompactionEligible,
  MAX_LANES_PER_COORDINATOR,
  partitionDynamicLanes,
  partitionWaveCoordinators,
  verifyAntiSerializationInterlock,
  type DynamicLaneTaskInput,
} from "../../../../olt/scripts/src/graph/parallel-decoupler.ts";

describe("Anti-Serialization Interlock Verification", () => {
  test("passes interlock when single task or zero tasks are ready", () => {
    const singleResult = verifyAntiSerializationInterlock(1, 1);
    expect(singleResult.passed).toBe(true);
    expect(singleResult.readyLanesCount).toBe(1);
    expect(singleResult.dispatchedCount).toBe(1);
    expect(singleResult.violation).toBeUndefined();

    const emptyResult = verifyAntiSerializationInterlock([], 0);
    expect(emptyResult.passed).toBe(true);
    expect(emptyResult.readyLanesCount).toBe(0);
    expect(emptyResult.violation).toBeUndefined();
  });

  test("passes interlock when all ready lanes are fully dispatched", () => {
    const tasks: readonly DynamicLaneTaskInput[] = [
      { id: "task-1", writeScope: ["src/a.ts"] },
      { id: "task-2", writeScope: ["src/b.ts"] },
      { id: "task-3", writeScope: ["src/c.ts"] },
    ];
    const result = verifyAntiSerializationInterlock(tasks, 3);
    expect(result.passed).toBe(true);
    expect(result.readyLanesCount).toBe(3);
    expect(result.dispatchedCount).toBe(3);
    expect(result.violation).toBeUndefined();
  });

  test("fails interlock when multiple ready disjoint lanes are under-dispatched", () => {
    const tasks: readonly DynamicLaneTaskInput[] = [
      { id: "lane-alpha", writeScope: ["src/alpha.ts"], effort: 1 },
      { id: "lane-beta", writeScope: ["src/beta.ts"], effort: 1 },
      { id: "lane-gamma", writeScope: ["src/gamma.ts"], effort: 1 },
    ];
    const result = verifyAntiSerializationInterlock(tasks, 1);
    expect(result.passed).toBe(false);
    expect(result.readyLanesCount).toBe(3);
    expect(result.dispatchedCount).toBe(1);
    expect(result.violation).toBeDefined();
    expect(result.violation?.code).toBe(FALSE_SERIALIZATION_DEFECT);
    expect(result.violation?.readyTaskIds).toEqual(["lane-alpha", "lane-beta", "lane-gamma"]);
    expect(result.violation?.recommendedDispatchArray).toHaveLength(3);
  });

  test("assertAntiSerializationInterlock passes for valid concurrency and throws HarnessError on defect", () => {
    const validTasks = ["task-1", "task-2"];
    expect(() => assertAntiSerializationInterlock(validTasks, 2)).not.toThrow();

    expect(() => assertAntiSerializationInterlock(validTasks, 1)).toThrow(HarnessError);
    try {
      assertAntiSerializationInterlock(validTasks, 1);
    } catch (err) {
      expect(err instanceof HarnessError).toBe(true);
      if (err instanceof HarnessError) {
        expect(err.code).toBe("INVALID_STATE");
        expect(err.message).toContain(FALSE_SERIALIZATION_DEFECT);
      }
    }
  });

  test("formats parallel subagent dispatch items accurately with custom options", () => {
    const rawTasks = [
      {
        id: "ui-component",
        title: "Button Component",
        writeScope: ["src/ui/button.tsx"],
        zero_exploration_prompt: "Implement button component in src/ui/button.tsx",
      },
      {
        taskId: "db-migration",
        label: "User Schema",
        write_scope: ["src/db/user.sql"],
      },
      "plain-task-string",
    ];

    const dispatchArray = formatParallelSubagentsDispatchArray(rawTasks, {
      defaultTypeName: "worker_agent",
      defaultWorkspace: "/repo",
      rolePrefix: "Lane",
      basePromptTemplate: "Execute task in isolation",
    });

    expect(dispatchArray).toHaveLength(3);
    expect(dispatchArray[0]?.TypeName).toBe("worker_agent");
    expect(dispatchArray[0]?.Role).toBe("Lane 1: Button Component");
    expect(dispatchArray[0]?.Prompt).toBe("Implement button component in src/ui/button.tsx");
    expect(dispatchArray[0]?.Workspace).toBe("/repo");

    expect(dispatchArray[1]?.Role).toBe("Lane 2: User Schema");
    expect(dispatchArray[1]?.Prompt).toBe("Execute task in isolation");

    expect(dispatchArray[2]?.Role).toBe("Lane 3: plain-task-string");
  });
});

describe("Hierarchy Scaling & Fast-Path Compaction", () => {
  test("evaluates fast path compaction for single task", () => {
    expect(isFastPathCompactionEligible(1)).toBe(true);
    expect(isFastPathCompactionEligible(["lone-task"])).toBe(true);
    expect(isFastPathCompactionEligible(0)).toBe(false);
    expect(isFastPathCompactionEligible(2)).toBe(false);
    expect(isFastPathCompactionEligible([])).toBe(false);

    const scaling = evaluateHierarchyScaling({ taskCount: FAST_PATH_TASK_COUNT });
    expect(scaling.path).toBe("fast_path_compaction");
    expect(scaling.fastPath).toBe(true);
    expect(scaling.isMultiCoordinator).toBe(false);
    expect(scaling.requiredCoordinators).toBe(0);
    expect(scaling.optimalLanes).toBe(1);
  });

  test("evaluates standard coordinator for manageable lane counts", () => {
    const scaling = evaluateHierarchyScaling({ taskCount: 4, waveLanes: 4 });
    expect(scaling.path).toBe("standard_coordinator");
    expect(scaling.fastPath).toBe(false);
    expect(scaling.isMultiCoordinator).toBe(false);
    expect(scaling.requiredCoordinators).toBe(1);
    expect(scaling.optimalLanes).toBe(4);
  });

  test("expands to multi-coordinator hierarchy when exceeding max lanes per coordinator", () => {
    const scaling = evaluateHierarchyScaling({
      taskCount: 12,
      waveLanes: 12,
      maxLanesPerCoordinator: MAX_LANES_PER_COORDINATOR,
    });
    expect(scaling.path).toBe("multi_coordinator_expansion");
    expect(scaling.fastPath).toBe(false);
    expect(scaling.isMultiCoordinator).toBe(true);
    expect(scaling.requiredCoordinators).toBe(3);
    expect(scaling.optimalLanes).toBe(12);
  });

  test("triggers multi-coordinator hierarchy on multiStack or multiple domains", () => {
    const multiStackScaling = evaluateHierarchyScaling({ taskCount: 3, multiStack: true });
    expect(multiStackScaling.path).toBe("multi_coordinator_expansion");
    expect(multiStackScaling.isMultiCoordinator).toBe(true);
    expect(multiStackScaling.requiredCoordinators).toBe(2);

    const multiDomainScaling = evaluateHierarchyScaling({ taskCount: 3, domainCount: 3 });
    expect(multiDomainScaling.path).toBe("multi_coordinator_expansion");
    expect(multiDomainScaling.isMultiCoordinator).toBe(true);
    expect(multiDomainScaling.requiredCoordinators).toBe(2);
  });
});

describe("Stack & Domain Inference", () => {
  test("infers appropriate technical domains from file paths and scopes", () => {
    expect(inferStackOrDomain("src/components/Header.tsx")).toBe("ui");
    expect(inferStackOrDomain("styles/main.css")).toBe("ui");
    expect(inferStackOrDomain(["src/cli/command.ts"])).toBe("cli");
    expect(inferStackOrDomain("src/db/schema.sql")).toBe("database");
    expect(inferStackOrDomain("prisma/schema.prisma")).toBe("database");
    expect(inferStackOrDomain("src/graph/topology.ts")).toBe("core");
    expect(inferStackOrDomain("src/engine/runner.ts")).toBe("core");
    expect(inferStackOrDomain("services/processor.py")).toBe("python");
    expect(inferStackOrDomain("native/engine.rs")).toBe("rust");
    expect(inferStackOrDomain("backend/server.go")).toBe("go");
    expect(inferStackOrDomain("utils/helper.ts")).toBe("typescript");
    expect(inferStackOrDomain("unknown/resource.xyz")).toBe("core");
  });
});

describe("Concurrent Wave & Multi-Coordinator Partitioning", () => {
  test("partitions wave tasks into distinct coordinator chunks", () => {
    const tasks = [
      { id: "task-ui-1", writeScope: ["src/ui/a.tsx"] },
      { id: "task-ui-2", writeScope: ["src/ui/b.tsx"] },
      { id: "task-cli-1", writeScope: ["src/cli/run.ts"] },
      { id: "task-cli-2", writeScope: ["src/cli/config.ts"] },
      { id: "task-db-1", writeScope: ["src/db/migration.sql"] },
      { id: "task-db-2", writeScope: ["src/db/client.ts"] },
      { id: "task-core-1", writeScope: ["src/core/state.ts"] },
    ];

    const result = partitionWaveCoordinators(tasks, {
      maxLanesPerCoordinator: 3,
      waveIndex: 1,
    });

    expect(result.waveIndex).toBe(1);
    expect(result.totalLanes).toBe(7);
    expect(result.coordinatorCount).toBe(3);
    expect(result.isMultiCoordinator).toBe(true);
    expect(result.partitions).toHaveLength(3);

    expect(result.partitions[0]?.taskIds).toEqual(["task-ui-1", "task-ui-2", "task-cli-1"]);
    expect(result.partitions[0]?.domainOrStack).toBe("ui");
    expect(result.partitions[0]?.laneIndices).toEqual([0, 1, 2]);

    expect(result.partitions[1]?.taskIds).toEqual(["task-cli-2", "task-db-1", "task-db-2"]);
    expect(result.partitions[1]?.laneIndices).toEqual([3, 4, 5]);

    expect(result.partitions[2]?.taskIds).toEqual(["task-core-1"]);
    expect(result.partitions[2]?.domainOrStack).toBe("core");
    expect(result.partitions[2]?.laneIndices).toEqual([6]);
  });

  test("respects domain hints when partitioning wave coordinators", () => {
    const tasks = ["task-alpha", "task-beta"];
    const hints: Readonly<Record<string, string>> = {
      "task-alpha": "ui",
      "task-beta": "database",
    };

    const result = partitionWaveCoordinators(tasks, {
      domainHints: hints,
      maxLanesPerCoordinator: 5,
    });

    expect(result.totalLanes).toBe(2);
    expect(result.coordinatorCount).toBe(1);
    expect(result.isMultiCoordinator).toBe(false);
    expect(result.partitions[0]?.domainOrStack).toBe("ui");
    expect(result.partitions[0]?.taskIds).toEqual(["task-alpha", "task-beta"]);
  });

  test("partitions dynamic lanes and computes metrics across waves", () => {
    const tasks: readonly DynamicLaneTaskInput[] = [
      { id: "w0-t1", writeScope: ["src/a.ts"], effort: 2, dependencies: [] },
      { id: "w0-t2", writeScope: ["src/b.ts"], effort: 2, dependencies: [] },
      { id: "w1-t1", writeScope: ["src/c.ts"], effort: 3, dependencies: ["w0-t1", "w0-t2"] },
    ];

    const result = partitionDynamicLanes(tasks, 10);
    expect(result.lanes).toHaveLength(3);
    expect(result.waves).toHaveLength(2);
    expect(result.optimalLanes).toBe(2);
    expect(result.metrics.totalWork).toBe(7);
    expect(result.metrics.criticalSpan).toBe(5);

    const wave0Tasks = result.lanes.filter((l) => l.waveIndex === 0);
    const wave1Tasks = result.lanes.filter((l) => l.waveIndex === 1);
    expect(wave0Tasks).toHaveLength(2);
    expect(wave1Tasks).toHaveLength(1);
    expect(wave1Tasks[0]?.taskId).toBe("w1-t1");
  });
});
