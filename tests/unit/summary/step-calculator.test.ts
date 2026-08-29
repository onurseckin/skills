import { describe, expect, test } from "bun:test";
import { computeExecutionSteps } from "../../../olt/scripts/src/summary/metrics/index.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";

function createTask(id: string, dependencies: string[] = []): TaskRecord {
  return {
    id,
    label: `Task ${id}`,
    status: "ready",
    requirement_ids: [],
    write_scope: [],
    dependencies,
    attempts: [],
    history: [],
    repair_round: 0,
  };
}

describe("step calculator", () => {
  test("assigns steps correctly for linear pipeline", () => {
    const tasks = [createTask("T-1", []), createTask("T-2", ["T-1"]), createTask("T-3", ["T-2"])];

    const result = computeExecutionSteps(tasks);
    expect(result.taskSteps.get("T-1")).toBe(2);
    expect(result.taskWaves.get("T-1")).toBe(1);

    expect(result.taskSteps.get("T-2")).toBe(4);
    expect(result.taskWaves.get("T-2")).toBe(2);

    expect(result.taskSteps.get("T-3")).toBe(6);
    expect(result.taskWaves.get("T-3")).toBe(3);

    expect(result.criticStep).toBe(8);
    expect(result.terminalStep).toBe(9);
  });

  test("assigns concurrent tasks in same wave to same step", () => {
    const tasks = [createTask("T-A", []), createTask("T-B", []), createTask("T-C", ["T-A", "T-B"])];

    const result = computeExecutionSteps(tasks);
    expect(result.taskSteps.get("T-A")).toBe(2);
    expect(result.taskSteps.get("T-B")).toBe(2);
    expect(result.taskWaves.get("T-A")).toBe(1);
    expect(result.taskWaves.get("T-B")).toBe(1);

    expect(result.taskSteps.get("T-C")).toBe(4);
    expect(result.taskWaves.get("T-C")).toBe(2);
  });

  test("handles empty tasks list", () => {
    const result = computeExecutionSteps([]);
    expect(result.taskSteps.size).toBe(0);
    expect(result.criticStep).toBe(4);
    expect(result.terminalStep).toBe(5);
  });
});

function topologyState(waves: { wave: number; task_ids: string[] }[], revision = 4): unknown {
  return {
    topology: {
      revision,
      max_parallel: 2,
      waves,
      decisions: waves.flatMap((entry) =>
        entry.task_ids.map((taskId) => ({
          task_id: taskId,
          wave: entry.wave,
          parallel_with: entry.task_ids.filter((id) => id !== taskId),
          serialized_after: [],
          reason: "priority_capacity",
          rationale: `wave ${entry.wave}`,
          evidence_class: "derived",
        })),
      ),
    },
  };
}

describe("step calculator topology source", () => {
  test("obeys recorded waves even when dependencies alone would parallelize", () => {
    const tasks = [createTask("T-A"), createTask("T-B")];
    const state = topologyState([
      { wave: 1, task_ids: ["T-A"] },
      { wave: 2, task_ids: ["T-B"] },
    ]);

    expect(computeExecutionSteps(tasks).taskWaves.get("T-B")).toBe(1);

    const recorded = computeExecutionSteps(tasks, state);
    expect(recorded.taskWaves.get("T-A")).toBe(1);
    expect(recorded.taskWaves.get("T-B")).toBe(2);
    expect(recorded.taskSteps.get("T-B")).toBe(4);
    expect(recorded.criticStep).toBe(6);
    expect(recorded.terminalStep).toBe(7);
    expect(recorded.waveSource).toEqual({ value: "recorded", evidence_class: "derived" });
    expect(recorded.topologyRevision).toBe(4);
  });

  test("flags the dependency-only fallback as an estimate", () => {
    const tasks = [createTask("T-A"), createTask("T-B", ["T-A"])];

    for (const state of [undefined, {}, { topology: { revision: 1 } }]) {
      const steps = computeExecutionSteps(tasks, state);
      expect(steps.waveSource).toEqual({
        value: "derived",
        evidence_class: "derived",
        is_estimated: true,
      });
      expect(steps.topologyRevision).toBeNull();
      expect(steps.taskWaves.get("T-B")).toBe(2);
    }
  });

  test("a topology that misses a task is not stretched to cover it", () => {
    const tasks = [createTask("T-A"), createTask("T-B"), createTask("T-C")];
    const steps = computeExecutionSteps(
      tasks,
      topologyState([
        { wave: 1, task_ids: ["T-A"] },
        { wave: 2, task_ids: ["T-B"] },
      ]),
    );

    expect(steps.waveSource.is_estimated).toBeTrue();
    expect(steps.taskWaves.get("T-C")).toBe(1);
    expect(steps.taskWaves.get("T-B")).toBe(1);
  });

  test("a dependency cycle with no zero-dependency task starts every task in wave 1", () => {
    const tasks = [createTask("T-A", ["T-B"]), createTask("T-B", ["T-A"])];

    const steps = computeExecutionSteps(tasks);
    expect(steps.taskWaves.get("T-A")).toBe(1);
    expect(steps.taskWaves.get("T-B")).toBe(1);
    expect(steps.waveSource.is_estimated).toBeTrue();
  });

  test("a task depending on an id absent from the task list is deferred to a later wave", () => {
    const tasks = [createTask("T-A"), createTask("T-C", ["T-ghost"])];

    const steps = computeExecutionSteps(tasks);
    expect(steps.taskWaves.get("T-A")).toBe(1);
    expect(steps.taskWaves.get("T-C")).toBe(2);
  });

  test("a capsule recorded before topology existed derives its waves", () => {
    // The exact task graph (three tasks, a strict dependency chain, no `topology` key) a real
    // pre-topology capsule on this machine once recorded — hand-built here rather than loaded from
    // that `.capsules/` directory, which is gitignored scratch and absent on a fresh checkout or CI.
    const tasks = [
      createTask("task-1"),
      createTask("task-2", ["task-1"]),
      createTask("task-3", ["task-2"]),
    ];
    const state = { tasks: Object.fromEntries(tasks.map((task) => [task.id, task])) };

    const steps = computeExecutionSteps(tasks, state);
    expect(steps.taskWaves.get("task-1")).toBe(1);
    expect(steps.taskWaves.get("task-3")).toBe(3);
    expect(steps.waveSource.is_estimated).toBeTrue();
  });
});
