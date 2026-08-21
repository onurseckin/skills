import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject } from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";
import {
  appendGateProof,
  type GateProofRecord,
} from "../../../orchestrating-long-tasks/scripts/src/graph/gate-proof.ts";
import {
  advisoryFindings,
  AUDIT_INVARIANT_IDS,
  auditPlan,
  blockingFindings,
  isAuditInvariantId,
  type AuditTaskInput,
} from "../../../orchestrating-long-tasks/scripts/src/graph/plan-audit.ts";

const roots: string[] = [];
function fixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "plan-audit-fixture-"));
  roots.push(root);
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function task(overrides: Partial<AuditTaskInput> & { taskId: string }): AuditTaskInput {
  return { writeScope: [], deps: [], gate: "bun test tests/unit", ...overrides };
}

/** A `gate:prove` verdict shaped exactly like the ones `gateProveCommand` appends via
 *  `appendGateProof` — built directly rather than through a real scratch-copy proof run, since
 *  these tests are exercising `auditPlan`'s consultation of a recorded verdict, not `gate:prove`
 *  itself (that module owns its own tests). */
function gateProof(
  overrides: Partial<GateProofRecord> &
    Pick<GateProofRecord, "task_id" | "gate_argv" | "write_scope">,
): GateProofRecord {
  return {
    base: "HEAD",
    falsifiable: true,
    exit_code: 1,
    timed_out: false,
    proved_at: "2026-01-01T00:00:00.000Z",
    actor: "coordinator",
    ...overrides,
  };
}

function runStateWithProofs(records: readonly GateProofRecord[]): JsonObject {
  const state: JsonObject = {};
  for (const record of records) appendGateProof(state, record);
  return state;
}

describe("isAuditInvariantId", () => {
  test("accepts exactly the six DESIGN.md invariants", () => {
    for (const id of AUDIT_INVARIANT_IDS) expect(isAuditInvariantId(id)).toBe(true);
    expect(isAuditInvariantId("A7-invented")).toBe(false);
    expect(isAuditInvariantId("")).toBe(false);
  });
});

// A prompt substantial enough to cross A2's line-count threshold (>= 10 non-blank lines), built the
// same way a coordinator would write a multi-item ask — one line per named thing.
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

  // The red-team shape this invariant exists to catch: a plan of ONE task, whose write scope can
  // even name a not-yet-existing directory (so A1-granularity's file expansion never sees it),
  // compiled against a substantial, multi-item prompt. Before this fix, auditPlan(repo, [oneTask])
  // returned findings: [] and blocking: 0 for exactly this shape.
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
    // Four roots plus one task chained behind a root is still four independent roots, not five —
    // the straggler doesn't buy the plan a pass it hasn't earned.
    const roots = ["a", "b", "c", "d"].map((letter) =>
      task({ taskId: `task-${letter}`, writeScope: [`src/${letter}`] }),
    );
    const chained = task({ taskId: "task-e", writeScope: ["src/a/inner"], deps: ["task-a"] });
    const result = auditPlan(fixtureRepo(), [...roots, chained], {}, manyLinePrompt(12));
    expect(result.findings.some((f) => f.invariant === "A2-parallelism")).toBe(true);
  });
});

