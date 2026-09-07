import { describe, expect, it, spyOn, afterEach } from "bun:test";
import * as archivalModule from "../../../olt/scripts/src/mind/archival/index.ts";
import {
  evaluateGate5Affordable,
  evaluateGate6NotADuplicate,
} from "../../../olt/scripts/src/mind/proposals/gates/table.ts";
import type {
  CandidateRecord,
  GateEvaluationContext,
} from "../../../olt/scripts/src/mind/proposals/gates/types.ts";
import type { ArchivedObjectiveRecord } from "../../../olt/scripts/src/mind/archival/index.ts";

describe("Mind Proposals Admission Gates Table Suite", () => {
  const spies: Array<{ mockRestore: () => void }> = [];

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  const ctx = (overrides: Partial<GateEvaluationContext> = {}): GateEvaluationContext => ({
    runRoot: "/virtual/run-root",
    actor: "test-actor",
    state: {},
    repoRoots: ["."],
    ...overrides,
  });

  const cand = (id = "cand-1", extra: Partial<CandidateRecord> = {}): CandidateRecord => ({
    id,
    kind: "defect",
    statement: "Memory leak in queue processor",
    write_scope: ["src/queue.ts"],
    status: "opened",
    ...extra,
  });

  const decCand = (id: string, stmt: string, scope = ["src/a.ts"]) =>
    cand(id, { statement: stmt, write_scope: scope, status: "declined" });

  const witCand = (id: string, wit: string, status = "opened", scope = ["src/l.ts"]) =>
    cand(id, { witness_command_id: wit, status, write_scope: scope });

  const cState = (candidates: unknown[] = [], tasks: Record<string, unknown> = {}) =>
    ctx({ state: { candidates, tasks } });

  const cTask = (status: string, label: string, scope = ["src/a.ts"]) => ({
    status,
    label,
    write_scope: scope,
  });

  const cAgent = (id: string, role: string, status = "active") => ({ id, role, status });

  const cBudget = (p: number, ppd: number, w = 0, wpd = 0) => ({
    pulses_today: p,
    pulses_per_day: ppd,
    wall_clock_ms_today: w,
    wall_clock_ms_per_day: wpd,
  });

  const mockArch = (val: ArchivedObjectiveRecord[]) =>
    spies.push(spyOn(archivalModule, "readArchivedObjectives").mockReturnValue(val));

  const mockArchErr = (err: unknown) =>
    spies.push(
      spyOn(archivalModule, "readArchivedObjectives").mockImplementation(() => {
        throw err;
      }),
    );

  const archObj = (
    id: string,
    type: "proposal" | "defect",
    statement: string,
    scope = ["src/r.ts"],
    decline?: string,
    result = "declined",
  ): ArchivedObjectiveRecord => ({
    schema_version: 2,
    id,
    type,
    statement,
    generation: 1,
    completed_at: "2026-09-01T00:00:00.000Z",
    result,
    write_scope: scope,
    ...(decline ? { details: { kind: type, decline_reason: decline } } : {}),
  });

  describe("evaluateGate5Affordable", () => {
    it("fails when candidate is missing or has no id", () => {
      const res = evaluateGate5Affordable(null as unknown as CandidateRecord, ctx());
      expect(res.passed).toBe(false);
      expect(res.reason).toBe("candidate id is missing");
      expect(res.repairArgv).toContain("mind:observe");
      expect(evaluateGate5Affordable(cand(""), ctx()).passed).toBe(false);
    });

    it("fails when daily pulse or wall-clock budget is exhausted", () => {
      const resPulse = evaluateGate5Affordable(cand(), ctx({ state: { budget: cBudget(10, 10) } }));
      expect(resPulse.passed).toBe(false);
      expect(resPulse.reason).toContain("daily pulse budget exhausted");
      expect(resPulse.repairArgv).toContain("mind:wake");

      const bWall = cBudget(0, 100, 3600, 3600);
      const resWall = evaluateGate5Affordable(cand(), ctx({ state: { budget: bWall } }));
      expect(resWall.passed).toBe(false);
      expect(resWall.reason).toContain("daily wall-clock budget exhausted");
    });

    it("fails when max agents in flight capacity is reached", () => {
      const ctxAgents = ctx({
        state: {
          budget: { max_agents_in_flight: 2 },
          agents: [
            cAgent("agent-impl-1", "implementer"),
            cAgent("agent-val-1", "validator"),
            cAgent("agent-idle-1", "implementer", "idle"),
          ],
        },
      });
      const res = evaluateGate5Affordable(cand(), ctxAgents);
      expect(res.passed).toBe(false);
      expect(res.reason).toContain("max agents in flight reached");
      expect(res.repairArgv).toContain("agent:release");
    });

    it("passes and records metadata when all budget limits are satisfied", () => {
      const ctxOk = ctx({
        state: {
          mind: {
            budget: { ...cBudget(2, 20, 5000, 100_000), max_agents_in_flight: 5 },
          },
        },
      });
      const res = evaluateGate5Affordable(cand(), ctxOk);
      expect(res.passed).toBe(true);
      expect(res.metadata).toEqual({
        pulsesToday: 2,
        pulsesPerDay: 20,
        wallClockToday: 5000,
        wallClockPerDay: 100_000,
      });
    });
  });

  describe("evaluateGate6NotADuplicate", () => {
    it("detects duplicate of permanently declined candidate by witness id or statement scope", () => {
      const cWit = witCand("c-new", "cmd-err-1");
      const ctxWit = cState([witCand("c-dec-1", "cmd-err-1", "declined")]);
      mockArch([]);
      const resWit = evaluateGate6NotADuplicate(cWit, ctxWit);
      expect(resWit.passed).toBe(false);
      expect(resWit.reason).toContain("c-dec-1");

      const cScope = cand("c-new-2", {
        statement: "Fix parser crash",
        write_scope: ["src/parser.ts"],
      });
      const ctxScope = cState([decCand("c-dec-2", "fix parser crash", ["src/parser.ts"])]);
      const resScope = evaluateGate6NotADuplicate(cScope, ctxScope);
      expect(resScope.passed).toBe(false);
      expect(resScope.reason).toContain("c-dec-2");
    });

    it("detects duplicate proposal by matching statement", () => {
      const cProp = cand("p-new", { kind: "proposal", statement: "Add telemetry exporter" });
      const ctxProp = cState([
        cand("p-dec", {
          kind: "proposal",
          statement: "add telemetry exporter",
          status: "declined",
        }),
      ]);
      mockArch([]);
      expect(evaluateGate6NotADuplicate(cProp, ctxProp).passed).toBe(false);
    });

    it("detects duplicate of active candidate by witness and by statement scope", () => {
      const c1 = witCand("c-new-1", "cmd-live-1");
      const ctx1 = cState([witCand("c-act-1", "cmd-live-1", "admitted")]);
      mockArch([]);
      expect(evaluateGate6NotADuplicate(c1, ctx1).passed).toBe(false);

      const c2 = cand("c-new-2", { statement: "Active defect", write_scope: ["src/a.ts"] });
      const ctx2 = cState([
        cand("c-act-2", { statement: "active defect", write_scope: ["src/a.ts"] }),
      ]);
      expect(evaluateGate6NotADuplicate(c2, ctx2).passed).toBe(false);
    });

    it("detects duplicate of live task (ready / leased / proposed)", () => {
      const cTaskCand = cand("c-task", {
        statement: "Refactor pool",
        write_scope: ["src/pool.ts"],
      });
      const ctxTask = cState([], {
        "task-db-1": cTask("leased", "refactor pool", ["src/pool.ts"]),
      });
      mockArch([]);
      expect(evaluateGate6NotADuplicate(cTaskCand, ctxTask).passed).toBe(false);
    });

    it("detects duplicate proposal and defect from archived objectives ledger", () => {
      const cProp = cand("c-arch-p", {
        kind: "proposal",
        statement: "Hot reload",
        write_scope: ["src/r.ts"],
      });
      const archProp = archObj("arch-p-1", "proposal", "hot reload", ["src/r.ts"], "unsupported");
      mockArch([archProp]);
      const resProp = evaluateGate6NotADuplicate(cProp, ctx());
      expect(resProp.passed).toBe(false);
      expect(resProp.reason).toContain("arch-p-1");

      const cDefect = cand("c-arch-d", { statement: "Buffer overflow", write_scope: ["src/p.ts"] });
      const archDefect = archObj("arch-d-1", "defect", "buffer overflow", ["src/p.ts"]);
      mockArch([archDefect]);
      const resDefect = evaluateGate6NotADuplicate(cDefect, ctx());
      expect(resDefect.passed).toBe(false);
      expect(resDefect.reason).toContain("arch-d-1");
    });

    it("handles Error and non-Error exceptions when reading archived objectives", () => {
      mockArchErr(new Error("I/O lock contention"));
      expect(evaluateGate6NotADuplicate(cand(), ctx()).reason).toContain("I/O lock contention");

      mockArchErr("non-error raw string");
      expect(evaluateGate6NotADuplicate(cand(), ctx()).reason).toContain(
        "unknown archival ledger error",
      );
    });

    it("passes Gate 6 when candidates, tasks, and archived items contain non-duplicates", () => {
      const cUnique = cand("c-unique", {
        statement: "Novel improvement",
        write_scope: ["src/u.ts"],
      });
      const ctxAll = cState(
        [
          cand("c-unique", { statement: "Self", write_scope: ["src/u.ts"] }),
          cand("c-other", {
            statement: "Unrelated",
            write_scope: ["src/other.ts"],
            status: "admitted",
          }),
          decCand("c-dec-unrelated", "Declined other", ["src/other.ts"]),
        ],
        {
          "task-ready": cTask("ready", "unrelated task", ["src/other.ts"]),
          "task-done": cTask("completed", "Novel improvement", ["src/u.ts"]),
          "invalid-task": null as unknown as Record<string, unknown>,
        },
      );

      const archDone = archObj(
        "arch-done",
        "defect",
        "Novel improvement",
        ["src/u.ts"],
        undefined,
        "completed",
      );

      mockArch([archDone]);
      const res = evaluateGate6NotADuplicate(cUnique, ctxAll);
      expect(res.passed).toBe(true);
      expect(res.gateId).toBe("gate-6-not-a-duplicate");
      expect(res.gateNumber).toBe(6);
    });
  });
});
