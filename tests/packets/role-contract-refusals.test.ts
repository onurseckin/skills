import { describe, expect, test } from "bun:test";
import { claimTask } from "../../olt/scripts/src/workflow/lease/claim.ts";
import { beginValidation } from "../../olt/scripts/src/workflow/review/begin-validation.ts";
import { recordReview } from "../../olt/scripts/src/workflow/review/record-review.ts";
import { submitTask } from "../../olt/scripts/src/workflow/submission/submit.ts";
import {
  at,
  registerCommand,
  registerTaskPacket,
  TestPort,
  workflowState,
} from "../workflow/test-port.ts";

// The "a granted role cannot invoke a command its contract withholds" cases are covered directly
// against assertRoleMayInvoke in role-contract-enforcement.test.ts; this file keeps the in-memory
// domain-level cases only (a packet published for the wrong role/agent/attempt/action).

const clock = at("2026-08-13T12:00:00.000Z");
const report = {
  summary: "done",
  requirement_ids: ["R-1"],
  files_changed: ["src/owned/a.ts"],
  checks: [{ command: "bun test", status: "passed" }],
  evidence: [{ kind: "diff" }],
};

describe("acting without a published contract is refused", () => {
  test("an implementer cannot submit without a published packet", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "implementer", "implementer", { clock });
    expect(() => submitTask(port, "T-1", "implementer", token, report, clock)).toThrow(
      "implementer action requires a matching durably published packet",
    );
    registerTaskPacket(port, "implementer", "implementer", 1);
    expect(
      submitTask(port, "T-1", "implementer", token, report, clock).state.tasks["T-1"]!.status,
    ).toBe("submitted");
  });

  test("a repairer cannot submit without a published packet", () => {
    // submitTask's guard reads lease.role, not a literal "implementer" — the only way to prove it
    // actually covers repairer too is to drive a real reject-then-repair cycle and claim under that
    // role, the same path task-state uses to route rejected work back to the original implementer.
    const port = new TestPort(workflowState());
    const { token: implToken } = claimTask(port, "T-1", "implementer", "implementer", { clock });
    registerTaskPacket(port, "implementer", "implementer", 1);
    submitTask(port, "T-1", "implementer", implToken, report, clock);
    registerCommand(port, "C-validator", "validator");
    const started = beginValidation(port, "T-1", "validator", clock);
    registerTaskPacket(
      port,
      "validator",
      "validator",
      started.tasks["T-1"]!.validations!.at(-1)!.attempt,
    );
    recordReview(
      port,
      "T-1",
      "validator",
      {
        verdict: "reject",
        requirement_ids: ["R-1"],
        checks: [{ command_id: "C-validator" }],
        findings: [
          {
            id: "F-1",
            requirement_id: "R-1",
            severity: "important",
            observation: "missing test",
            evidence: [{ path: "a.ts" }],
            remediation: "add test",
            revalidation: "bun test",
          },
        ],
        validation_token: started.tasks["T-1"]!.validation_token,
      },
      clock,
    );
    const { token: repairToken } = claimTask(port, "T-1", "implementer", "repairer", { clock });
    expect(() => submitTask(port, "T-1", "implementer", repairToken, report, clock)).toThrow(
      "repairer action requires a matching durably published packet",
    );
    registerTaskPacket(port, "repairer", "implementer", 2);
    expect(
      submitTask(port, "T-1", "implementer", repairToken, report, clock).state.tasks["T-1"]!.status,
    ).toBe("submitted");
  });

  test("a packet published for another agent, role or attempt does not carry the submission", () => {
    for (const wrong of [
      ["implementer", "other-agent", 1],
      ["validator", "implementer", 1],
      ["implementer", "implementer", 2],
    ] as const) {
      const port = new TestPort(workflowState());
      const { token } = claimTask(port, "T-1", "implementer", "implementer", { clock });
      registerTaskPacket(port, wrong[0], wrong[1], wrong[2]);
      expect(() => submitTask(port, "T-1", "implementer", token, report, clock)).toThrow(
        "requires a matching durably published packet",
      );
    }
  });

  test("a validator cannot record a verdict without a published packet", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "implementer", "implementer", { clock });
    registerTaskPacket(port, "implementer", "implementer", 1);
    submitTask(port, "T-1", "implementer", token, report, clock);
    registerCommand(port, "C-validator", "validator");
    const started = beginValidation(port, "T-1", "validator", clock);
    const validationToken = started.tasks["T-1"]!.validation_token;
    const review = {
      verdict: "reject",
      requirement_ids: ["R-1"],
      checks: [{ command_id: "C-validator" }],
      findings: [
        {
          id: "F-1",
          requirement_id: "R-1",
          severity: "important",
          observation: "missing test",
          evidence: [{ path: "a.ts" }],
          remediation: "add test",
          revalidation: "bun test",
        },
      ],
      validation_token: validationToken,
    };
    expect(() => recordReview(port, "T-1", "validator", review, clock)).toThrow(
      "validator action requires a matching durably published packet",
    );
    registerTaskPacket(
      port,
      "validator",
      "validator",
      started.tasks["T-1"]!.validations!.at(-1)!.attempt,
    );
    expect(recordReview(port, "T-1", "validator", review, clock).tasks["T-1"]!.status).toBe(
      "changes_requested",
    );
  });

  test("orphan evidence from an expired lease is still preserved", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "implementer", "implementer", {
      clock,
      leaseSeconds: 5,
    });
    const later = at("2026-08-13T12:30:00.000Z");
    const state = submitTask(port, "T-1", "implementer", token, report, later);
    expect(state.orphaned).toBe(true);
    expect(state.state.orphan_evidence).toHaveLength(1);
  });
});
