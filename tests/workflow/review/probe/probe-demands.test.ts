import { describe, expect, test } from "bun:test";
import {
  appendGateProof,
  type GateProofRecord,
} from "../../../../olt/scripts/src/graph/gate-proof.ts";
import { beginValidation } from "../../../../olt/scripts/src/workflow/review/begin-validation.ts";
import { isProbeDemand } from "../../../../olt/scripts/src/workflow/review/finding-class.ts";
import {
  failingGateRuns,
} from "../../../../olt/scripts/src/workflow/review/pass-preconditions.ts";
import { recordProbe } from "../../../../olt/scripts/src/workflow/review/record-probe.ts";
import { recordReview } from "../../../../olt/scripts/src/workflow/review/record-review.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { submitTask } from "../../../../olt/scripts/src/workflow/submission/submit.ts";
import {
  at,
  commandRecord,
  registerCommand,
  registerTaskPacket,
  TEST_GATE_ARGV,
  TestPort,
  workflowState,
} from "../../shared/test-port.ts";

function seedFalsifiableProof(port: TestPort, overrides: Partial<GateProofRecord> = {}): void {
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
    ...overrides,
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



function submitted(commands: Record<string, ReturnType<typeof commandRecord>> = {}): TestPort {
  const state = workflowState();
  Object.assign(state.commands, commands);
  const port = new TestPort(state);
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

function passPayload(validator: string, token: string) {
  return {
    verdict: "pass",
    validation_token: token,
    requirement_ids: ["R-1"],
    checks: [{ command_id: `C-${validator}` }],
    findings: [],
  };
}

function answered(validator: string, findingId: string) {
  return {
    finding_id: findingId,
    method: "probe_demand_answered",
    evidence: [{ command_id: `C-${validator}` }],
  };
}

describe("the adversarial probe is not a rejection", () => {
  test("a probe records demands without spending the repair budget", () => {
    const port = submitted();
    const token = validationToken(port, "validator");
    const state = recordProbe(
      port,
      "T-1",
      "validator",
      { validation_token: token, findings: [demand] },
      clock,
    );
    const task = state.tasks["T-1"]!;
    expect(task.status).toBe("validating");
    expect(task.probe_round).toBe(1);
    expect(task.repair_round).toBe(0);
    expect(task.validations!.at(-1)!.verdict).toBe("probe");
    expect(task.findings).toHaveLength(1);
    expect(isProbeDemand(task.findings![0]!)).toBe(true);
    expect(task.findings![0]!.status).toBe("open");
    expect(port.events.at(-1)).toMatchObject({
      kind: "probe-recorded",
      payload: { task_id: "T-1", round: 1, finding_ids: ["probe-T-1-01-1"] },
    });
  });

  test("a pass is refused until the probe budget is met, and allowed once the demand is answered", () => {
    const port = submitted();
    const token = validationToken(port, "validator");
    expect(() =>
      recordReview(port, "T-1", "validator", passPayload("validator", token), clock, 6, 1),
    ).toThrow(/0 adversarial probe\(s\) recorded, 1 required/);

    recordProbe(port, "T-1", "validator", { validation_token: token, findings: [demand] }, clock);
    seedFalsifiableProof(port);
    expect(() =>
      recordReview(port, "T-1", "validator", passPayload("validator", token), clock, 6, 1),
    ).toThrow(/resolve every open finding/);

    const state = recordReview(
      port,
      "T-1",
      "validator",
      {
        ...passPayload("validator", token),
        resolved_findings: [answered("validator", demand.id)],
      },
      clock,
      6,
      1,
    );
    expect(state.tasks["T-1"]!.status).toBe("validated");
    expect(state.tasks["T-1"]!.findings![0]!.status).toBe("resolved");
    expect(state.tasks["T-1"]!.probe_round).toBe(1);
    expect(state.tasks["T-1"]!.repair_round).toBe(0);
  });

  test("a pass is refused while a mandatory gate's recorded run exited non-zero", () => {
    const port = submitted({
      "C-GATE-FAIL": commandRecord("C-GATE-FAIL", {
        actor: "validator",
        gate_id: "G-1",
        status: "failed",
        exit_code: 1,
        started_at: "2026-08-13T12:30:00.000Z",
      }),
    });
    const token = validationToken(port, "validator");
    recordProbe(port, "T-1", "validator", { validation_token: token, findings: [demand] }, clock);
    expect(failingGateRuns(port.read(), port.read().tasks["T-1"]!)).toEqual([
      { gate_id: "G-1", command_id: "C-GATE-FAIL", status: "failed", exit_code: 1 },
    ]);
    expect(() =>
      recordReview(
        port,
        "T-1",
        "validator",
        {
          ...passPayload("validator", token),
          resolved_findings: [answered("validator", demand.id)],
        },
        clock,
        6,
        1,
      ),
    ).toThrow(/mandatory gate evidence records a failure/);
  });
});
