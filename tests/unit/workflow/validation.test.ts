import { describe, expect, test } from "bun:test";
import {
  appendGateProof,
  type GateProofRecord,
} from "../../../olt/scripts/src/graph/gate-proof.ts";
import { beginValidation } from "../../../olt/scripts/src/workflow/review/begin-validation.ts";
import { recordReview } from "../../../olt/scripts/src/workflow/review/record-review.ts";
import { claimTask } from "../../../olt/scripts/src/workflow/lease/claim.ts";
import { submitTask } from "../../../olt/scripts/src/workflow/submission/submit.ts";
import {
  at,
  registerCommand,
  registerTaskPacket,
  TEST_GATE_ARGV,
  TestPort,
  workflowState,
} from "./test-port.ts";

function seedFalsifiableProof(port: TestPort): void {
  const record: GateProofRecord = {
    task_id: "T-1",
    gate_argv: [...TEST_GATE_ARGV],
    write_scope: ["src/owned"],
    base: "HEAD",
    falsifiable: true,
    exit_code: 1,
    timed_out: false,
    proved_at: "2026-08-13T12:00:00.000Z",
    actor: "coordinator",
  };
  port.transact("coordinator", "gate-proved", { task_id: "T-1" }, (draft) =>
    appendGateProof(draft, record),
  );
}

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

const pass = (validator: string) => ({
  verdict: "pass",
  requirement_ids: ["R-1"],
  checks: [{ command_id: `C-${validator}`, result: "passed" }],
  findings: [],
});
const reject = (validator: string) => ({
  ...pass(validator),
  verdict: "reject",
  findings: [finding],
});

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

describe("independent validation and repair", () => {
  test("honors an explicit validation window and rejects an out-of-bounds one", () => {
    const port = submitted();
    const state = beginValidation(port, "T-1", "validator", clock, 300);
    const deadline = new Date(state.tasks["T-1"]!.validations!.at(-1)!.deadline_at).valueOf();
    expect(deadline - clock.now().valueOf()).toBe(300_000);
    expect(() => beginValidation(port, "T-1", "validator", clock, 4)).toThrow(
      "lease_seconds must be an integer from 5 to 86400",
    );
  });

  test("requires a validator distinct from every implementer", () => {
    const port = submitted();
    expect(() => beginValidation(port, "T-1", "implementer", clock)).toThrow(
      "validator must be independent from implementers",
    );
    const state = beginValidation(port, "T-1", "validator", clock);
    expect(state.tasks["T-1"]!.status).toBe("validating");
  });

  test("reject findings are complete and route to original implementer", () => {
    const port = submitted();
    const token = validationToken(port, "validator");
    const state = recordReview(
      port,
      "T-1",
      "validator",
      { ...reject("validator"), validation_token: token },
      clock,
    );
    expect(state.tasks["T-1"]!.status).toBe("changes_requested");
    expect(state.tasks["T-1"]!.repair_assignee).toBe("implementer");
    expect(state.tasks["T-1"]!.findings).toHaveLength(1);
    expect(() => claimTask(port, "T-1", "replacement", "repairer", { clock })).toThrow();
  });

  test("rejects prose-only or incomplete findings", () => {
    const port = submitted();
    const token = validationToken(port, "validator");
    expect(() =>
      recordReview(
        port,
        "T-1",
        "validator",
        { ...reject("validator"), validation_token: token, findings: [] },
        clock,
      ),
    ).toThrow();
    expect(() =>
      recordReview(
        port,
        "T-1",
        "validator",
        {
          ...reject("validator"),
          validation_token: token,
          findings: [{ ...finding, revalidation: "" }],
        },
        clock,
      ),
    ).toThrow();
  });

  test("requires substantive independent checks and finding evidence", () => {
    const port = submitted();
    const token = validationToken(port, "validator");
    for (const review of [
      { ...pass("validator"), checks: [] },
      { ...pass("validator"), checks: [{}] },
      { ...reject("validator"), findings: [{ ...finding, evidence: [{}] }] },
    ]) {
      expect(() =>
        recordReview(port, "T-1", "validator", { ...review, validation_token: token }, clock),
      ).toThrow();
    }
  });

  test("requires exact duplicate-free requirement coverage", () => {
    const state = workflowState();
    state.tasks["T-1"]!.requirement_ids = ["R-1", "R-2"];
    state.requirements.push({
      id: "R-2",
      status: "planned",
      evidence: [],
      disposition: "actionable",
      dependencies: [],
    });
    const port = new TestPort(state);
    const { token } = claimTask(port, "T-1", "implementer", "implementer", { clock });
    registerTaskPacket(port, "implementer", "implementer", 1);
    submitTask(
      port,
      "T-1",
      "implementer",
      token,
      { ...report, requirement_ids: ["R-1", "R-2"] },
      clock,
    );
    const validation = validationToken(port, "validator");
    expect(() =>
      recordReview(
        port,
        "T-1",
        "validator",
        {
          ...pass("validator"),
          validation_token: validation,
          requirement_ids: ["R-1", "R-1", "R-2"],
        },
        clock,
      ),
    ).toThrow();
  });

  test("repairs require explicit finding resolution before pass", () => {
    const port = submitted();
    const firstToken = validationToken(port, "validator");
    recordReview(
      port,
      "T-1",
      "validator",
      { ...reject("validator"), validation_token: firstToken },
      clock,
    );
    const { token } = claimTask(port, "T-1", "implementer", "repairer", { clock });
    registerTaskPacket(port, "repairer", "implementer", 2);
    submitTask(port, "T-1", "implementer", token, report, clock);
    const secondToken = validationToken(port, "validator-2");
    expect(() =>
      recordReview(
        port,
        "T-1",
        "validator-2",
        { ...pass("validator-2"), validation_token: secondToken },
        clock,
      ),
    ).toThrow();
    seedFalsifiableProof(port);
    const state = recordReview(
      port,
      "T-1",
      "validator-2",
      {
        ...pass("validator-2"),
        validation_token: secondToken,
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
    expect(state.tasks["T-1"]!.status).toBe("validated");
    expect(state.tasks["T-1"]!.findings![0]!.status).toBe("resolved");
  });

  test("six rejected rounds escalate instead of succeeding", () => {
    const port = submitted();
    for (let round = 1; round <= 6; round += 1) {
      const token = validationToken(port, `validator-${round}`);
      recordReview(
        port,
        "T-1",
        `validator-${round}`,
        {
          ...reject(`validator-${round}`),
          validation_token: token,
          findings: [{ ...finding, id: `F-${round}` }],
        },
        clock,
      );
      if (round < 6) {
        const { token } = claimTask(port, "T-1", "implementer", "repairer", { clock });
        registerTaskPacket(port, "repairer", "implementer", round + 1);
        submitTask(port, "T-1", "implementer", token, report, clock);
      }
    }
    expect(port.read().tasks["T-1"]!.status).toBe("escalated");
  });
});
