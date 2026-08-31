import { describe, expect, test } from "bun:test";
import {
  allocateParallelLanes,
  partitionDynamicLanes,
} from "../../../olt/scripts/src/graph/parallel-decoupler.ts";

describe("parallel-decoupler: partitionDynamicLanes", () => {
  test("partitions tasks using inline dependencies and default options", () => {
    const tasks = [
      { taskId: "t1", writeScope: ["src/a.ts"], effort: 2, dependencies: [] },
      { taskId: "t2", writeScope: ["src/b.ts"], effort: 2, dependencies: [] },
      { taskId: "t3", writeScope: ["src/c.ts"], effort: 2, dependencies: ["t1", "t2"] },
    ];

    const result = partitionDynamicLanes(tasks, 10);
    expect(result.lanes).toHaveLength(3);
    expect(result.waves).toHaveLength(2);
    expect(result.metrics.parallelismFactor).toBe(1.5);
    expect(result.optimalLanes).toBe(2);

    const wave0 = result.lanes.filter((l) => l.waveIndex === 0);
    const wave1 = result.lanes.filter((l) => l.waveIndex === 1);
    expect(wave0).toHaveLength(2);
    expect(wave1).toHaveLength(1);
    expect(wave0.map((l) => l.laneIndex)).toEqual([0, 1]);
    expect(wave1[0]!.laneIndex).toBe(0);
  });

  test("partitions tasks using explicit dependency map", () => {
    const tasks = [
      { id: "x1", write_scope: ["src/x1.ts"], effort: 1 },
      { id: "x2", write_scope: ["src/x2.ts"], effort: 1 },
      { id: "x3", write_scope: ["src/x3.ts"], effort: 1 },
    ];
    const deps = new Map([
      ["x1", new Set<string>()],
      ["x2", new Set<string>()],
      ["x3", new Set<string>()],
    ]);

    const result = partitionDynamicLanes(tasks, deps, 40);
    expect(result.lanes).toHaveLength(3);
    expect(result.waves).toHaveLength(1);
    expect(result.optimalLanes).toBe(3);
    expect(result.lanes.map((l) => l.laneIndex)).toEqual([0, 1, 2]);
  });
});

describe("parallel-decoupler: allocateParallelLanes", () => {
  test("allocates 40 tasks into 40 distinct concurrent lanes in single wave", () => {
    const tasks = Array.from({ length: 40 }, (_, i) => ({
      taskId: `task-${i + 1}`,
      writeScope: [`src/module-${i + 1}.ts`],
      dependencies: [],
    }));
    const dependencies = new Map(tasks.map((t) => [t.taskId, new Set<string>()]));

    const lanes = allocateParallelLanes(tasks, dependencies, 40);
    expect(lanes).toHaveLength(40);
    const assignedLanes = new Set(lanes.map((l) => l.laneIndex));
    expect(assignedLanes.size).toBe(40);
    for (let i = 0; i < 40; i++) {
      expect(assignedLanes.has(i)).toBe(true);
    }
  });

  test("allocates multi-wave dependencies across lanes with modulo wrapping", () => {
    const tasks = [
      { taskId: "t1", writeScope: ["src/a"], dependencies: [] },
      { taskId: "t2", writeScope: ["src/b"], dependencies: [] },
      { taskId: "t3", writeScope: ["src/c"], dependencies: [] },
      { taskId: "t4", writeScope: ["src/d"], dependencies: ["t1", "t2", "t3"] },
    ];
    const dependencies = new Map([
      ["t1", new Set<string>()],
      ["t2", new Set<string>()],
      ["t3", new Set<string>()],
      ["t4", new Set(["t1", "t2", "t3"])],
    ]);

    const lanes = allocateParallelLanes(tasks, dependencies, 2);
    expect(lanes).toHaveLength(4);
    const wave0Lanes = lanes.filter((l) => l.waveIndex === 0);
    const wave1Lanes = lanes.filter((l) => l.waveIndex === 1);
    expect(wave0Lanes).toHaveLength(3);
    expect(wave1Lanes).toHaveLength(1);
    expect(wave0Lanes.map((l) => l.laneIndex)).toEqual([0, 1, 0]);
    expect(wave1Lanes[0]!.taskId).toBe("t4");
    expect(wave1Lanes[0]!.laneIndex).toBe(0);
  });
});
