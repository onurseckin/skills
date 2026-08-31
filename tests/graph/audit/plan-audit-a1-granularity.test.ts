import { describe, expect, test } from "bun:test";
import { auditPlan } from "../../../olt/scripts/src/graph/plan-audit.ts";
import { fixtureRepo, task } from "./plan-audit-fixture.ts";

describe("A1-granularity", () => {
  test("blocks a task whose scope expands past 3 files while the plan touches 5+", () => {
    const repo = fixtureRepo();
    const result = auditPlan(repo, [
      task({
        taskId: "task-monolith",
        writeScope: [
          "src/monolith/a.ts",
          "src/monolith/b.ts",
          "src/monolith/c.ts",
          "src/monolith/d.ts",
        ],
      }),
      task({ taskId: "task-small", writeScope: ["src/small/only.ts"] }),
    ]);
    const finding = result.findings.find((f) => f.invariant === "A1-granularity");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocking");
    expect(finding?.task_ids).toEqual(["task-monolith"]);
    expect(finding?.evidence_class).toBe("harness_observed");
  });

  test("stays silent when the plan touches fewer than 5 files total", () => {
    const repo = fixtureRepo();
    const result = auditPlan(repo, [
      task({
        taskId: "task-tiny",
        writeScope: ["src/tiny/a.ts", "src/tiny/b.ts", "src/tiny/c.ts", "src/tiny/d.ts"],
      }),
    ]);
    expect(result.findings.some((f) => f.invariant === "A1-granularity")).toBe(false);
  });

  test("stays silent when no single task carries more than 3 files", () => {
    const repo = fixtureRepo();
    const result = auditPlan(
      repo,
      ["a", "b", "c", "d", "e"].map((letter) =>
        task({ taskId: `task-${letter}`, writeScope: [`src/${letter}/one.ts`] }),
      ),
    );
    expect(result.findings.some((f) => f.invariant === "A1-granularity")).toBe(false);
  });
});
