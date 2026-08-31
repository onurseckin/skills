import { describe, expect, test } from "bun:test";
import { checkPlanningDag } from "../../olt/scripts/src/reporting/doctor/planning-dag-engine.ts";

describe("Wave 2 - Task 2.2: Planning DAG Engine", () => {
  test("passes cleanly on valid DAG with multiple tasks", () => {
    const result = checkPlanningDag({
      tasks: {
        t1: { id: "t1", dependencies: [] },
        t2: { id: "t2", dependencies: ["t1"] },
        t3: { id: "t3", dependencies: ["t2"] },
      },
    });
    expect(result.passed).toBe(true);
    expect(result.findings.filter((f) => f.severity === "ERROR")).toHaveLength(0);
  });

  test("detects circular dependency cycles using Tarjan algorithm", () => {
    const result = checkPlanningDag({
      tasks: {
        t1: { id: "t1", dependencies: ["t3"] },
        t2: { id: "t2", dependencies: ["t1"] },
        t3: { id: "t3", dependencies: ["t2"] },
      },
    });
    expect(result.passed).toBe(false);
    const cycleFinding = result.findings.find((f) => f.code === "PLANNING_DAG_CYCLE_DETECTED");
    expect(cycleFinding).toBeDefined();
    expect(cycleFinding?.severity).toBe("ERROR");
  });

  test("detects self-loop circular dependency", () => {
    const result = checkPlanningDag({
      tasks: {
        t_loop: { id: "t_loop", dependencies: ["t_loop"] },
      },
    });
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.code === "PLANNING_DAG_CYCLE_DETECTED")).toBe(true);
  });

  test("detects missing dependency reference", () => {
    const result = checkPlanningDag({
      tasks: {
        t1: { id: "t1", dependencies: ["t_nonexistent"] },
      },
    });
    expect(result.passed).toBe(false);
    const missing = result.findings.find((f) => f.code === "PLANNING_DAG_MISSING_DEPENDENCY");
    expect(missing).toBeDefined();
    expect(missing?.severity).toBe("ERROR");
  });

  test("flags orphan tasks as warnings", () => {
    const result = checkPlanningDag({
      tasks: {
        t1: { id: "t1", dependencies: [] },
        t2: { id: "t2", dependencies: ["t1"] },
        t_orphan: { id: "t_orphan", dependencies: [] },
      },
    });
    const orphan = result.findings.find((f) => f.code === "PLANNING_DAG_ORPHAN_TASK");
    expect(orphan).toBeDefined();
    expect(orphan?.severity).toBe("WARN");
  });
});
