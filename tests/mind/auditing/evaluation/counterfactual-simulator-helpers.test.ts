import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  auditCandidateIsolation,
  createIsolatedCandidate,
  parseNowIso,
  selectPreviouslyAdmittedCandidates,
} from "../../../../olt/scripts/src/mind/auditing/counterfactual/types.ts";
import type { CandidateRecord } from "../../../../olt/scripts/src/mind/proposals/gates/types.ts";

describe("Mind Counterfactual Simulator - Context Isolation and Helpers", () => {
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

    expect(() => createIsolatedCandidate(null as unknown as CandidateRecord)).toThrow(HarnessError);
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
