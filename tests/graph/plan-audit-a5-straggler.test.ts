import { afterAll, describe, expect, test } from "bun:test";
import { auditPlan } from "../../olt/scripts/src/graph/plan-audit.ts";
import { cleanupFixtureRoots, fixtureRepo, task } from "./plan-audit-fixture.ts";

const roots: string[] = [];
afterAll(() => cleanupFixtureRoots(roots));

describe("A5-straggler", () => {
  test("flags a task whose effort is more than 3x its wave's median as advisory, not blocking", () => {
    const result = auditPlan(fixtureRepo(roots), [
      task({ taskId: "task-small-1", writeScope: ["src/s1"], effort: 1 }),
      task({ taskId: "task-small-2", writeScope: ["src/s2"], effort: 1 }),
      task({ taskId: "task-huge", writeScope: ["src/huge"], effort: 10 }),
    ]);
    const finding = result.findings.find((f) => f.invariant === "A5-straggler");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("advisory");
    expect(finding?.task_ids).toEqual(["task-huge"]);
  });

  test("stays silent with fewer than two effort estimates in the wave", () => {
    const result = auditPlan(fixtureRepo(roots), [
      task({ taskId: "task-only", writeScope: ["src/only"], effort: 99 }),
    ]);
    expect(result.findings.some((f) => f.invariant === "A5-straggler")).toBe(false);
  });

  test("stays silent when no task declares an effort at all", () => {
    const result = auditPlan(fixtureRepo(roots), [
      task({ taskId: "task-a", writeScope: ["src/a"] }),
      task({ taskId: "task-b", writeScope: ["src/b"] }),
    ]);
    expect(result.findings.some((f) => f.invariant === "A5-straggler")).toBe(false);
  });
});
