import { describe, expect, test } from "bun:test";
import {
  decoupleIndependentWaves,
  partitionTopologyWaves,
  synthesizeDAGTopology,
  validateTopologyAcyclicity,
} from "../../olt/scripts/src/orchestrator/topology-synthesis.ts";
import type { SynthesizedTaskSpec } from "../../olt/scripts/src/orchestrator/topology/types.ts";

describe("Domain 20: Topological Wave Decoupling", () => {
  test("decoupleIndependentWaves creates independent parallel subgraphs without transitive barriers", () => {
    // Subgraph 1: A -> B
    // Subgraph 2: C -> D (Completely independent of A and B)
    const tasks: SynthesizedTaskSpec[] = [
      { id: "task-a", writeScope: ["src/a.ts"] },
      { id: "task-b", writeScope: ["src/b.ts"], dependencies: ["task-a"] },
      { id: "task-c", writeScope: ["src/c.ts"] },
      { id: "task-d", writeScope: ["src/d.ts"], dependencies: ["task-c"] },
    ];

    const initialWaves = partitionTopologyWaves(tasks, 4);
    const independentWaves = decoupleIndependentWaves(initialWaves, tasks);

    expect(independentWaves.length).toBeGreaterThan(0);
    const wave0TaskIds = independentWaves[0]?.taskIds ?? [];
    expect(wave0TaskIds).toContain("task-a");
    expect(wave0TaskIds).toContain("task-c");

    const wave1TaskIds = independentWaves[1]?.taskIds ?? [];
    expect(wave1TaskIds).toContain("task-b");
    expect(wave1TaskIds).toContain("task-d");
  });

  test("validates acyclicity and determinism across disconnected DAG components", () => {
    const tasks: SynthesizedTaskSpec[] = [
      { id: "a1", writeScope: ["src/1/"] },
      { id: "a2", writeScope: ["src/2/"], dependencies: ["a1"] },
      { id: "b1", writeScope: ["src/3/"] },
      { id: "b2", writeScope: ["src/4/"], dependencies: ["b1"] },
    ];

    const acyclic = validateTopologyAcyclicity(tasks);
    expect(acyclic.isAcyclic).toBe(true);
    expect(acyclic.cycle).toBeUndefined();
    expect(acyclic.topologicalOrder.length).toBe(4);
  });

  test("synthesizeDAGTopology synthesizes independent waves with accurate critical path depth", () => {
    const spec = {
      tasks: [
        { id: "init", writeScope: ["src/init.ts"] },
        { id: "feat-a", writeScope: ["src/a/"], dependencies: ["init"] },
        { id: "feat-b", writeScope: ["src/b/"], dependencies: ["init"] },
        { id: "finalize", writeScope: ["src/fin.ts"], dependencies: ["feat-a", "feat-b"] },
      ],
      maxParallel: 4,
    };

    const dag = synthesizeDAGTopology(spec);

    expect(dag.isAcyclic).toBe(true);
    expect(dag.criticalPath.length).toBe(3); // init -> feat-a/b -> finalize
    expect(dag.waves.length).toBe(3);
    expect(dag.waves[0]?.taskIds).toEqual(["init"]);
    expect([...(dag.waves[1]?.taskIds ?? [])].sort()).toEqual(["feat-a", "feat-b"]);
    expect(dag.waves[2]?.taskIds).toEqual(["finalize"]);
  });
});
