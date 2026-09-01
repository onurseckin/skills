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

  const cand = (overrides: Partial<CandidateRecord> = {}): CandidateRecord => ({
    id: "cand-1",
    kind: "defect",
    statement: "Memory leak in queue processor",
    write_scope: ["src/queue.ts"],
    status: "opened",
    ...overrides,
  });

  describe("evaluateGate5Affordable", () => {
    it("fails when candidate is missing or has no id", () => {
      const res1 = evaluateGate5Affordable(null as unknown as CandidateRecord, ctx());
      expect(res1.passed).toBe(false);
      expect(res1.reason).toBe("candidate id is missing");
      expect(res1.repairArgv).toContain("mind:observe");

      expect(evaluateGate5Affordable(cand({ id: "" }), ctx()).passed).toBe(false);
    });

    it("fails when daily pulse or wall-clock budget is exhausted", () => {
      const ctxPulse = ctx({ state: { budget: { pulses_today: 10, pulses_per_day: 10 } } });
      const resPulse = evaluateGate5Affordable(cand(), ctxPulse);
      expect(resPulse.passed).toBe(false);
      expect(resPulse.reason).toContain("daily pulse budget exhausted");
      expect(resPulse.repairArgv).toContain("mind:wake");

      const ctxWall = ctx({
        state: { budget: { wall_clock_ms_today: 3600, wall_clock_ms_per_day: 3600 } },
      });
      const resWall = evaluateGate5Affordable(cand(), ctxWall);
      expect(resWall.passed).toBe(false);
      expect(resWall.reason).toContain("daily wall-clock budget exhausted");
    });

    it("fails when max agents in flight capacity is reached", () => {
      const ctxAgents = ctx({
        state: {
          budget: { max_agents_in_flight: 2 },
          agents: [
            { id: "agent-impl-1", role: "implementer", status: "active" },
            { id: "agent-val-1", role: "validator", status: "active" },
            { id: "agent-idle-1", role: "implementer", status: "idle" },
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
            budget: {
              pulses_today: 2,
              pulses_per_day: 20,
              wall_clock_ms_today: 5000,
              wall_clock_ms_per_day: 100_000,
              max_agents_in_flight: 5,
            },
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
      const cWit = cand({ id: "c-new", witness_command_id: "cmd-err-1" });
      const ctxWit = ctx({
        state: {
          candidates: [
            {
              id: "c-dec-1",
              statement: "Declined witness candidate",
              witness_command_id: "cmd-err-1",
              status: "declined",
              decline_reason: "not a bug",
            },
          ],
        },
      });
      spies.push(spyOn(archivalModule, "readArchivedObjectives").mockReturnValue([]));
      const resWit = evaluateGate6NotADuplicate(cWit, ctxWit);
      expect(resWit.passed).toBe(false);
      expect(resWit.reason).toContain("c-dec-1");

      const cScope = cand({
        id: "c-new-2",
        statement: "Fix parser crash",
        write_scope: ["src/parser.ts"],
      });
      const ctxScope = ctx({
        state: {
          candidates: [
            {
              id: "c-dec-2",
              status: "declined",
              statement: "fix parser crash",
              write_scope: ["src/parser.ts"],
            },
          ],
        },
      });
      const resScope = evaluateGate6NotADuplicate(cScope, ctxScope);
      expect(resScope.passed).toBe(false);
      expect(resScope.reason).toContain("c-dec-2");
    });

    it("detects duplicate proposal by matching statement", () => {
      const cProp = cand({ id: "p-new", kind: "proposal", statement: "Add telemetry exporter" });
      const ctxProp = ctx({
        state: {
          candidates: [
            {
              id: "p-dec",
              kind: "proposal",
              status: "declined",
              statement: "add telemetry exporter",
            },
          ],
        },
      });
      spies.push(spyOn(archivalModule, "readArchivedObjectives").mockReturnValue([]));
      expect(evaluateGate6NotADuplicate(cProp, ctxProp).passed).toBe(false);
    });

    it("detects duplicate of active candidate by witness and by statement scope", () => {
      const c1 = cand({ id: "c-new-1", witness_command_id: "cmd-live-1" });
      const ctx1 = ctx({
        state: {
          candidates: [
            {
              id: "c-act-1",
              statement: "Live candidate",
              witness_command_id: "cmd-live-1",
              status: "admitted",
              write_scope: ["src/l.ts"],
            },
          ],
        },
      });
      spies.push(spyOn(archivalModule, "readArchivedObjectives").mockReturnValue([]));
      expect(evaluateGate6NotADuplicate(c1, ctx1).passed).toBe(false);

      const c2 = cand({ id: "c-new-2", statement: "Active defect", write_scope: ["src/a.ts"] });
      const ctx2 = ctx({
        state: {
          candidates: [
            {
              id: "c-act-2",
              status: "opened",
              statement: "active defect",
              write_scope: ["src/a.ts"],
            },
          ],
        },
      });
      expect(evaluateGate6NotADuplicate(c2, ctx2).passed).toBe(false);
    });

    it("detects duplicate of live task (ready / leased / proposed)", () => {
      const cTask = cand({
        id: "c-task",
        statement: "Refactor pool",
        write_scope: ["src/pool.ts"],
      });
      const ctxTask = ctx({
        state: {
          tasks: {
            "task-db-1": { status: "leased", label: "refactor pool", write_scope: ["src/pool.ts"] },
          },
        },
      });
      spies.push(spyOn(archivalModule, "readArchivedObjectives").mockReturnValue([]));
      expect(evaluateGate6NotADuplicate(cTask, ctxTask).passed).toBe(false);
    });

    it("detects duplicate proposal and defect from archived objectives ledger", () => {
      const cProp = cand({
        id: "c-arch-p",
        kind: "proposal",
        statement: "Hot reload",
        write_scope: ["src/r.ts"],
      });
      const archProp: ArchivedObjectiveRecord = {
        schema_version: 2,
        id: "arch-p-1",
        type: "proposal",
        statement: "hot reload",
        generation: 1,
        completed_at: "2026-09-01T00:00:00.000Z",
        result: "declined",
        write_scope: ["src/r.ts"],
        details: { kind: "proposal", decline_reason: "unsupported" },
      };
      spies.push(spyOn(archivalModule, "readArchivedObjectives").mockReturnValue([archProp]));
      const resProp = evaluateGate6NotADuplicate(cProp, ctx());
      expect(resProp.passed).toBe(false);
      expect(resProp.reason).toContain("arch-p-1");

      const cDefect = cand({
        id: "c-arch-d",
        kind: "defect",
        statement: "Buffer overflow",
        write_scope: ["src/p.ts"],
      });
      const archDefect: ArchivedObjectiveRecord = {
        schema_version: 2,
        id: "arch-d-1",
        type: "defect",
        statement: "buffer overflow",
        generation: 1,
        completed_at: "2026-09-01T00:00:00.000Z",
        result: "declined",
        write_scope: ["src/p.ts"],
      };
      spies.push(spyOn(archivalModule, "readArchivedObjectives").mockReturnValue([archDefect]));
      const resDefect = evaluateGate6NotADuplicate(cDefect, ctx());
      expect(resDefect.passed).toBe(false);
      expect(resDefect.reason).toContain("arch-d-1");
    });

    it("handles Error and non-Error exceptions when reading archived objectives", () => {
      spies.push(
        spyOn(archivalModule, "readArchivedObjectives").mockImplementation(() => {
          throw new Error("I/O lock contention");
        }),
      );
      expect(evaluateGate6NotADuplicate(cand(), ctx()).reason).toContain("I/O lock contention");

      spies.push(
        spyOn(archivalModule, "readArchivedObjectives").mockImplementation(() => {
          throw "non-error raw string";
        }),
      );
      expect(evaluateGate6NotADuplicate(cand(), ctx()).reason).toContain(
        "unknown archival ledger error",
      );
    });

    it("passes Gate 6 when candidates, tasks, and archived items contain non-duplicates", () => {
      const cUnique = cand({
        id: "c-unique",
        statement: "Novel improvement",
        write_scope: ["src/u.ts"],
      });
      const ctxAll = ctx({
        state: {
          candidates: [
            { id: "c-unique", statement: "Self", write_scope: ["src/u.ts"], status: "opened" },
            {
              id: "c-other",
              statement: "Unrelated",
              write_scope: ["src/other.ts"],
              status: "admitted",
            },
            {
              id: "c-dec-unrelated",
              statement: "Declined other",
              write_scope: ["src/other.ts"],
              status: "declined",
            },
          ],
          tasks: {
            "task-ready": {
              status: "ready",
              label: "unrelated task",
              write_scope: ["src/other.ts"],
            },
            "task-done": {
              status: "completed",
              label: "Novel improvement",
              write_scope: ["src/u.ts"],
            },
            "invalid-task": null as unknown as Record<string, unknown>,
          },
        },
      });

      const archDone: ArchivedObjectiveRecord = {
        schema_version: 2,
        id: "arch-done",
        type: "defect",
        statement: "Novel improvement",
        generation: 1,
        completed_at: "2026-09-01T00:00:00.000Z",
        result: "completed",
        write_scope: ["src/u.ts"],
      };

      spies.push(spyOn(archivalModule, "readArchivedObjectives").mockReturnValue([archDone]));
      const res = evaluateGate6NotADuplicate(cUnique, ctxAll);
      expect(res.passed).toBe(true);
      expect(res.gateId).toBe("gate-6-not-a-duplicate");
      expect(res.gateNumber).toBe(6);
    });
  });
});
