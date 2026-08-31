import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { beginValidation } from "../../../../olt/scripts/src/workflow/review/begin-validation.ts";
import { recordReview } from "../../../../olt/scripts/src/workflow/review/record-review.ts";
import { submitTask } from "../../../../olt/scripts/src/workflow/submission/submit.ts";
import { at, registerCommand, registerTaskPacket, TestPort, workflowState } from "../../shared/test-port.ts";

const clock = at("2026-08-13T12:00:00.000Z");
const INDEPENDENCE = "validator must be independent from implementers";

const report = {
  summary: "done",
  requirement_ids: ["R-1"],
  files_changed: ["src/owned/a.ts"],
  checks: [{ command: "bun test", status: "passed" }],
  evidence: [{ kind: "diff" }],
};

const finding = {
  id: "F-1",
  requirement_id: "R-1",
  severity: "important",
  observation: "the empty payload path is unhandled",
  evidence: [{ path: "src/owned/a.ts" }],
  remediation: "handle the empty payload",
  revalidation: "bun test tests/runner/receipt/output-evidence.test.ts",
  status: "open",
};

/** The error the call refused with, so a test can name the clause instead of accepting any throw. */
function refusal(act: () => unknown): HarnessError {
  try {
    act();
  } catch (error) {
    if (error instanceof HarnessError) return error;
    throw error;
  }
  throw new Error("the call was expected to refuse and did not");
}

function claimSubmit(port: TestPort, agent: string, attempt: number, repair = false): void {
  const { token } = claimTask(port, "T-1", agent, repair ? "repairer" : "implementer", { clock });
  registerTaskPacket(port, repair ? "repairer" : "implementer", agent, attempt);
  submitTask(port, "T-1", agent, token, report, clock);
}

function startValidation(port: TestPort, validator: string): string {
  registerCommand(port, `C-${validator}`, validator);
  const state = beginValidation(port, "T-1", validator, clock);
  const token = state.tasks["T-1"]!.validation_token;
  if (typeof token !== "string") throw new TypeError("validation token missing");
  registerTaskPacket(
    port,
    "validator",
    validator,
    state.tasks["T-1"]!.validations!.at(-1)!.attempt,
  );
  return token;
}

describe("no agent validates a task it has already worked on or reviewed", () => {
  test("the validator of round 1 is refused round 2 of the same task", () => {
    const port = new TestPort(workflowState());
    claimSubmit(port, "worker", 1);
    const token = startValidation(port, "validator-r1");
    recordReview(
      port,
      "T-1",
      "validator-r1",
      {
        verdict: "reject",
        requirement_ids: ["R-1"],
        checks: [{ command_id: "C-validator-r1", result: "passed" }],
        findings: [finding],
        validation_token: token,
      },
      clock,
    );
    expect(port.read().tasks["T-1"]!.status).toBe("changes_requested");
    claimSubmit(port, "worker", 2, true);
    expect(port.read().tasks["T-1"]!.status).toBe("submitted");

    // Round 1's reviewer never held a lease on this task, so only the reviewed-it-before clause can
    // refuse it here: delete that clause and this call succeeds.
    const refused = refusal(() => beginValidation(port, "T-1", "validator-r1", clock));
    expect(refused.code).toBe("INVALID_STATE");
    expect(refused.message).toBe(INDEPENDENCE);

    const second = beginValidation(port, "T-1", "validator-r2", clock);
    expect(second.tasks["T-1"]!.status).toBe("validating");
    expect(second.tasks["T-1"]!.validations!.at(-1)!.attempt).toBe(2);
  });

  test("the task's original implementer is refused, whatever its attempt record says", () => {
    const state = workflowState();
    // The attempt list is emptied so nothing but the original-implementer clause can refuse.
    Object.assign(state.tasks["T-1"]!, {
      status: "submitted",
      original_implementer: "worker",
      attempts: [],
    });
    const port = new TestPort(state);
    const refused = refusal(() => beginValidation(port, "T-1", "worker", clock));
    expect(refused.code).toBe("INVALID_STATE");
    expect(refused.message).toBe(INDEPENDENCE);
    expect(beginValidation(port, "T-1", "validator-fresh", clock).tasks["T-1"]!.status).toBe(
      "validating",
    );
  });

  test("an agent that holds an attempt on the task is refused, even after replacement", () => {
    const state = workflowState();
    // What replacement leaves behind: the attempt stays on record under the agent that made it
    // while the original-implementer field names somebody else.
    Object.assign(state.tasks["T-1"]!, {
      status: "submitted",
      original_implementer: "replacement-worker",
      attempts: [
        { attempt: 1, agent_id: "stale-worker", role: "implementer", kind: "implementation" },
      ],
    });
    const port = new TestPort(state);
    const refused = refusal(() => beginValidation(port, "T-1", "stale-worker", clock));
    expect(refused.code).toBe("INVALID_STATE");
    expect(refused.message).toBe(INDEPENDENCE);
    expect(beginValidation(port, "T-1", "validator-fresh", clock).tasks["T-1"]!.status).toBe(
      "validating",
    );
  });

  test("a task nobody has submitted refuses validation for a different reason", () => {
    const port = new TestPort(workflowState());
    const refused = refusal(() => beginValidation(port, "T-1", "validator-fresh", clock));
    expect(refused.code).toBe("INVALID_STATE");
    expect(refused.message).toBe("task is not submitted");
  });
});
