import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditPlan } from "../../../orchestrating-long-tasks/scripts/src/graph/plan-audit.ts";
import { cleanupFixtureRoots, fixtureRepo, task } from "./plan-audit-fixture.ts";

const roots: string[] = [];
afterAll(() => cleanupFixtureRoots(roots));

describe("A1-granularity", () => {
  test("blocks a task whose scope expands past 3 files while the plan touches 5+", () => {
    const repo = fixtureRepo(roots);
    mkdirSync(join(repo, "src/monolith"), { recursive: true });
    for (const name of ["a.ts", "b.ts", "c.ts", "d.ts"]) {
      writeFileSync(join(repo, "src/monolith", name), "");
    }
    mkdirSync(join(repo, "src/small"), { recursive: true });
    writeFileSync(join(repo, "src/small/only.ts"), "");

    const result = auditPlan(repo, [
      task({ taskId: "task-monolith", writeScope: ["src/monolith"] }),
      task({ taskId: "task-small", writeScope: ["src/small"] }),
    ]);
    const finding = result.findings.find((f) => f.invariant === "A1-granularity");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocking");
    expect(finding?.task_ids).toEqual(["task-monolith"]);
    expect(finding?.evidence_class).toBe("harness_observed");
  });

  test("stays silent when the plan touches fewer than 5 files total", () => {
    const repo = fixtureRepo(roots);
    mkdirSync(join(repo, "src/tiny"), { recursive: true });
    for (const name of ["a.ts", "b.ts", "c.ts", "d.ts"]) {
      writeFileSync(join(repo, "src/tiny", name), "");
    }
    const result = auditPlan(repo, [task({ taskId: "task-tiny", writeScope: ["src/tiny"] })]);
    expect(result.findings.some((f) => f.invariant === "A1-granularity")).toBe(false);
  });

  test("stays silent when no single task carries more than 3 files", () => {
    const repo = fixtureRepo(roots);
    for (const dir of ["src/a", "src/b", "src/c", "src/d", "src/e"]) {
      mkdirSync(join(repo, dir), { recursive: true });
      writeFileSync(join(repo, dir, "one.ts"), "");
    }
    const result = auditPlan(
      repo,
      ["a", "b", "c", "d", "e"].map((letter) =>
        task({ taskId: `task-${letter}`, writeScope: [`src/${letter}`] }),
      ),
    );
    expect(result.findings.some((f) => f.invariant === "A1-granularity")).toBe(false);
  });
});
