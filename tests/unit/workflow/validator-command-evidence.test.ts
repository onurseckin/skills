import { describe, expect, test } from "bun:test";
import { claimTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import { beginValidation } from "../../../orchestrating-long-tasks/scripts/src/workflow/review/begin-validation.ts";
import { recordReview } from "../../../orchestrating-long-tasks/scripts/src/workflow/review/record-review.ts";
import { submitTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/submission/submit.ts";
import {
  at,
  commandRecord,
  registerTaskPacket,
  SECOND_TEST_GATE_ARGV,
  TestPort,
  workflowState,
} from "./test-port.ts";

const clock = at("2026-08-13T12:00:00.000Z");
const report = {
  summary: "implemented",
  requirement_ids: ["R-1"],
  files_changed: ["src/owned/a.ts"],
  checks: [{ command_id: "C-IMPLEMENT" }],
  evidence: [{ path: "src/owned/a.ts" }],
};
const finding = {
  id: "F-1",
  requirement_id: "R-1",
  severity: "important" as const,
  observation: "missing behavior",
  evidence: [{ path: "src/owned/a.ts" }],
  remediation: "repair it",
  revalidation: "run focused test",
  status: "open" as const,
};

function submitted(commands = {}) {
  const state = workflowState();
  Object.assign(state.commands, commands);
  const port = new TestPort(state);
  const claim = claimTask(port, "T-1", "implementer", "implementer", { clock });
  registerTaskPacket(port, "implementer", "implementer", 1);
  submitTask(port, "T-1", "implementer", claim.token, report, clock);
  return port;
}

function token(port: TestPort, validator: string): string {
  const state = beginValidation(port, "T-1", validator, clock);
  registerTaskPacket(port, "validator", validator, state.tasks["T-1"]!.validation!.attempt);
  return state.tasks["T-1"]!.validation_token as string;
}

function review(validationToken: string, commandId: string) {
  return {
    verdict: "reject",
    validation_token: validationToken,
    requirement_ids: ["R-1"],
    checks: [{ command_id: commandId, caller_claim: "passed" }],
    findings: [finding],
  };
}

describe("authoritative validator command evidence", () => {
  test("rejects missing, failed, wrong-task, and wrong-validator check commands", () => {
    for (const [id, command] of [
      ["C-MISSING", undefined],
      ["C-FAILED", commandRecord("C-FAILED", { status: "failed", exit_code: 1 })],
      ["C-TASK", commandRecord("C-TASK", { task_id: "T-other" })],
      ["C-ACTOR", commandRecord("C-ACTOR", { actor: "someone-else" })],
    ] as const) {
      const port = submitted(command ? { [id]: command } : {});
      const validationToken = token(port, "validator");
      expect(() =>
        recordReview(port, "T-1", "validator", review(validationToken, id), clock),
      ).toThrow();
    }
  });

  test("rejects zero-test and non-gate validator evidence", () => {
    for (const [id, command] of [
      [
        "C-ZERO",
        commandRecord("C-ZERO", { evidence_issues: ["test command discovered zero tests"] }),
      ],
      ["C-UNRELATED", commandRecord("C-UNRELATED", { argv: SECOND_TEST_GATE_ARGV })],
    ] as const) {
      const port = submitted({ [id]: command });
      const validationToken = token(port, "validator");
      expect(() =>
        recordReview(port, "T-1", "validator", review(validationToken, id), clock),
      ).toThrow();
    }
  });

  test("requires independent checks to cover every applicable mandatory task gate", () => {
    const port = submitted({
      "C-V1": commandRecord("C-V1"),
      "C-V2": commandRecord("C-V2", { argv: SECOND_TEST_GATE_ARGV, gate_id: "G-2" }),
    });
    port.transact("planner", "gate-added", {}, (draft) => {
      draft.gates.push({
        id: "G-2",
        command: SECOND_TEST_GATE_ARGV,
        cwd: ".",
        scope: "task",
        requirement_ids: ["R-1"],
        mandatory: true,
      });
    });
    const validationToken = token(port, "validator");

    expect(() =>
      recordReview(port, "T-1", "validator", review(validationToken, "C-V1"), clock),
    ).toThrow(/mandatory task gates/i);
    const state = recordReview(
      port,
      "T-1",
      "validator",
      {
        ...review(validationToken, "C-V1"),
        checks: [{ command_id: "C-V1" }, { command_id: "C-V2" }],
      },
      clock,
    );
    expect(state.tasks["T-1"]!.status).toBe("changes_requested");
  });

  test("normalizes successful authoritative checks to command IDs", () => {
    const port = submitted({ "C-V": commandRecord("C-V") });
    const state = recordReview(
      port,
      "T-1",
      "validator",
      review(token(port, "validator"), "C-V"),
      clock,
    );
    expect(state.tasks["T-1"]!.validation_history![0]!.checks).toEqual([{ command_id: "C-V" }]);
  });

  test("resolves revalidation against the fresh validator and same task", () => {
    const port = submitted({
      "C-V1": commandRecord("C-V1"),
      "C-OLD": commandRecord("C-OLD", { actor: "validator" }),
      "C-V2": commandRecord("C-V2", { actor: "validator-2" }),
    });
    recordReview(port, "T-1", "validator", review(token(port, "validator"), "C-V1"), clock);
    const repair = claimTask(port, "T-1", "implementer", "repairer", { clock });
    registerTaskPacket(port, "repairer", "implementer", 2);
    submitTask(port, "T-1", "implementer", repair.token, report, clock);
    const validationToken = token(port, "validator-2");
    const passing = {
      verdict: "pass",
      validation_token: validationToken,
      requirement_ids: ["R-1"],
      checks: [{ command_id: "C-V2" }],
      findings: [],
    };
    expect(() =>
      recordReview(
        port,
        "T-1",
        "validator-2",
        {
          ...passing,
          resolved_findings: [
            { finding_id: "F-1", method: "focused test", evidence: [{ command_id: "C-OLD" }] },
          ],
        },
        clock,
      ),
    ).toThrow();
    const state = recordReview(
      port,
      "T-1",
      "validator-2",
      {
        ...passing,
        resolved_findings: [
          { finding_id: "F-1", method: "focused test", evidence: [{ command_id: "C-V2" }] },
        ],
      },
      clock,
    );
    expect(state.tasks["T-1"]!.findings![0]!.revalidation_proof).toEqual({
      method: "focused test",
      evidence: [{ command_id: "C-V2" }],
    });
  });

  test("rejects finding IDs already used by an earlier review", () => {
    const port = submitted({
      "C-V1": commandRecord("C-V1"),
      "C-V2": commandRecord("C-V2", { actor: "validator-2" }),
    });
    recordReview(port, "T-1", "validator", review(token(port, "validator"), "C-V1"), clock);
    const repair = claimTask(port, "T-1", "implementer", "repairer", { clock });
    registerTaskPacket(port, "repairer", "implementer", 2);
    submitTask(port, "T-1", "implementer", repair.token, report, clock);
    const validationToken = token(port, "validator-2");

    expect(() =>
      recordReview(port, "T-1", "validator-2", review(validationToken, "C-V2"), clock),
    ).toThrow(/finding.*already/i);
  });
});
