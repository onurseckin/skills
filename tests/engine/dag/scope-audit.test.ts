import { describe, expect, it } from "bun:test";
import { auditScopeOverlaps } from "../../../olt/scripts/src/engine/dag/index.ts";
import type { DagTaskNode } from "../../../olt/scripts/src/engine/dag/index.ts";

describe("DAG Engine - Scope Overlap Audits", () => {
  it("detects no conflicts when write scopes are disjoint", () => {
    const tasks: DagTaskNode[] = [
      { id: "t1", dependencies: [], writeScope: ["src/auth"] },
      { id: "t2", dependencies: [], writeScope: ["src/billing"] },
    ];
    const findings = auditScopeOverlaps(tasks);
    expect(findings).toHaveLength(0);
  });

  it("detects conflict between concurrent tasks with identical scopes", () => {
    const tasks: DagTaskNode[] = [
      { id: "t1", dependencies: [], writeScope: ["src/common"] },
      { id: "t2", dependencies: [], writeScope: ["src/common"] },
    ];
    const findings = auditScopeOverlaps(tasks);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.taskA).toBe("t1");
    expect(findings[0]!.taskB).toBe("t2");
  });

  it("detects conflict between nested scope paths", () => {
    const tasks: DagTaskNode[] = [
      { id: "t1", dependencies: [], writeScope: ["src/cli"] },
      { id: "t2", dependencies: [], writeScope: ["src/cli/commands"] },
    ];
    const findings = auditScopeOverlaps(tasks);
    expect(findings).toHaveLength(1);
  });

  it("ignores overlapping scopes if tasks are sequentially serialized", () => {
    const tasks: DagTaskNode[] = [
      { id: "t1", dependencies: [], writeScope: ["src/common"] },
      { id: "t2", dependencies: ["t1"], writeScope: ["src/common"] },
    ];
    const findings = auditScopeOverlaps(tasks);
    expect(findings).toHaveLength(0);
  });
});
