import { describe, expect, it, spyOn, afterEach } from "bun:test";
import * as predicatesModule from "../../../olt/scripts/src/mind/proposals/gates/predicates.ts";
import {
  evaluateGate2InCharter,
  evaluateGate3Falsifiable,
  evaluateGate4Scoped,
} from "../../../olt/scripts/src/mind/proposals/gates/evaluator.ts";
import type {
  CandidateRecord,
  GateEvaluationContext,
} from "../../../olt/scripts/src/mind/proposals/gates/types.ts";

describe("Mind Proposals Admission Gates Evaluator Suite", () => {
  const spies: Array<{ mockRestore: () => void }> = [];

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  const makeCtx = (overrides: Partial<GateEvaluationContext> = {}): GateEvaluationContext => ({
    runRoot: "/virtual/run-root",
    repoRoot: "/virtual/repo-root",
    actor: "test-actor",
    state: {},
    repoRoots: ["."],
    ...overrides,
  });

  const makeCandidate = (overrides: Partial<CandidateRecord> = {}): CandidateRecord => ({
    id: "cand-eval-1",
    kind: "defect",
    statement: "Fix off-by-one index error in parser",
    write_scope: ["src/parser.ts"],
    status: "opened",
    charter_goal_ids: ["G1"],
    ...overrides,
  });

  describe("evaluateGate2InCharter", () => {
    it("fails when candidate cites no charter goals or non-string/whitespace values", () => {
      const cEmpty = makeCandidate({ charter_goal_ids: [], charter_goals: [] });
      const res1 = evaluateGate2InCharter(cEmpty, makeCtx());
      expect(res1.passed).toBe(false);
      expect(res1.gateId).toBe("gate-2-in-charter");
      expect(res1.gateNumber).toBe(2);
      expect(res1.reason).toContain("cites no charter goals");
      expect(res1.repairArgv).toContain("--charter-goal G1");

      const cMixed = makeCandidate({
        charter_goal_ids: undefined,
        charter_goals: [123 as unknown as string, "  ", ""],
      });
      const res2 = evaluateGate2InCharter(cMixed, makeCtx());
      expect(res2.passed).toBe(false);
    });

    it("fails when cited goal does not exist in pinned charter goals", () => {
      const cUnknown = makeCandidate({ charter_goal_ids: ["G_UNKNOWN"] });
      const ctx = makeCtx({ charterGoals: new Set(["G1", "G2"]) });
      const res = evaluateGate2InCharter(cUnknown, ctx);
      expect(res.passed).toBe(false);
      expect(res.reason).toContain("does not exist in pinned charter (known goals: G1, G2)");
      expect(res.repairArgv).toContain("--charter-goal G1");

      const emptyCharterCtx = makeCtx({ charterGoals: new Set<string>() });
      const resEmpty = evaluateGate2InCharter(cUnknown, emptyCharterCtx);
      expect(resEmpty.passed).toBe(false);
      expect(resEmpty.repairArgv).toContain("--charter-goal G1");
    });

    it("fails when candidate matches charter non-goal by statement or write_scope", () => {
      const cStatement = makeCandidate({
        statement: "Migrate database to legacy schema",
        charter_goal_ids: ["G1"],
        write_scope: undefined as unknown as readonly string[],
      });
      const ctx = makeCtx({ charterNonGoals: ["  ", "legacy schema"] });
      const res1 = evaluateGate2InCharter(cStatement, ctx);
      expect(res1.passed).toBe(false);
      expect(res1.reason).toContain("candidate matches charter non-goal 'legacy schema'");

      const cScope = makeCandidate({
        statement: "Clean refactor",
        write_scope: ["src/deprecated/old.ts"],
        charter_goal_ids: ["G1"],
      });
      const ctxScope = makeCtx({ charterNonGoals: ["deprecated"] });
      const res2 = evaluateGate2InCharter(cScope, ctxScope);
      expect(res2.passed).toBe(false);
      expect(res2.reason).toContain("candidate matches charter non-goal 'deprecated'");
    });

    it("passes when cited goals exist in pinned charter and no non-goals match", () => {
      const cGoalsFallback = makeCandidate({
        charter_goal_ids: undefined,
        charter_goals: [42 as unknown as string, "G1", "G2"],
        write_scope: ["src/clean.ts"],
      });
      const ctx = makeCtx({
        charterGoals: new Set(["G1", "G2", "G3"]),
        charterNonGoals: ["unrelated-nongoal"],
      });
      const res = evaluateGate2InCharter(cGoalsFallback, ctx);
      expect(res.passed).toBe(true);
      expect(res.gateId).toBe("gate-2-in-charter");
      expect(res.metadata).toEqual({ goals: ["G1", "G2"] });
    });
  });

  describe("evaluateGate3Falsifiable", () => {
    it("passes immediately for proposal candidates", () => {
      const cProp = makeCandidate({ kind: "proposal", falsifier_argv: undefined });
      const res = evaluateGate3Falsifiable(cProp, makeCtx());
      expect(res.passed).toBe(true);
      expect(res.gateId).toBe("gate-3-falsifiable");
      expect(res.gateNumber).toBe(3);
      expect(res.metadata).toEqual({ kind: "proposal" });
    });

    it("fails when defect candidate has no falsifier argv declared", () => {
      const cNoFalsifier = makeCandidate({ falsifier_argv: undefined, falsifier: undefined });
      const res = evaluateGate3Falsifiable(cNoFalsifier, makeCtx());
      expect(res.passed).toBe(false);
      expect(res.reason).toContain("no falsifier argv declared");
      expect(res.repairArgv).toContain('--falsifier "<failing command>"');
    });

    it("fails when falsifier command exits with 0", () => {
      spies.push(
        spyOn(predicatesModule, "executeFalsifier").mockReturnValue({
          exitCode: 0,
          stdout: "test passed",
          stderr: "",
          timedOut: false,
        }),
      );
      const cFailing = makeCandidate({ falsifier: "bun test failing.test.ts" });
      const res = evaluateGate3Falsifiable(cFailing, makeCtx());
      expect(res.passed).toBe(false);
      expect(res.reason).toContain("exited with 0; a falsifier must fail");
      expect(res.metadata).toEqual({ exitCode: 0, argv: ["bun", "test", "failing.test.ts"] });
    });

    it("passes when falsifier command exits with non-zero or null timeout", () => {
      spies.push(
        spyOn(predicatesModule, "executeFalsifier").mockReturnValue({
          exitCode: 2,
          stdout: "",
          stderr: "assertion error",
          timedOut: false,
        }),
      );
      const cNonZero = makeCandidate({ falsifier_argv: ["bun", "test", "defect.test.ts"] });
      const res1 = evaluateGate3Falsifiable(cNonZero, makeCtx());
      expect(res1.passed).toBe(true);
      expect(res1.metadata).toEqual({ exitCode: 2, argv: ["bun", "test", "defect.test.ts"] });

      spies.push(
        spyOn(predicatesModule, "executeFalsifier").mockReturnValue({
          exitCode: null,
          stdout: "",
          stderr: "timed out",
          timedOut: true,
        }),
      );
      const res2 = evaluateGate3Falsifiable(cNonZero, makeCtx());
      expect(res2.passed).toBe(true);
      expect(res2.metadata).toEqual({ exitCode: 1, argv: ["bun", "test", "defect.test.ts"] });
    });
  });

  describe("evaluateGate4Scoped", () => {
    it("fails when write scope is empty or contains only non-strings / whitespace", () => {
      const cEmpty = makeCandidate({ write_scope: [] });
      const res1 = evaluateGate4Scoped(cEmpty, makeCtx());
      expect(res1.passed).toBe(false);
      expect(res1.reason).toBe("candidate write scope is empty");
      expect(res1.repairArgv).toContain("--write-scope <path>");

      const cWhitespace = makeCandidate({
        write_scope: [123 as unknown as string, "  ", ""],
      });
      expect(evaluateGate4Scoped(cWhitespace, makeCtx()).passed).toBe(false);
    });

    it("fails when write scope is outside charter repo_roots", () => {
      const cOutside = makeCandidate({ write_scope: ["/etc/shadow"] });
      const ctx = makeCtx({ repoRoots: ["src/app"], repoRoot: "/virtual/repo-root" });
      const res = evaluateGate4Scoped(cOutside, ctx);
      expect(res.passed).toBe(false);
      expect(res.reason).toContain("is outside charter repo_roots (src/app)");
      expect(res.repairArgv).toContain("--write-scope src/app");
    });

    it("fails when write scope conflicts with live task lease or lease scope", () => {
      const futureDate = new Date(Date.now() + 60000).toISOString();
      const pastDate = new Date(Date.now() - 60000).toISOString();

      const cTask = makeCandidate({ write_scope: ["src/common/state.ts"] });
      const ctxLeased = makeCtx({
        state: {
          tasks: {
            "task-active": { status: "leased", write_scope: ["src/common/state.ts"] },
            "task-null": null,
            "task-primitive": "not-an-object",
            "task-no-scope": { status: "leased", lease: {} },
            "task-expired": {
              status: "idle",
              lease: { expires_at: pastDate, write_scope: ["src/common/state.ts"] },
            },
          },
        },
      });
      const res1 = evaluateGate4Scoped(cTask, ctxLeased);
      expect(res1.passed).toBe(false);
      expect(res1.reason).toContain("conflicts with live task lease 'task-active'");

      const ctxLeaseScope = makeCtx({
        state: {
          tasks: {
            "task-future": {
              status: "idle",
              lease: {
                expires_at: futureDate,
                write_scope: ["src/common/state.ts"],
              },
            },
          },
        },
      });
      const res2 = evaluateGate4Scoped(cTask, ctxLeaseScope);
      expect(res2.passed).toBe(false);

      const ctxNonStringExpiry = makeCtx({
        state: {
          tasks: {
            "task-non-string": {
              status: "idle",
              lease: { expires_at: 12345, write_scope: ["src/common/state.ts"] },
            },
          },
        },
      });
      expect(evaluateGate4Scoped(cTask, ctxNonStringExpiry).passed).toBe(false);
    });

    it("fails when write scope conflicts with another active candidate", () => {
      const cNew = makeCandidate({ id: "cand-new", write_scope: ["src/auth/token.ts"] });
      const ctxConflict = makeCtx({
        state: {
          candidates: [
            { id: "cand-new", write_scope: ["src/auth/token.ts"], status: "opened" },
            { id: "cand-no-scope", status: "opened" },
            { id: "cand-admitted", write_scope: ["src/auth/token.ts"], status: "admitted" },
            { id: "cand-declined", write_scope: ["src/auth/token.ts"], status: "declined" },
          ],
        },
      });
      const res = evaluateGate4Scoped(cNew, ctxConflict);
      expect(res.passed).toBe(false);
      expect(res.reason).toContain("conflicts with active candidate 'cand-admitted'");
    });

    it("passes when write scope is valid, in charter, and disjoint from tasks and candidates", () => {
      const cClean = makeCandidate({ id: "c-clean", write_scope: ["src/feature/clean.ts"] });
      const ctxClean = makeCtx({
        repoRoots: [],
        state: {
          tasks: {
            "task-other": { status: "completed", write_scope: ["src/other.ts"] },
          },
          candidates: [{ id: "c-other", write_scope: ["src/other.ts"], status: "opened" }],
        },
      });
      const res = evaluateGate4Scoped(cClean, ctxClean);
      expect(res.passed).toBe(true);
      expect(res.gateId).toBe("gate-4-scoped");
      expect(res.gateNumber).toBe(4);
      expect(res.metadata).toEqual({ writeScope: ["src/feature/clean.ts"] });
    });
  });
});
