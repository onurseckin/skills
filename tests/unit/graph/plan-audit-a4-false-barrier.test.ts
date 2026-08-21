import { afterAll, describe, expect, test } from "bun:test";
import { auditPlan } from "../../../orchestrating-long-tasks/scripts/src/graph/plan-audit.ts";
import { cleanupFixtureRoots, fixtureRepo, task } from "./plan-audit-fixture.ts";

const roots: string[] = [];
afterAll(() => cleanupFixtureRoots(roots));

describe("A4-false-barrier", () => {
  test("blocks a dependency edge whose child's scope shares nothing with the parent's", () => {
    const result = auditPlan(fixtureRepo(roots), [
      task({ taskId: "task-a", writeScope: ["src/a"] }),
      task({ taskId: "task-b", writeScope: ["src/b"], deps: ["task-a"] }),
    ]);
    const finding = result.findings.find((f) => f.invariant === "A4-false-barrier");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocking");
    expect(finding?.task_ids).toEqual(["task-b", "task-a"]);
  });

  test("stays silent when the dependent task's scope actually overlaps the parent's", () => {
    const result = auditPlan(fixtureRepo(roots), [
      task({ taskId: "task-a", writeScope: ["src/shared"] }),
      task({ taskId: "task-b", writeScope: ["src/shared/inner"], deps: ["task-a"] }),
    ]);
    expect(result.findings.some((f) => f.invariant === "A4-false-barrier")).toBe(false);
  });
});
