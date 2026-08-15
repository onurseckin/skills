import { describe, expect, test } from "bun:test";
import { assignReplacementRepairer } from "../../../orchestrating-long-tasks/scripts/src/workflow/review/assign-repairer.ts";
import { beginValidation } from "../../../orchestrating-long-tasks/scripts/src/workflow/review/begin-validation.ts";
import { recordReview } from "../../../orchestrating-long-tasks/scripts/src/workflow/review/record-review.ts";
import { claimTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import { recoverStale } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/recover-stale.ts";
import { submitTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/submission/submit.ts";
import { at, registerCommand, registerTaskPacket, TestPort, workflowState } from "./test-port.ts";

const clock = at("2026-08-13T12:00:00.000Z");
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
  observation: "missing test",
  evidence: [{ path: "a.ts" }],
  remediation: "add test",
  revalidation: "bun test",
  status: "open",
};

function submitted(): TestPort {
  const port = new TestPort(workflowState());
  const { token } = claimTask(port, "T-1", "implementer", "implementer", { clock });
  registerTaskPacket(port, "implementer", "implementer", 1);
  submitTask(port, "T-1", "implementer", token, report, clock);
  return port;
}

function reject(port: TestPort, validator = "validator", findingId = finding.id) {
  const commandId = `C-${validator}`;
  registerCommand(port, commandId, validator);
  const started = beginValidation(port, "T-1", validator, clock);
  registerTaskPacket(port, "validator", validator, started.tasks["T-1"]!.validation!.attempt);
  return recordReview(
    port,
    "T-1",
    validator,
    {
      verdict: "reject",
      validation_token: started.tasks["T-1"]!.validation_token,
      requirement_ids: ["R-1"],
      checks: [{ command_id: commandId, result: "failed" }],
      findings: [{ ...finding, id: findingId }],
    },
    clock,
  );
}

describe("repair and validator policy", () => {
  test("authenticates each review and requires a fresh validator across rounds", () => {
    const port = submitted();
    registerCommand(port, "C-validator", "validator");
    const started = beginValidation(port, "T-1", "validator", clock);
    registerTaskPacket(port, "validator", "validator", 1);
    expect(() =>
      recordReview(
        port,
        "T-1",
        "validator",
        {
          verdict: "pass",
          validation_token: "wrong",
          requirement_ids: ["R-1"],
          checks: [{ command_id: "C-validator", result: "passed" }],
          findings: [],
        },
        clock,
      ),
    ).toThrow();
    recordReview(
      port,
      "T-1",
      "validator",
      {
        verdict: "reject",
        validation_token: started.tasks["T-1"]!.validation_token,
        requirement_ids: ["R-1"],
        checks: [{ command_id: "C-validator", result: "failed" }],
        findings: [finding],
      },
      clock,
    );
    const { token } = claimTask(port, "T-1", "implementer", "repairer", { clock });
    registerTaskPacket(port, "repairer", "implementer", 2);
    submitTask(port, "T-1", "implementer", token, report, clock);
    expect(() => beginValidation(port, "T-1", "validator", clock)).toThrow();
  });

  test("requires structured nonempty revalidation proof to resolve findings", () => {
    const port = submitted();
    reject(port);
    const { token } = claimTask(port, "T-1", "implementer", "repairer", { clock });
    registerTaskPacket(port, "repairer", "implementer", 2);
    submitTask(port, "T-1", "implementer", token, report, clock);
    registerCommand(port, "C-validator-2", "validator-2");
    const started = beginValidation(port, "T-1", "validator-2", clock);
    registerTaskPacket(port, "validator", "validator-2", 2);
    const base = {
      verdict: "pass",
      validation_token: started.tasks["T-1"]!.validation_token,
      requirement_ids: ["R-1"],
      checks: [{ command_id: "C-validator-2", result: "passed" }],
      findings: [],
    };
    expect(() =>
      recordReview(
        port,
        "T-1",
        "validator-2",
        {
          ...base,
          resolved_findings: [{ finding_id: "F-1", method: "bun test", evidence: [] }],
        },
        clock,
      ),
    ).toThrow();
    expect(() =>
      recordReview(
        port,
        "T-1",
        "validator-2",
        {
          ...base,
          resolved_findings: [{ finding_id: "F-1", method: "bun test", evidence: [{}] }],
        },
        clock,
      ),
    ).toThrow();
    const state = recordReview(
      port,
      "T-1",
      "validator-2",
      {
        ...base,
        resolved_findings: [
          {
            finding_id: "F-1",
            method: "bun test",
            evidence: [{ command_id: "C-validator-2" }],
          },
        ],
      },
      clock,
    );
    expect(state.tasks["T-1"]!.findings![0]!.revalidation_proof).toEqual({
      method: "bun test",
      evidence: [{ command_id: "C-validator-2" }],
    });
  });
  test("permits an evidenced replacement after the original is unavailable", () => {
    const port = submitted();
    reject(port);
    expect(() =>
      assignReplacementRepairer(port, "T-1", "replacement", "coordinator", "unavailable", ""),
    ).toThrow();
    assignReplacementRepairer(
      port,
      "T-1",
      "replacement",
      "coordinator",
      "unavailable",
      "host reports agent exited",
    );
    const claimed = claimTask(port, "T-1", "replacement", "repairer", { clock });
    expect(claimed.state.tasks["T-1"]!.lease!.agent_id).toBe("replacement");
    expect(claimed.state.tasks["T-1"]!.replacement_reason).toBe("unavailable");
    expect(claimed.state.tasks["T-1"]!.replacement_evidence).toBe("host reports agent exited");
  });

  test("permits replacement after a stale original repair or repeated rejection", () => {
    const stalePort = submitted();
    reject(stalePort);
    claimTask(stalePort, "T-1", "implementer", "repairer", { leaseSeconds: 5, clock });
    recoverStale(stalePort, "coordinator", at("2026-08-13T12:00:36.000Z"), { graceSeconds: 30 });
    assignReplacementRepairer(
      stalePort,
      "T-1",
      "replacement",
      "coordinator",
      "stale",
      "lease recovery event",
    );
    expect(
      claimTask(stalePort, "T-1", "replacement", "repairer", { clock }).state.tasks["T-1"]!.lease,
    ).toBeDefined();

    const repeatedPort = submitted();
    reject(repeatedPort, "validator-a");
    const repair = claimTask(repeatedPort, "T-1", "implementer", "repairer", { clock });
    registerTaskPacket(repeatedPort, "repairer", "implementer", 2);
    submitTask(repeatedPort, "T-1", "implementer", repair.token, report, clock);
    reject(repeatedPort, "validator-b", "F-2");
    assignReplacementRepairer(
      repeatedPort,
      "T-1",
      "replacement",
      "coordinator",
      "repeated_failure",
      "two rejected rounds",
    );
    expect(
      claimTask(repeatedPort, "T-1", "replacement", "repairer", { clock }).state.tasks["T-1"]!
        .lease,
    ).toBeDefined();
  });
});
