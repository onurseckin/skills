import { describe, expect, test } from "bun:test";
import { beginValidation } from "../../../../orchestrating-long-tasks/scripts/src/workflow/review/begin-validation.ts";
import { recordProbe } from "../../../../orchestrating-long-tasks/scripts/src/workflow/review/record-probe.ts";
import { recordReview } from "../../../../orchestrating-long-tasks/scripts/src/workflow/review/record-review.ts";
import { claimTask } from "../../../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import { submitTask } from "../../../../orchestrating-long-tasks/scripts/src/workflow/submission/submit.ts";
import { at, registerCommand, registerTaskPacket, TestPort, workflowState } from "../test-port.ts";

const clock = at("2026-08-19T09:00:00.000Z");

const report = {
  summary: "done",
  requirement_ids: ["R-1"],
  files_changed: ["src/owned/a.ts"],
  checks: [{ command: "bun test", status: "passed" }],
  evidence: [{ kind: "diff" }],
};

const demand = {
  id: "probe-T-1-01-1",
  class: "probe_demand",
  requirement_id: "R-1",
  severity: "minor",
  observation: "Prove the parser rejects an empty payload",
  evidence: [{ kind: "demand", detail: "empty payload", evidence_class: "agent_reported" }],
  remediation: "Answer the demand with evidence.",
  revalidation: "Cite a command id that proves this for T-1",
};

const defect = {
  id: "F-1",
  class: "defect",
  requirement_id: "R-1",
  severity: "important",
  observation: "empty payload crashes the parser",
  evidence: [{ path: "a.ts" }],
  remediation: "guard the empty payload",
  revalidation: "bun test",
};

function submitted(): TestPort {
  const port = new TestPort(workflowState());
  const { token } = claimTask(port, "T-1", "implementer", "implementer", { clock });
  registerTaskPacket(port, "implementer", "implementer", 1);
  submitTask(port, "T-1", "implementer", token, report, clock);
  return port;
}

function validationToken(port: TestPort, validator: string): string {
  registerCommand(port, `C-${validator}`, validator);
  const state = beginValidation(port, "T-1", validator, clock);
  registerTaskPacket(
    port,
    "validator",
    validator,
    state.tasks["T-1"]!.validations!.at(-1)!.attempt,
  );
  const token = state.tasks["T-1"]!.validation_token;
  if (typeof token !== "string") throw new TypeError("validation token missing");
  return token;
}

function reviewEvent(port: TestPort): Record<string, unknown> {
  const event = port.events.filter((entry) => entry.kind === "review-recorded").at(-1);
  if (!event) throw new TypeError("no review-recorded event");
  return event.payload;
}

function pass(validator: string, token: string) {
  return {
    verdict: "pass",
    validation_token: token,
    requirement_ids: ["R-1"],
    checks: [{ command_id: `C-${validator}` }],
    findings: [],
  };
}

function reject(validator: string, token: string, findings: unknown[]) {
  return {
    verdict: "reject",
    validation_token: token,
    requirement_ids: ["R-1"],
    checks: [{ command_id: `C-${validator}` }],
    findings,
  };
}

function answer(validator: string, findingId: string, method: string) {
  return { finding_id: findingId, method, evidence: [{ command_id: `C-${validator}` }] };
}

function repaired(port: TestPort, attempt: number): void {
  const { token } = claimTask(port, "T-1", "implementer", "repairer", { clock });
  registerTaskPacket(port, "repairer", "implementer", attempt);
  submitTask(port, "T-1", "implementer", token, report, clock);
}

describe("the review-recorded payload describes the verdict it records", () => {
  test("a rejection carries its verdict, repair round, finding count and class", () => {
    const port = submitted();
    const token = validationToken(port, "validator");
    recordReview(port, "T-1", "validator", reject("validator", token, [defect]), clock);
    expect(reviewEvent(port)).toEqual({
      task_id: "T-1",
      verdict: "reject",
      round: 1,
      finding_count: 1,
      class: "defect",
    });
  });

  test("a clean pass says so, and counts the demands it closed", () => {
    const port = submitted();
    const token = validationToken(port, "validator");
    recordProbe(port, "T-1", "validator", { validation_token: token, findings: [demand] }, clock);
    recordReview(
      port,
      "T-1",
      "validator",
      {
        ...pass("validator", token),
        resolved_findings: [answer("validator", demand.id, "probe_demand_answered")],
      },
      clock,
      6,
      1,
    );
    expect(reviewEvent(port)).toEqual({
      task_id: "T-1",
      verdict: "pass",
      round: 0,
      finding_count: 0,
      class: "probe_demand",
      resolved_count: 1,
    });
  });

  test("a finding that declares no class contributes none to the payload", () => {
    const port = submitted();
    const token = validationToken(port, "validator");
    const { class: _declared, ...classless } = defect;
    recordReview(port, "T-1", "validator", reject("validator", token, [classless]), clock);
    const payload = reviewEvent(port);
    expect(payload).toEqual({ task_id: "T-1", verdict: "reject", round: 1, finding_count: 1 });
    expect("class" in payload).toBe(false);
  });

  test("a pass that closes both a defect and a demand claims neither class", () => {
    const port = submitted();
    const firstToken = validationToken(port, "validator");
    recordReview(port, "T-1", "validator", reject("validator", firstToken, [defect]), clock);
    repaired(port, 2);

    const token = validationToken(port, "validator-2");
    recordProbe(port, "T-1", "validator-2", { validation_token: token, findings: [demand] }, clock);
    recordReview(
      port,
      "T-1",
      "validator-2",
      {
        ...pass("validator-2", token),
        resolved_findings: [
          answer("validator-2", defect.id, "verification_passed"),
          answer("validator-2", demand.id, "probe_demand_answered"),
        ],
      },
      clock,
      6,
      1,
    );
    const payload = reviewEvent(port);
    expect(payload).toEqual({
      task_id: "T-1",
      verdict: "pass",
      round: 1,
      finding_count: 0,
      resolved_count: 2,
    });
    expect("class" in payload).toBe(false);
  });
});
