import { describe, expect, test } from "bun:test";
import {
  advisoryFindings,
  AUDIT_INVARIANT_IDS,
  auditPlan,
  blockingFindings,
  isAuditInvariantId,
} from "../../../olt/scripts/src/graph/plan-audit.ts";
import { fixtureRepo, task } from "./plan-audit-fixture.ts";

describe("isAuditInvariantId", () => {
  test("accepts exactly the registered invariants", () => {
    for (const id of AUDIT_INVARIANT_IDS) expect(isAuditInvariantId(id)).toBe(true);
    expect(isAuditInvariantId("A9-invented")).toBe(false);
    expect(isAuditInvariantId("")).toBe(false);
  });
});

function manyLinePrompt(count: number): string {
  return Array.from({ length: count }, (_, i) => `Implement feature ${i + 1}`).join("\n");
}

describe("A2-parallelism: grounded against the prompt's non-blank line count", () => {
  test("stays not_evaluated, never guessed, when no prompt is supplied", () => {
    const result = auditPlan(fixtureRepo(), []);
    expect(result.not_evaluated).toHaveLength(1);
    expect(result.not_evaluated[0]!.invariant).toBe("A2-parallelism");
    expect(result.not_evaluated[0]!.reason.length).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.invariant === "A2-parallelism")).toBe(false);
  });

  test("stays not_evaluated for an ordinary short prompt behind a single task", () => {
    const result = auditPlan(
      fixtureRepo(),
      [task({ taskId: "task-a" })],
      {},
      "Fix the typo in the README",
    );
    expect(result.not_evaluated.some((n) => n.invariant === "A2-parallelism")).toBe(true);
    expect(result.findings.some((f) => f.invariant === "A2-parallelism")).toBe(false);
  });

  test("blocks a single-task plan compiled against a substantial multi-line prompt", () => {
    const result = auditPlan(
      fixtureRepo(),
      [task({ taskId: "task-everything", writeScope: ["src/does-not-exist-yet"] })],
      {},
      manyLinePrompt(12),
    );
    const finding = result.findings.find((f) => f.invariant === "A2-parallelism");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocking");
    expect(finding?.task_ids).toEqual(["task-everything"]);
    expect(finding?.evidence_class).toBe("derived");
    expect(result.not_evaluated.some((n) => n.invariant === "A2-parallelism")).toBe(false);
  });

  test("stays silent (not_evaluated) once the plan has five or more independent roots", () => {
    const tasks = ["a", "b", "c", "d", "e"].map((letter) =>
      task({ taskId: `task-${letter}`, writeScope: [`src/${letter}`] }),
    );
    const result = auditPlan(fixtureRepo(), tasks, {}, manyLinePrompt(12));
    expect(result.findings.some((f) => f.invariant === "A2-parallelism")).toBe(false);
    expect(result.not_evaluated.some((n) => n.invariant === "A2-parallelism")).toBe(true);
  });

  test("a dependency edge does not count toward the independent-root tally", () => {
    const independentRoots = ["a", "b", "c", "d"].map((letter) =>
      task({ taskId: `task-${letter}`, writeScope: [`src/${letter}`] }),
    );
    const chained = task({ taskId: "task-e", writeScope: ["src/a/inner"], deps: ["task-a"] });
    const result = auditPlan(
      fixtureRepo(),
      [...independentRoots, chained],
      {},
      manyLinePrompt(12),
    );
    expect(result.findings.some((f) => f.invariant === "A2-parallelism")).toBe(true);
  });
});

describe("blockingFindings and advisoryFindings", () => {
  test("partition a mixed result by severity without touching the other bucket", () => {
    const result = auditPlan(fixtureRepo(), [
      task({ taskId: "task-d1", writeScope: ["src/d1"], gate: "bun run typecheck", effort: 1 }),
      task({ taskId: "task-d2", writeScope: ["src/d2"], gate: "bun run typecheck", effort: 1 }),
      task({ taskId: "task-huge", writeScope: ["src/huge"], effort: 10 }),
    ]);
    expect(blockingFindings(result).every((f) => f.severity === "blocking")).toBe(true);
    expect(blockingFindings(result).some((f) => f.invariant === "A3-gate-discrimination")).toBe(
      true,
    );
    expect(advisoryFindings(result).every((f) => f.severity === "advisory")).toBe(true);
    expect(advisoryFindings(result).some((f) => f.invariant === "A5-straggler")).toBe(true);
  });

  test("both return an empty list for a plan with no findings", () => {
    const result = auditPlan(fixtureRepo(), [
      task({ taskId: "task-a", writeScope: ["src/a"] }),
    ]);
    expect(blockingFindings(result)).toEqual([]);
    expect(advisoryFindings(result)).toEqual([]);
  });
});