describe("A1-granularity", () => {
  test("blocks a task whose scope expands past 3 files while the plan touches 5+", () => {
    const repo = fixtureRepo();
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
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/tiny"), { recursive: true });
    for (const name of ["a.ts", "b.ts", "c.ts", "d.ts"]) {
      writeFileSync(join(repo, "src/tiny", name), "");
    }
    const result = auditPlan(repo, [task({ taskId: "task-tiny", writeScope: ["src/tiny"] })]);
    expect(result.findings.some((f) => f.invariant === "A1-granularity")).toBe(false);
  });

  test("stays silent when no single task carries more than 3 files", () => {
    const repo = fixtureRepo();
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

describe("A3-gate-discrimination", () => {
  test("blocks two disjoint tasks sharing an identical gate — the forensics shape", () => {
    const result = auditPlan(fixtureRepo(), [
      task({ taskId: "task-d1", writeScope: ["src/d1"], gate: "bun run typecheck" }),
      task({ taskId: "task-d2", writeScope: ["src/d2"], gate: "bun run typecheck" }),
    ]);
    const finding = result.findings.find((f) => f.invariant === "A3-gate-discrimination");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocking");
    expect(finding?.task_ids.sort()).toEqual(["task-d1", "task-d2"]);
  });

  test("whitespace differences do not hide an otherwise identical gate", () => {
    const result = auditPlan(fixtureRepo(), [
      task({ taskId: "task-a", writeScope: ["src/a"], gate: "bun  test   tests" }),
      task({ taskId: "task-b", writeScope: ["src/b"], gate: "bun test tests" }),
    ]);
    expect(result.findings.some((f) => f.invariant === "A3-gate-discrimination")).toBe(true);
  });

  test("stays silent when scopes overlap — a shared gate over shared code is not discrimination failure", () => {
    const result = auditPlan(fixtureRepo(), [
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
    const result = auditPlan(fixtureRepo(), [
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
      const result = auditPlan(fixtureRepo(), [
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
      const result = auditPlan(fixtureRepo(), [
        task({ taskId: "task-a", writeScope: ["src/a"], gate: "bun run typecheck" }),
        task({ taskId: "task-b", writeScope: ["src/b"], gate: "bun run lint" }),
      ]);
      expect(result.findings.some((f) => f.invariant === "A3-gate-discrimination")).toBe(false);
    });

    test("a different executable is a genuinely different gate", () => {
      const result = auditPlan(fixtureRepo(), [
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
      const result = auditPlan(fixtureRepo(), tasks, runState);
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
      const result = auditPlan(fixtureRepo(), tasks, runState);
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
      const result = auditPlan(fixtureRepo(), tasks, runState);
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
      const result = auditPlan(fixtureRepo(), tasks, runState);
      expect(result.findings.some((f) => f.invariant === "A3-gate-discrimination")).toBe(true);
    });

    test("no proof recorded (default empty runState) leaves the static heuristic refusing, unweakened", () => {
      const result = auditPlan(fixtureRepo(), tasks);
      const finding = result.findings.find((f) => f.invariant === "A3-gate-discrimination");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("blocking");
    });
  });
});

describe("A4-false-barrier", () => {
  test("blocks a dependency edge whose child's scope shares nothing with the parent's", () => {
    const result = auditPlan(fixtureRepo(), [
      task({ taskId: "task-a", writeScope: ["src/a"] }),
      task({ taskId: "task-b", writeScope: ["src/b"], deps: ["task-a"] }),
    ]);
    const finding = result.findings.find((f) => f.invariant === "A4-false-barrier");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("blocking");
    expect(finding?.task_ids).toEqual(["task-b", "task-a"]);
  });

  test("stays silent when the dependent task's scope actually overlaps the parent's", () => {
    const result = auditPlan(fixtureRepo(), [
      task({ taskId: "task-a", writeScope: ["src/shared"] }),
      task({ taskId: "task-b", writeScope: ["src/shared/inner"], deps: ["task-a"] }),
    ]);
    expect(result.findings.some((f) => f.invariant === "A4-false-barrier")).toBe(false);
  });
});

describe("A5-straggler", () => {
  test("flags a task whose effort is more than 3x its wave's median as advisory, not blocking", () => {
    const result = auditPlan(fixtureRepo(), [
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
    const result = auditPlan(fixtureRepo(), [
      task({ taskId: "task-only", writeScope: ["src/only"], effort: 99 }),
    ]);
    expect(result.findings.some((f) => f.invariant === "A5-straggler")).toBe(false);
  });

  test("stays silent when no task declares an effort at all", () => {
    const result = auditPlan(fixtureRepo(), [
      task({ taskId: "task-a", writeScope: ["src/a"] }),
      task({ taskId: "task-b", writeScope: ["src/b"] }),
    ]);
    expect(result.findings.some((f) => f.invariant === "A5-straggler")).toBe(false);
  });
});

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

  // looksWholeSuite is verb-independent, not just a test-runner allowlist: this repo's own
  // incident data showed `bun run typecheck` gating 19 of 29 real tasks while a verb allowlist
  // never caught it (see graph/gate-breadth.ts's own docstring and gate-breadth.test.ts). A
  // targetless, non-weak whole-repo command is exactly the shape A6 exists to catch, on a single
  // task by itself — sharing the same command across disjoint tasks is a separate, additional
  // problem A3-gate-discrimination flags on top of this.
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

describe("blockingFindings and advisoryFindings", () => {
  test("partition a mixed result by severity without touching the other bucket", () => {
    // A3 is blocking (identical gate over disjoint scopes); A5 is advisory (one huge straggler in
    // a wave) — together they exercise both severities in one auditPlan call.
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
    const result = auditPlan(fixtureRepo(), [task({ taskId: "task-a", writeScope: ["src/a"] })]);
    expect(blockingFindings(result)).toEqual([]);
    expect(advisoryFindings(result)).toEqual([]);
  });
});
