import { describe, expect, it } from "bun:test";
import {
  planWaveExecution,
  detectScopeOverlap,
  type SmartTaskPlan,
} from "../../../../olt/scripts/src/mind/tasks/smart/index.ts";

describe("Smart Task Manager - Wave Partitioning & Scope Collisions", () => {
  it("detectScopeOverlap accurately flags exact matches and directory containment", () => {
    expect(detectScopeOverlap(["src/a.ts"], ["src/a.ts"]).length).toBeGreaterThan(0);
    expect(detectScopeOverlap(["src/"], ["src/a.ts"]).length).toBeGreaterThan(0);
    expect(detectScopeOverlap(["src/b.ts"], ["src/a.ts"]).length).toBe(0);
  });

  it("planWaveExecution partitions tasks into ordered topological waves", () => {
    const tasks: SmartTaskPlan[] = [
      {
        id: "T1",
        label: "Task 1",
        rationale: "R1",
        write_scope: ["src/a.ts"],
        gate: "true",
        dependencies: [],
        implementer_role: "imp",
        validator_role: "val",
      },
      {
        id: "T2",
        label: "Task 2",
        rationale: "R2",
        write_scope: ["src/b.ts"],
        gate: "true",
        dependencies: ["T1"],
        implementer_role: "imp",
        validator_role: "val",
      },
    ];
    const plan = planWaveExecution(tasks);
    expect(plan.waves.length).toBe(2);
    expect(plan.waves[0].task_ids).toEqual(["T1"]);
    expect(plan.waves[1].task_ids).toEqual(["T2"]);
  });
});
