import { describe, expect, it } from "bun:test";
import { preplanMultiOrchestratorTasks } from "../../../olt/scripts/src/mind/tasks/smart/executor/execution.ts";
import type { SmartTaskPlan } from "../../../olt/scripts/src/mind/tasks/smart/planner/models.ts";

function makeTask(
  id: string,
  writeScope: readonly string[] = [],
  dependencies: readonly string[] = [],
  effort: number = 1,
): SmartTaskPlan {
  return {
    id,
    label: `Task ${id}`,
    write_scope: writeScope,
    gate: "bun test",
    charter_goals: ["goal-1"],
    acceptance_criteria: ["Pass gate"],
    dependencies,
    source_type: "queue_backlog",
    effort,
    rationale: `Rationale for ${id}`,
  };
}

describe("Execution Multi-Orchestrator Planning Suite (execution.ts)", () => {
  it("returns zeroed macro metrics and empty list when task list is empty", () => {
    const resNum = preplanMultiOrchestratorTasks([], 3);
    expect(resNum.total_tasks).toBe(0);
    expect(resNum.total_orchestrators).toBe(0);
    expect(resNum.orchestrators).toEqual([]);
    expect(resNum.is_disjoint).toBe(true);
    expect(resNum.macro_metrics).toEqual({ work: 0, span: 0, parallelism: 0, efficiency: 0 });

    const resArr = preplanMultiOrchestratorTasks([], []);
    expect(resArr.total_tasks).toBe(0);

    const resObj = preplanMultiOrchestratorTasks([], { autoUpdateMemory: true });
    expect(resObj.total_tasks).toBe(0);
  });

  it("handles numeric options including zero and negative clamping", () => {
    const tasks = [makeTask("t1", ["src/a.ts"])];
    const resPositive = preplanMultiOrchestratorTasks(tasks, 4);
    expect(resPositive.total_tasks).toBe(1);
    expect(resPositive.orchestrators.length).toBe(1);

    const resZero = preplanMultiOrchestratorTasks(tasks, 0);
    expect(resZero.orchestrators.length).toBe(1);

    const resNegative = preplanMultiOrchestratorTasks(tasks, -5);
    expect(resNegative.orchestrators.length).toBe(1);
  });

  it("handles array options with custom IDs or fallback default", () => {
    const tasks = [makeTask("t1", ["src/a.ts"], [], 2), makeTask("t2", ["src/b.ts"], [], 3)];
    const resCustom = preplanMultiOrchestratorTasks(tasks, ["orch-alpha", "orch-beta"]);
    expect(resCustom.orchestrators.length).toBe(2);
    expect(resCustom.orchestrators[0]!.orchestrator_id).toBe("orch-alpha");
    expect(resCustom.orchestrators[1]!.orchestrator_id).toBe("orch-beta");

    const resEmptyArr = preplanMultiOrchestratorTasks(tasks, []);
    expect(resEmptyArr.orchestrators.length).toBe(1);
    expect(resEmptyArr.orchestrators[0]!.orchestrator_id).toBe("orchestrator-1");
  });

  it("handles object options with orchestratorIds, maxOrchestrators, or default clamp", () => {
    const tasks = [
      makeTask("t1", ["src/a.ts"]),
      makeTask("t2", ["src/b.ts"]),
      makeTask("t3", ["src/c.ts"]),
      makeTask("t4", ["src/d.ts"]),
      makeTask("t5", ["src/e.ts"]),
    ];

    const resIds = preplanMultiOrchestratorTasks(tasks, {
      orchestratorIds: ["custom-1", "custom-2", "custom-3"],
    });
    expect(resIds.orchestrators.length).toBe(3);

    const resMax = preplanMultiOrchestratorTasks(tasks, {
      maxOrchestrators: 2,
    });
    expect(resMax.orchestrators.length).toBe(2);

    const resDefault = preplanMultiOrchestratorTasks(tasks, {});
    expect(resDefault.orchestrators.length).toBe(4);
  });

  it("clusters tasks by direct dependency and multi-hop dependency chains", () => {
    const t1 = makeTask("t1", ["src/a.ts"], [], 3);
    const t2 = makeTask("t2", ["src/b.ts"], ["t1"], 2);
    const t3 = makeTask("t3", ["src/c.ts"], ["t2"], 1);
    const t4 = makeTask("t4", ["src/d.ts"], ["non-existent-dep"], 4);

    const result = preplanMultiOrchestratorTasks([t1, t2, t3, t4], 2);
    expect(result.total_tasks).toBe(4);
    expect(result.orchestrators.length).toBe(2);

    const orch1 = result.orchestrators.find((o) => o.tasks.some((t) => t.id === "t1"));
    expect(orch1).toBeDefined();
    expect(orch1?.tasks.map((t) => t.id)).toContain("t2");
    expect(orch1?.tasks.map((t) => t.id)).toContain("t3");
  });

  it("clusters tasks by write_scope overlap and sorts clusters by work", () => {
    const t1 = makeTask("t1", ["src/shared.ts"], [], 5);
    const t2 = makeTask("t2", ["src/shared.ts"], [], 0);
    const t3 = makeTask("t3", ["src/other.ts"], [], -2);

    const result = preplanMultiOrchestratorTasks([t1, t2, t3], 2);
    expect(result.total_tasks).toBe(3);
    expect(result.orchestrators.length).toBe(2);
    expect(result.is_disjoint).toBe(true);
    expect(result.cross_orchestrator_collisions).toEqual([]);
    expect(result.macro_metrics.work).toBe(7);
  });

  it("handles autoUpdateMemory flag cleanly with valid or invalid path", () => {
    const tasks = [makeTask("t1", ["src/a.ts"])];
    const res = preplanMultiOrchestratorTasks(tasks, {
      autoUpdateMemory: true,
      cognitiveMemoryPath: "/tmp/non-existent-dir/memory.json",
    });
    expect(res.total_tasks).toBe(1);
    expect(res.macro_metrics.work).toBeGreaterThanOrEqual(1);
  });

  it("computes aggregate macro metrics, lane efficiency, and coordinator hierarchy", () => {
    const tasks = [
      makeTask("t1", ["src/a.ts"], [], 4),
      makeTask("t2", ["src/b.ts"], [], 4),
      makeTask("t3", ["src/c.ts"], [], 4),
    ];
    const result = preplanMultiOrchestratorTasks(tasks, 3);
    expect(result.macro_metrics.work).toBe(12);
    expect(result.macro_metrics.span).toBe(4);
    expect(result.macro_metrics.parallelism).toBe(3);
    expect(result.macro_metrics.efficiency).toBe(1);
    expect(result.hierarchy_scaling).toBeDefined();
    expect(result.total_coordinators).toBeGreaterThanOrEqual(3);
  });
});
