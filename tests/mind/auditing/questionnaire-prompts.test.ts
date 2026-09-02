import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { HarnessEvent, RunState } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  checkAdmittedCandidateGoals,
  checkAdmittedCandidateWitnesses,
  checkValueConsistency,
} from "../../../olt/scripts/src/mind/auditing/questionnaire/prompts.ts";
import * as witnessModule from "../../../olt/scripts/src/mind/auditing/witness/index.ts";

describe("Questionnaire Prompts Audit Evaluators", () => {
  const spies: Array<{ mockRestore: () => void }> = [];

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  describe("checkAdmittedCandidateWitnesses", () => {
    it("handles candidates from state.candidates and events with various id and witness aliases", () => {
      const state: RunState = {
        candidates: [
          { id: "cand-1", status: "admitted", kind: "defect", witness_command_id: "cmd-wit-1" },
          { id: "cand-2", status: "admitted", kind: "defect", witness: "   " },
          { id: "cand-3", status: "admitted", kind: "feature" }, // non-defect ignored
          { id: "cand-4", status: "open", kind: "defect" }, // non-admitted ignored
        ],
      } as unknown as RunState;

      const events: HarnessEvent[] = [
        {
          schema: "harness-event-v1",
          sequence: 1,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "mind-candidate-admitted",
          payload: { candidate: "cand-event-1", witness: "cmd-wit-event-1" },
        } as unknown as HarnessEvent,
        {
          schema: "harness-event-v1",
          sequence: 2,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "mind-candidate-admitted",
          payload: { candidate_id: "cand-1" }, // duplicate ignored
        } as unknown as HarnessEvent,
      ];

      const spy = spyOn(witnessModule, "verifyDefectWitness").mockImplementation((id) => {
        if (id === "cmd-wit-1") {
          return {
            exitCode: 1,
            status: "failed",
            commandId: id,
            evidenceClass: "harness_observed",
            output: "err",
          };
        }
        if (id === "cmd-wit-event-1") {
          return {
            exitCode: 0,
            status: "succeeded",
            commandId: id,
            evidenceClass: "harness_observed",
            output: "clean",
          };
        }
        throw new Error("unexpected command");
      });
      spies.push(spy);

      const result = checkAdmittedCandidateWitnesses(state, events, { repoRoot: "/tmp/repo" });
      expect(result.ok).toBe(false);
      expect(result.verifiedCount).toBe(2);
      expect(result.findings.some((f) => f.includes("cand-2' has no witness command id"))).toBe(
        true,
      );
      expect(
        result.findings.some((f) => f.includes("cand-event-1' witness 'cmd-wit-event-1' exited 0")),
      ).toBe(true);
    });

    it("handles state.mind.candidates, verification exceptions, and unknown candidate id fallback", () => {
      const state: RunState = {
        mind: {
          candidates: [{ status: "admitted", kind: "defect", witness_command_id: "cmd-err" }],
        },
      } as unknown as RunState;

      const spy = spyOn(witnessModule, "verifyDefectWitness").mockImplementation(() => {
        throw new Error("witness record missing on disk");
      });
      spies.push(spy);

      const result = checkAdmittedCandidateWitnesses(state, [], { capsuleRoot: "/capsule" });
      expect(result.ok).toBe(false);
      expect(result.findings[0]).toContain(
        "admitted defect candidate 'unknown' witness 'cmd-err' verification failed: witness record missing on disk",
      );
    });
  });

  describe("checkAdmittedCandidateGoals", () => {
    it("validates charter goals across state, events, strings, and goal objects", () => {
      const state: RunState = {
        candidates: [
          { id: "c-valid", status: "admitted", charter_goal_ids: ["G-1", "G-2"] },
          { id: "c-empty", status: "admitted", charter_goal_ids: [] },
          { id: "c-obj", status: "admitted", charter_goals: [{ id: "G-1" }, { id: "G-invalid" }] },
        ],
      } as unknown as RunState;

      const events: HarnessEvent[] = [
        {
          schema: "harness-event-v1",
          sequence: 1,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "mind-candidate-admitted",
          payload: { candidate_id: "c-event", charter_goal_ids: ["G-unknown"] },
        } as unknown as HarnessEvent,
        {
          schema: "harness-event-v1",
          sequence: 2,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "mind-candidate-opened",
          payload: { candidate: "c-open-new", charter_goals: ["G-1"] },
        } as unknown as HarnessEvent,
      ];

      const validGoals = new Set(["G-1", "G-2"]);
      const result = checkAdmittedCandidateGoals(state, events, validGoals);

      expect(result.ok).toBe(false);
      expect(result.findings.some((f) => f.includes("c-empty' cites zero charter goals"))).toBe(
        true,
      );
      expect(
        result.findings.some((f) =>
          f.includes("c-obj' cited non-existent charter goal 'G-invalid'"),
        ),
      ).toBe(true);
      expect(
        result.findings.some((f) =>
          f.includes("c-event' cited non-existent charter goal 'G-unknown'"),
        ),
      ).toBe(true);
    });

    it("handles state.mind.candidates, updating existing goal arrays, and unknown id fallback", () => {
      const state: RunState = {
        mind: {
          candidates: [
            { id: "c-exist", status: "admitted" },
            { status: "admitted", charter_goals: ["G-1"] },
          ],
        },
      } as unknown as RunState;

      const events: HarnessEvent[] = [
        {
          schema: "harness-event-v1",
          sequence: 1,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "mind-candidate-admitted",
          payload: { candidate_id: "c-exist", charter_goal_ids: ["G-1"] },
        } as unknown as HarnessEvent,
      ];

      const result = checkAdmittedCandidateGoals(state, events, ["G-1"]);
      expect(result.ok).toBe(true);
      expect(result.findings.length).toBe(0);
    });
  });

  describe("checkValueConsistency", () => {
    it("evaluates computed pulse values against recorded values and detects forbidden keys", () => {
      const events: HarnessEvent[] = [
        // 1. Consistent pulse with metrics object
        {
          schema: "harness-event-v1",
          sequence: 1,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "mind-pulse-closed",
          payload: {
            pulse_id: "P-1",
            value: 17, // 10 (tasks_reaching_done) + 5 (findings_resolved) + 2 (proposals_recorded)
            metrics: {
              tasks_reaching_done: 1,
              findings_resolved: 1,
              proposals_recorded: 1,
              gates_flipped_red_to_green: 0,
              leases_reclaimed: 0,
              candidates_admitted: 0,
            },
          },
        } as unknown as HarnessEvent,
        // 2. Inconsistent pulse with forbidden metrics and default value fallback
        {
          schema: "harness-event-v1",
          sequence: 2,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "mind-pulse-closed",
          payload: {
            pulse_id: "P-2",
            value: 999, // inconsistent
            metrics: {
              tasks_reaching_done: 1,
              files_touched: 5,
              tokens_spent: 1000,
            },
          },
        } as unknown as HarnessEvent,
        // 3. Fallback when metrics is flat payload and pulse_id is omitted
        {
          schema: "harness-event-v1",
          sequence: 3,
          timestamp: "2026-09-01T12:00:00.000Z",
          actor: "agent",
          kind: "mind-pulse-closed",
          payload: {
            tasks_reaching_done: 0,
          },
        } as unknown as HarnessEvent,
      ];

      const result = checkValueConsistency(events, {} as RunState);
      expect(result.ok).toBe(false);
      expect(result.series).toEqual([17, 999, 0]);
      expect(
        result.findings.some((f) => f.includes("pulse P-2 recorded value 999 inconsistent")),
      ).toBe(true);
      expect(
        result.findings.some((f) =>
          f.includes("pulse P-2 metric 'files_touched' is explicitly excluded"),
        ),
      ).toBe(true);
      expect(
        result.findings.some((f) =>
          f.includes("pulse P-2 metric 'tokens_spent' is explicitly excluded"),
        ),
      ).toBe(true);
    });
  });
});
