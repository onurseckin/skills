import { afterAll, describe, expect, test } from "bun:test";
import { auditPlan } from "../../../orchestrating-long-tasks/scripts/src/graph/plan-audit.ts";
import {
  cleanupFixtureRoots,
  fixtureRepo,
  gateProof,
  runStateWithProofs,
  task,
} from "./plan-audit-fixture.ts";

const roots: string[] = [];
afterAll(() => cleanupFixtureRoots(roots));

describe("A3-gate-discrimination", () => {
  test("blocks two disjoint tasks sharing an identical gate — the forensics shape", () => {
    const result = auditPlan(fixtureRepo(roots), [
      task({ taskId: "task-d1", writeScope: ["src/d1"], gate: "bun run typecheck" }),
      task({ taskId: "task-d2", writeScope: ["src/d2"], gate: "bun run typecheck" }),
    ]);
    const finding = result.findings.find((f) => f.invariant === "A3-gate-discrimination");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocking");
    expect(finding?.task_ids.sort()).toEqual(["task-d1", "task-d2"]);
  });

  test("whitespace differences do not hide an otherwise identical gate", () => {
    const result = auditPlan(fixtureRepo(roots), [
      task({ taskId: "task-a", writeScope: ["src/a"], gate: "bun  test   tests" }),
      task({ taskId: "task-b", writeScope: ["src/b"], gate: "bun test tests" }),
    ]);
    expect(result.findings.some((f) => f.invariant === "A3-gate-discrimination")).toBe(true);
  });

  test("stays silent when scopes overlap — a shared gate over shared code is not discrimination failure", () => {
    const result = auditPlan(fixtureRepo(roots), [
      task({ taskId: "task-a", writeScope: ["src/shared"], gate: "bun test tests/shared" }),
      task({
        taskId: "task-b",
        writeScope: ["src/shared/nested"],
        gate: "bun test tests/shared",
      }),
    ]);
    expect(result.findings.some((f) => f.invariant === "A3-gate-discrimination")).toBe(false);
  });

  test("stays silent when disjoint tasks carry different gates", () => {
    const result = auditPlan(fixtureRepo(roots), [
      task({ taskId: "task-a", writeScope: ["src/a"], gate: "bun test tests/a" }),
      task({ taskId: "task-b", writeScope: ["src/b"], gate: "bun test tests/b" }),
    ]);
    expect(result.findings.some((f) => f.invariant === "A3-gate-discrimination")).toBe(false);
  });

  describe("structural comparison (executable, subcommand, targets), not exact string equality", () => {
    // The forensics shape, red-teamed: five disjoint tasks sharing `bun run typecheck` raise ten
    // findings. A cosmetic per-task flag that names no real target must not launder that down to
    // zero — the underlying gate still proves nothing about any one task's own work.
    test("a cosmetic per-task flag does not defeat discrimination", () => {
      const result = auditPlan(fixtureRepo(roots), [
        task({
          taskId: "task-d1",
          writeScope: ["src/d1"],
          gate: "bun run typecheck --scope=t1",
        }),
        task({
          taskId: "task-d2",
          writeScope: ["src/d2"],
          gate: "bun run typecheck --scope=t2",
        }),
      ]);
      const finding = result.findings.find((f) => f.invariant === "A3-gate-discrimination");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("blocking");
      expect(finding?.task_ids.sort()).toEqual(["task-d1", "task-d2"]);
    });

    test("a different subcommand is a genuinely different gate, flag or no flag", () => {
      const result = auditPlan(fixtureRepo(roots), [
        task({ taskId: "task-a", writeScope: ["src/a"], gate: "bun run typecheck" }),
        task({ taskId: "task-b", writeScope: ["src/b"], gate: "bun run lint" }),
      ]);
      expect(result.findings.some((f) => f.invariant === "A3-gate-discrimination")).toBe(false);
    });

    test("a different executable is a genuinely different gate", () => {
      const result = auditPlan(fixtureRepo(roots), [
        task({ taskId: "task-a", writeScope: ["src/a"], gate: "bun run typecheck" }),
        task({ taskId: "task-b", writeScope: ["src/b"], gate: "pytest" }),
      ]);
      expect(result.findings.some((f) => f.invariant === "A3-gate-discrimination")).toBe(false);
    });
  });

  describe("consulting a recorded gate:prove verdict (DESIGN.md C3)", () => {
    const tasks = [
      task({ taskId: "task-d1", writeScope: ["src/d1"], gate: "bun run typecheck" }),
      task({ taskId: "task-d2", writeScope: ["src/d2"], gate: "bun run typecheck" }),
    ];

    test("is satisfied when BOTH tasks carry a falsifiable proof of their own gate over their own scope", () => {
      const runState = runStateWithProofs([
        gateProof({
          task_id: "task-d1",
          gate_argv: ["bun", "run", "typecheck"],
          write_scope: ["src/d1"],
        }),
        gateProof({
          task_id: "task-d2",
          gate_argv: ["bun", "run", "typecheck"],
          write_scope: ["src/d2"],
        }),
      ]);
      const result = auditPlan(fixtureRepo(roots), tasks, runState);
      expect(result.findings.some((f) => f.invariant === "A3-gate-discrimination")).toBe(false);
    });

    test("a proof for only one of the two tasks does not satisfy the pair — refusal stands", () => {
      const runState = runStateWithProofs([
        gateProof({
          task_id: "task-d1",
          gate_argv: ["bun", "run", "typecheck"],
          write_scope: ["src/d1"],
        }),
      ]);
      const result = auditPlan(fixtureRepo(roots), tasks, runState);
      const finding = result.findings.find((f) => f.invariant === "A3-gate-discrimination");
      expect(finding).toBeDefined();
      expect(finding?.task_ids.sort()).toEqual(["task-d1", "task-d2"]);
    });

    test("a NOT-falsifiable proof for both tasks does not satisfy the pair — refusal stands", () => {
      const runState = runStateWithProofs([
        gateProof({
          task_id: "task-d1",
          gate_argv: ["bun", "run", "typecheck"],
          write_scope: ["src/d1"],
          falsifiable: false,
          exit_code: 0,
        }),
        gateProof({
          task_id: "task-d2",
          gate_argv: ["bun", "run", "typecheck"],
          write_scope: ["src/d2"],
          falsifiable: false,
          exit_code: 0,
        }),
      ]);
      const result = auditPlan(fixtureRepo(roots), tasks, runState);
      expect(result.findings.some((f) => f.invariant === "A3-gate-discrimination")).toBe(true);
    });

    test("a proof recorded against a scope the task no longer carries is not trusted — refusal stands", () => {
      const runState = runStateWithProofs([
        // task-d1's declared scope is src/d1; this proof was taken before the scope changed.
        gateProof({
          task_id: "task-d1",
          gate_argv: ["bun", "run", "typecheck"],
          write_scope: ["src/old-d1"],
        }),
        gateProof({
          task_id: "task-d2",
          gate_argv: ["bun", "run", "typecheck"],
          write_scope: ["src/d2"],
        }),
      ]);
      const result = auditPlan(fixtureRepo(roots), tasks, runState);
      expect(result.findings.some((f) => f.invariant === "A3-gate-discrimination")).toBe(true);
    });

    test("no proof recorded (default empty runState) leaves the static heuristic refusing, unweakened", () => {
      const result = auditPlan(fixtureRepo(roots), tasks);
      const finding = result.findings.find((f) => f.invariant === "A3-gate-discrimination");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("blocking");
    });
  });
});
