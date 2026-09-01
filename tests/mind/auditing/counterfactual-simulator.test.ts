import { describe, expect, it, spyOn, afterEach } from "bun:test";
import * as gatesModule from "../../../olt/scripts/src/mind/proposals/gates/index.ts";
import * as typesModule from "../../../olt/scripts/src/mind/auditing/counterfactual/types.ts";
import { evaluateCandidateCounterfactual } from "../../../olt/scripts/src/mind/auditing/counterfactual/simulator.ts";
import {
  parseNowIso,
  createIsolatedCandidate,
  auditCandidateIsolation,
  selectPreviouslyAdmittedCandidates,
} from "../../../olt/scripts/src/mind/auditing/counterfactual/types.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type {
  CandidateRecord,
  GateEvaluationContext,
} from "../../../olt/scripts/src/mind/proposals/gates/types.ts";

describe("Mind Counterfactual Simulator Suite", () => {
  const spies: Array<{ mockRestore: () => void }> = [];

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  const ctx = (overrides: Partial<GateEvaluationContext> = {}): GateEvaluationContext => ({
    runRoot: "/virtual/run-root",
    actor: "evaluator",
    state: {},
    repoRoots: ["."],
    ...overrides,
  });

  describe("evaluateCandidateCounterfactual - Defect Verification", () => {
    it("throws HarnessError when candidate audit fails context isolation check", () => {
      spies.push(
        spyOn(typesModule, "auditCandidateIsolation").mockReturnValue({
          isolated: false,
          narrativeKeysFound: ["rationale"],
          leakedFields: ["rationale"],
        }),
      );
      expect(() =>
        evaluateCandidateCounterfactual(
          { id: "c-1", kind: "proposal", statement: "Leaked" },
          ctx(),
        ),
      ).toThrow(HarnessError);
    });

    it("flags defect_never_real when witness command ID is missing or command record not found", () => {
      const res1 = evaluateCandidateCounterfactual(
        { id: "c-no-w", kind: "defect", statement: "Unwitnessed", write_scope: ["a.ts"] },
        ctx(),
        { now: "2026-09-01T12:00:00.000Z" },
      );
      expect(res1.admissible).toBe(false);
      expect(res1.finding?.findingKind).toBe("defect_never_real");
      expect(res1.failingGate?.name).toBe("Witnessed");

      spies.push(spyOn(gatesModule, "findCommandRecord").mockReturnValue(null));
      const res2 = evaluateCandidateCounterfactual(
        {
          id: "c-nf",
          kind: "defect",
          statement: "Missing",
          witness_command_id: "cmd-nf",
          write_scope: ["b.ts"],
        },
        ctx(),
      );
      expect(res2.admissible).toBe(false);
      expect(res2.finding?.findingKind).toBe("defect_never_real");
    });

    it("flags witness_exited_zero when witness command executed cleanly or derives exit code 0", () => {
      spies.push(
        spyOn(gatesModule, "findCommandRecord").mockReturnValue({
          command_id: "cmd-0",
          exit_code: 0,
          status: "succeeded",
        }),
      );
      const res1 = evaluateCandidateCounterfactual(
        {
          id: "c-0",
          kind: "defect",
          statement: "Resolved",
          witness_command_id: "cmd-0",
          write_scope: ["c.ts"],
        },
        ctx(),
      );
      expect(res1.admissible).toBe(false);
      expect(res1.finding?.findingKind).toBe("witness_exited_zero");
      expect(res1.admissionVerdicts[0]?.metadata?.exitCode).toBe(0);

      spies.push(
        spyOn(gatesModule, "findCommandRecord").mockReturnValue({
          command_id: "cmd-s",
          status: "succeeded",
        }),
      );
      const res2 = evaluateCandidateCounterfactual(
        {
          id: "c-s",
          kind: "defect",
          statement: "Succ",
          witness_command_id: "cmd-s",
          write_scope: ["s.ts"],
        },
        ctx(),
      );
      expect(res2.finding?.findingKind).toBe("witness_exited_zero");
    });

    it("flags witness_output_missing or proceeds when output contains defect or is missing", () => {
      spies.push(
        spyOn(gatesModule, "findCommandRecord").mockReturnValue({
          command_id: "cmd-f",
          exit_code: 1,
          status: "failed",
        }),
      );
      spies.push(
        spyOn(gatesModule, "readCandidateCommandOutput").mockReturnValue("Different error"),
      );
      spies.push(spyOn(gatesModule, "outputContainsDefect").mockReturnValue(false));

      const res1 = evaluateCandidateCounterfactual(
        {
          id: "c-mm",
          kind: "defect",
          statement: "NullPointer",
          witness_command_id: "cmd-f",
          write_scope: ["e.ts"],
        },
        ctx(),
      );
      expect(res1.admissible).toBe(false);
      expect(res1.finding?.findingKind).toBe("witness_output_missing");

      spies.push(
        spyOn(gatesModule, "findCommandRecord").mockReturnValue({
          command_id: "cmd-failed-no-exit",
          status: "failed",
        }),
      );
      spies.push(spyOn(gatesModule, "readCandidateCommandOutput").mockReturnValue(null));
      spies.push(
        spyOn(gatesModule, "evaluateAdmissionGates").mockReturnValue({
          admitted: true,
          verdicts: [
            { gateId: "gate-1-witnessed", gateNumber: 1, name: "Witnessed", passed: true },
          ],
        }),
      );
      const res2 = evaluateCandidateCounterfactual(
        {
          id: "c-ok",
          kind: "defect",
          statement: "AssertErr",
          witness_command_id: "cmd-failed-no-exit",
          write_scope: ["t.ts"],
        },
        ctx(),
      );
      expect(res2.admissible).toBe(true);

      spies.push(
        spyOn(gatesModule, "findCommandRecord").mockReturnValue({
          command_id: "cmd-other-status",
          status: "other",
        }),
      );
      const res3 = evaluateCandidateCounterfactual(
        {
          id: "c-other",
          kind: "defect",
          statement: "AssertErr",
          witness_command_id: "cmd-other-status",
          write_scope: ["t.ts"],
        },
        ctx(),
      );
      expect(res3.admissible).toBe(true);
    });
  });

  describe("evaluateCandidateCounterfactual - Re-Admission Gates Flow", () => {
    it("evaluates owner-decision defect and proceeds directly to gate checks", () => {
      spies.push(
        spyOn(gatesModule, "evaluateAdmissionGates").mockReturnValue({
          admitted: true,
          verdicts: [
            { gateId: "gate-1-witnessed", gateNumber: 1, name: "Witnessed", passed: true },
          ],
        }),
      );
      const res = evaluateCandidateCounterfactual(
        {
          id: "c-own",
          kind: "defect",
          statement: "Owner defect",
          witness_command_id: "owner-decision",
          write_scope: ["a.ts"],
        },
        ctx(),
      );
      expect(res.admissible).toBe(true);
      expect(res.defectPersists).toBe(true);
    });

    it("maps falsifier passed on gate 3 to falsifier_passed finding", () => {
      spies.push(
        spyOn(gatesModule, "evaluateAdmissionGates").mockReturnValue({
          admitted: false,
          falsifierExitObserved: 0,
          failingGate: {
            gateId: "gate-3-falsifiable",
            gateNumber: 3,
            name: "Falsifiable",
            passed: false,
            reason: "falsifier command exited with 0 (expected non-zero)",
          },
          verdicts: [],
        }),
      );
      const res = evaluateCandidateCounterfactual(
        { id: "c-fp", kind: "proposal", statement: "Falsifier pass", write_scope: ["p.ts"] },
        ctx(),
      );
      expect(res.admissible).toBe(false);
      expect(res.finding?.findingKind).toBe("falsifier_passed");
    });

    it("maps gate 1 failure to defect_cleared and generic failure to admission_gate_failed", () => {
      spies.push(
        spyOn(gatesModule, "evaluateAdmissionGates").mockReturnValue({
          admitted: false,
          failingGate: {
            gateId: "gate-1-witnessed",
            gateNumber: 1,
            name: "Witnessed",
            passed: false,
            reason: "Failed",
          },
          verdicts: [],
        }),
      );
      const res1 = evaluateCandidateCounterfactual(
        { id: "c-g1", kind: "proposal", statement: "P1", write_scope: ["p.ts"] },
        ctx(),
      );
      expect(res1.finding?.findingKind).toBe("defect_cleared");

      spies.push(
        spyOn(gatesModule, "evaluateAdmissionGates").mockReturnValue({
          admitted: false,
          verdicts: [],
        }),
      );
      const res2 = evaluateCandidateCounterfactual(
        { id: "c-gX", kind: "proposal", statement: "PX", write_scope: ["p.ts"] },
        ctx(),
      );
      expect(res2.finding?.findingKind).toBe("admission_gate_failed");
    });
  });

  describe("Context Isolation and Helpers", () => {
    it("parseNowIso handles all date and timestamp representations", () => {
      const now = 1788264000000;
      expect(parseNowIso(now)).toBe(new Date(now).toISOString());
      expect(parseNowIso(new Date(now))).toBe(new Date(now).toISOString());
      expect(parseNowIso("2026-09-01T00:00:00.000Z")).toBe("2026-09-01T00:00:00.000Z");
      expect(typeof parseNowIso(undefined)).toBe("string");
      expect(typeof parseNowIso("invalid-date-string")).toBe("string");
    });

    it("createIsolatedCandidate strips historical rationale and handles invalid inputs", () => {
      const raw = {
        id: "cand-raw-1",
        kind: "proposal",
        statement: "Raw",
        rationale: "Strip",
        approval_memo: "Strip",
        witness: "cmd-w-1",
        charter_goals: ["G1"],
        falsifier: ["bun", "test"],
        falsifier_exit: 1,
        write_scope: ["src/a.ts"],
      };
      const isolated = createIsolatedCandidate(raw);
      expect(isolated.id).toBe("cand-raw-1");
      expect(isolated.witness_command_id).toBe("cmd-w-1");
      expect(isolated.charter_goal_ids).toEqual(["G1"]);
      expect(isolated.status).toBe("opened");
      expect(auditCandidateIsolation(isolated).isolated).toBe(true);

      expect(() => createIsolatedCandidate(null as unknown as CandidateRecord)).toThrow(
        HarnessError,
      );
      expect(() => createIsolatedCandidate("string" as unknown as CandidateRecord)).toThrow(
        HarnessError,
      );
    });

    it("auditCandidateIsolation flags leaked narrative keys and non-objects", () => {
      expect(auditCandidateIsolation(null).isolated).toBe(false);
      expect(auditCandidateIsolation({ rationale: "leaked" }).isolated).toBe(false);
      expect(auditCandidateIsolation({ justification: "leaked" }).isolated).toBe(false);
      expect(auditCandidateIsolation({ clean_key: "safe" }).isolated).toBe(true);
    });

    it("selectPreviouslyAdmittedCandidates filters and sorts candidates by strategy and count", () => {
      const state = {
        candidates: [
          { id: "c1", status: "admitted", kind: "defect", charter_goal_ids: ["G1"] },
          { id: "c2", status: "opened", kind: "proposal" },
          { id: "c3", status: "admitted", kind: "proposal", charter_goals: ["G2"] },
        ],
      };
      expect(selectPreviouslyAdmittedCandidates(state)).toHaveLength(2);
      expect(selectPreviouslyAdmittedCandidates(state, { filterKind: "proposal" })).toHaveLength(1);
      expect(
        selectPreviouslyAdmittedCandidates(state, { strategy: "newest", count: 1 }),
      ).toHaveLength(1);
      expect(
        selectPreviouslyAdmittedCandidates(state, { strategy: "random", seed: 42 }),
      ).toHaveLength(2);
    });
  });
});
