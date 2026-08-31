import { describe, expect, test } from "bun:test";
import { detectTransitiveBypasses } from "../../../olt/scripts/src/graph/dag-expansion.ts";

describe("DAG Expansion: transitive bypass detection", () => {
  test("approves clean linear DAG without bypass shortcuts", () => {
    const nodes = [
      { id: "task-a", type: "task" },
      { id: "task-b", type: "task" },
      { id: "task-c", type: "task" },
    ];
    const edges = [
      { source: "task-b", target: "task-a", type: "depends_on" },
      { source: "task-c", target: "task-b", type: "depends_on" },
    ];

    const result = detectTransitiveBypasses(nodes, edges);
    expect(result.hasBypass).toBe(false);
    expect(result.violations).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test("detects transitive shortcut bypass and produces actionable cognitive guidance", () => {
    const nodes = [
      { id: "task-root", type: "task" },
      { id: "val-root", type: "task", role: "validator" },
      { id: "task-leaf", type: "task" },
    ];
    const edges = [
      { source: "val-root", target: "task-root", type: "depends_on" },
      { source: "task-leaf", target: "val-root", type: "depends_on" },
      { source: "task-leaf", target: "task-root", type: "depends_on" },
    ];

    const result = detectTransitiveBypasses(nodes, edges);
    expect(result.hasBypass).toBe(true);
    expect(result.violations.length).toBeGreaterThanOrEqual(1);

    const violation = result.violations[0]!;
    expect(violation.code).toBe("TRANSITIVE_BYPASS_VIOLATION");
    expect(violation.edge).toEqual({ source: "task-leaf", target: "task-root" });
    expect(violation.bypassedPath).toEqual(["task-leaf", "val-root", "task-root"]);
    expect(violation.bypassedStage).toBe("val-root");
    expect(violation.guidance.invariant).toContain("Validator Bypass Invariant");
    expect(violation.guidance.remediationAction).toContain("Remove direct bypass edge");
  });

  test("detects consumer skipping paired validator", () => {
    const nodes = [
      { id: "task-core", type: "task", role: "implementer", paired_validator_id: "val-core" },
      { id: "val-core", type: "task", role: "validator", validates_task_id: "task-core" },
      { id: "task-downstream", type: "task", role: "implementer" },
    ];
    const edges = [
      { source: "val-core", target: "task-core", type: "depends_on" },
      { source: "task-downstream", target: "task-core", type: "depends_on" },
    ];

    const result = detectTransitiveBypasses(nodes, edges);
    expect(result.hasBypass).toBe(true);
    const valBypass = result.violations.find((v) => v.bypassedStage === "val-core");
    expect(valBypass).toBeDefined();
    expect(valBypass?.guidance.summary).toContain("bypasses paired validator val-core");
  });
});
