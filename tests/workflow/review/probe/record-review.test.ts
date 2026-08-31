import { describe, expect, test } from "bun:test";
import { recordReview } from "../../../../olt/scripts/src/workflow/review/record-review.ts";
import { beginValidation } from "../../../../olt/scripts/src/workflow/review/begin-validation.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { submitTask } from "../../../../olt/scripts/src/workflow/submission/submit.ts";
import { at, registerCommand, registerTaskPacket, TestPort, workflowState } from "../../shared/test-port.ts";
import { tokenDigest } from "../../../../olt/scripts/src/workflow/lease/token.ts";
import type { TransactionPort, WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";

const clock = at("2026-08-13T12:00:00.000Z");
const report = {
  summary: "done",
  requirement_ids: ["R-1"],
  files_changed: ["src/owned/a.ts"],
  checks: [{ command: "bun test", status: "passed" }],
  evidence: [{ kind: "diff" }],
};

function submitted(): TestPort {
  const port = new TestPort(workflowState());
  const { token } = claimTask(port, "T-1", "implementer", "implementer", { clock });
  registerTaskPacket(port, "implementer", "implementer", 1);
  submitTask(port, "T-1", "implementer", token, report, clock);
  return port;
}

function validationToken(port: TestPort, validatorId: string): string {
  registerCommand(port, `C-${validatorId}`, validatorId);
  const state = beginValidation(port, "T-1", validatorId, clock);
  const token = state.tasks["T-1"]!.validation_token;
  if (typeof token !== "string") throw new TypeError("validation token missing");
  registerTaskPacket(
    port,
    "validator",
    validatorId,
    state.tasks["T-1"]!.validations!.at(-1)!.attempt,
  );
  return token;
}

describe("recordReview: concurrent-mutation guard", () => {
  test("rejects when the sealed review no longer matches the payload computed before the transaction", () => {
    const port = submitted();
    const token = validationToken(port, "validator");
    const pass = {
      verdict: "pass" as const,
      requirement_ids: ["R-1"],
      checks: [{ command_id: "C-validator" }],
      findings: [],
      validation_token: token,
    };

    // Compute the real, current-state snapshot recordReview would normally derive its guard
    // payload from, then hand recordReview a port whose read() reports a DIFFERENT repair_round
    // than what the real draft holds at transact-time — the same shape a genuine
    // read-then-mutate race would produce, without needing actual concurrency.
    const liveState = port.read();
    const staleState: WorkflowState = structuredClone(liveState);
    (staleState.tasks["T-1"] as { repair_round: number }).repair_round = 5;
    const stalePort: TransactionPort = {
      read: () => staleState,
      transact: (...args) => port.transact(...args),
    };

    expect(() => recordReview(stalePort, "T-1", "validator", pass, clock)).toThrow(
      /the review changed while it was being recorded/,
    );
  });
});

describe("recordReview: reject requires a recorded original implementer", () => {
  test("throws INVALID_STATE for a reject verdict against a task with no original_implementer on record", () => {
    // Every real claim/submit path stamps original_implementer via claimTask, so this state can
    // only arise from state corruption — constructed directly here rather than through the
    // normal claim/submit/validate pipeline, which cannot produce it.
    const state = workflowState();
    const token = "validator-token";
    Object.assign(state.tasks["T-1"]!, {
      status: "validating",
      validations: [
        {
          validator_id: "validator",
          domain: "code-quality",
          token_digest: tokenDigest(token),
          attempt: 1,
          started_at: "2026-08-13T12:00:00.000Z",
          deadline_at: "2026-08-13T13:00:00.000Z",
        },
      ],
    });
    const port = new TestPort(state);
    registerCommand(port, "C-validator", "validator");
    registerTaskPacket(port, "validator", "validator", 1);
    const reject = {
      verdict: "reject" as const,
      requirement_ids: ["R-1"],
      checks: [{ command_id: "C-validator" }],
      findings: [
        {
          id: "F-1",
          requirement_id: "R-1",
          severity: "minor",
          observation: "obs",
          evidence: [{ note: "e" }],
          remediation: "fix",
          revalidation: "re-run",
        },
      ],
      validation_token: token,
    };
    expect(() => recordReview(port, "T-1", "validator", reject, clock)).toThrow(
      /task has no original implementer/,
    );
  });
});
