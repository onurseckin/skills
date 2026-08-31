import { describe, expect, test } from "bun:test";
import { auditPlan } from "../../../olt/scripts/src/graph/plan-audit.ts";
import {
  fixtureRepo,
  gateProof,
  runStateWithProofs,
  task,
} from "./plan-audit-fixture.ts";

describe("A6-whole-suite-gate", () => {
  test("blocks a task gate that runs the whole test tree, regardless of how narrow its scope is", () => {
    const result = auditPlan(fixtureRepo(), [
      task({ taskId: "task-a", writeScope: ["src/a"], gate: "bun test" }),
    ]);
    const finding = result.findings.find((f) => f.invariant === "A6-whole-suite-gate");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocking");
    expect(finding?.task_ids).toEqual(["task-a"]);
  });

  test("stays silent for a gate pointed at a real target", () => {
    const result = auditPlan(fixtureRepo(), [
      task({ taskId: "task-a", writeScope: ["src/a"], gate: "bun test tests/unit/a" }),
    ]);
    expect(result.findings.some((f) => f.invariant === "A6-whole-suite-gate")).toBe(false);
  });

  test("flags a non-test whole-repo command even for a single task", () => {
    const result = auditPlan(fixtureRepo(), [
      task({ taskId: "task-a", writeScope: ["src/a"], gate: "bun run typecheck" }),
    ]);
    expect(result.findings.some((f) => f.invariant === "A6-whole-suite-gate")).toBe(true);
  });

  describe("consulting a recorded gate:prove verdict (DESIGN.md C3)", () => {
    test("a falsifiable proof of the task's own whole-suite gate over its own scope satisfies A6", () => {
      const runState = runStateWithProofs([
        gateProof({ task_id: "task-a", gate_argv: ["bun", "test"], write_scope: ["src/a"] }),
      ]);
      const result = auditPlan(
        fixtureRepo(),
        [task({ taskId: "task-a", writeScope: ["src/a"], gate: "bun test" })],
        runState,
      );
      expect(result.findings.some((f) => f.invariant === "A6-whole-suite-gate")).toBe(false);
    });

    test("a NOT-falsifiable proof does not satisfy A6 — refusal stands", () => {
      const runState = runStateWithProofs([
        gateProof({
          task_id: "task-a",
          gate_argv: ["bun", "test"],
          write_scope: ["src/a"],
          falsifiable: false,
          exit_code: 0,
        }),
      ]);
      const result = auditPlan(
        fixtureRepo(),
        [task({ taskId: "task-a", writeScope: ["src/a"], gate: "bun test" })],
        runState,
      );
      expect(result.findings.some((f) => f.invariant === "A6-whole-suite-gate")).toBe(true);
    });

    test("a proof recorded against a different task's gate does not transfer — refusal stands", () => {
      const runState = runStateWithProofs([
        gateProof({ task_id: "task-other", gate_argv: ["bun", "test"], write_scope: ["src/a"] }),
      ]);
      const result = auditPlan(
        fixtureRepo(),
        [task({ taskId: "task-a", writeScope: ["src/a"], gate: "bun test" })],
        runState,
      );
      expect(result.findings.some((f) => f.invariant === "A6-whole-suite-gate")).toBe(true);
    });

    test("no proof recorded (default empty runState) leaves the static heuristic refusing, unweakened", () => {
      const result = auditPlan(fixtureRepo(), [
        task({ taskId: "task-a", writeScope: ["src/a"], gate: "bun test" }),
      ]);
      const finding = result.findings.find((f) => f.invariant === "A6-whole-suite-gate");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("blocking");
    });
  });
});
