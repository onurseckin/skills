import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { assertCriticIndependent } from "../../../olt/scripts/src/workflow/completion/critic-identity.ts";
import { workflowState } from "./test-port.ts";

// B26: the completeness critic role is refused to any identity this run has already used as an
// implementer, repairer, lease holder, attempter, or validator - the independence guarantee the
// audit found asserted 12+ times in prose and proven by no test at all.

describe("assertCriticIndependent", () => {
  test("does not refuse an identity the run has never used", () => {
    const state = workflowState();
    expect(() => assertCriticIndependent(state, "critic-1")).not.toThrow();
  });

  test("refuses the original implementer of a task", () => {
    const state = workflowState();
    state.tasks["T-1"]!.original_implementer = "critic-1";
    expect(() => assertCriticIndependent(state, "critic-1")).toThrow(HarnessError);
    try {
      assertCriticIndependent(state, "critic-1");
      throw new Error("the guard was expected to refuse");
    } catch (error) {
      expect((error as HarnessError).code).toBe("INVALID_STATE");
      expect((error as HarnessError).message).toBe(
        "completeness critic must be independent from implementers, repairers, and validators",
      );
    }
  });

  test("refuses the assignee of a repair round", () => {
    const state = workflowState();
    state.tasks["T-1"]!.repair_assignee = "critic-1";
    expect(() => assertCriticIndependent(state, "critic-1")).toThrow(HarnessError);
  });

  test("refuses an agent that currently holds a task's lease", () => {
    const state = workflowState();
    state.tasks["T-1"]!.lease = {
      agent_id: "critic-1",
      role: "implementer",
      attempt: 1,
      token_digest: "d".repeat(64),
      issued_at: "2026-08-13T12:00:00.000Z",
      expires_at: "2026-08-13T13:00:00.000Z",
      heartbeat_at: "2026-08-13T12:00:00.000Z",
      duration_seconds: 3600,
    };
    expect(() => assertCriticIndependent(state, "critic-1")).toThrow(HarnessError);
  });

  test("refuses an agent recorded in a task's attempt history", () => {
    const state = workflowState();
    state.tasks["T-1"]!.attempts = [{ agent_id: "critic-1" }];
    expect(() => assertCriticIndependent(state, "critic-1")).toThrow(HarnessError);
  });

  // The case B26 calls out by name: "critic-identity.ts disqualifies any agent that validated
  // anything from serving as completeness critic run-wide" - a validator that reviewed round 1
  // must not later certify the whole run's completeness, active assignment or historical.
  test("refuses the current validator of a task", () => {
    const state = workflowState();
    state.tasks["T-1"]!.validations = [
      {
        validator_id: "critic-1",
        domain: "code-quality",
        token_digest: "d".repeat(64),
        attempt: 1,
        started_at: "2026-08-13T12:00:00.000Z",
        deadline_at: "2026-08-13T12:20:00.000Z",
      },
    ];
    expect(() => assertCriticIndependent(state, "critic-1")).toThrow(HarnessError);
  });

  test("refuses a validator recorded only in a task's validation history", () => {
    const state = workflowState();
    state.tasks["T-1"]!.validation_history = [
      {
        validator_id: "critic-1",
        domain: "code-quality",
        token_digest: "d".repeat(64),
        attempt: 1,
        started_at: "2026-08-13T12:00:00.000Z",
        deadline_at: "2026-08-13T12:20:00.000Z",
        verdict: "reject",
      },
    ];
    expect(() => assertCriticIndependent(state, "critic-1")).toThrow(HarnessError);
  });
});
