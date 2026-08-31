import { describe, expect, test } from "bun:test";
import {
  appendGateProof,
  type GateProofRecord,
} from "../../../../olt/scripts/src/graph/gate-proof.ts";
import { assignReplacementRepairer } from "../../../../olt/scripts/src/workflow/review/assign-repairer.ts";
import { beginValidation } from "../../../../olt/scripts/src/workflow/review/begin-validation.ts";
import { isProbeDemand } from "../../../../olt/scripts/src/workflow/review/finding-class.ts";
import {
  failingGateRuns,
  probeRoundsRecorded,
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

describe("probe lifecycle and rules", () => {
  test("a later successful run of the same gate supersedes an earlier failure", () => {
    const port = submitted({
      "C-GATE-FAIL": commandRecord("C-GATE-FAIL", {
        actor: "validator",
        gate_id: "G-1",
        status: "failed",
        exit_code: 1,
        started_at: "2026-08-13T11:00:00.000Z",
      }),
    });
    const token = validationToken(port, "validator");
    recordProbe(port, "T-1", "validator", { validation_token: token, findings: [demand] }, clock);
    seedFalsifiableProof(port);
    const state = recordReview(
      port,
      "T-1",
      "validator",
      { ...passPayload("validator", token), resolved_findings: [answered("validator", demand.id)] },
      clock,
      6,
      1,
    );
    expect(state.tasks["T-1"]!.status).toBe("validated");
  });

  test("classes do not mix: a probe carries demands, a rejection carries defects", () => {
    const port = submitted();
    const token = validationToken(port, "validator");
    expect(() =>
      recordProbe(port, "T-1", "validator", { validation_token: token, findings: [] }, clock),
    ).toThrow(/at least one demand/);
    expect(() =>
      recordProbe(port, "T-1", "validator", { validation_token: token, findings: [defect] }, clock),
    ).toThrow(/must declare class probe_demand/);
    expect(() =>
      recordReview(
        port,
        "T-1",
        "validator",
        {
          verdict: "reject",
          validation_token: token,
          requirement_ids: ["R-1"],
          checks: [{ command_id: "C-validator" }],
          findings: [demand],
        },
        clock,
      ),
    ).toThrow(/class probe_demand, which this verdict cannot carry/);
  });

  test("a probe is refused unless the validator owns the live validation", () => {
    const port = submitted();
    const token = validationToken(port, "validator");
    expect(() =>
      recordProbe(port, "T-1", "other", { validation_token: token, findings: [demand] }, clock),
    ).toThrow(/does not own the current validation/);
    expect(() =>
      recordProbe(port, "T-1", "validator", { validation_token: "tok_wrong", findings: [demand] }),
    ).toThrow(/token is invalid/);
  });

  test("the first defect after a probe is not treated as repeated failure", () => {
    const port = submitted();
    const token = validationToken(port, "validator");
    recordProbe(port, "T-1", "validator", { validation_token: token, findings: [demand] }, clock);
    const state = recordReview(
      port,
      "T-1",
      "validator",
      {
        verdict: "reject",
        validation_token: token,
        requirement_ids: ["R-1"],
        checks: [{ command_id: "C-validator" }],
        findings: [defect],
      },
      clock,
    );
    expect(state.tasks["T-1"]!.status).toBe("changes_requested");
    expect(state.tasks["T-1"]!.repair_round).toBe(1);
    expect(state.tasks["T-1"]!.probe_round).toBe(1);
    expect(() =>
      assignReplacementRepairer(port, "T-1", "replacement", "coordinator", "repeated_failure", "e"),
    ).toThrow(/has not failed repeatedly/);
  });

  test("probes never shorten the twenty-round repair budget", () => {
    const port = submitted();
    for (let round = 1; round <= 20; round += 1) {
      const validator = `validator-${round}`;
      const token = validationToken(port, validator);
      recordProbe(
        port,
        "T-1",
        validator,
        {
          validation_token: token,
          findings: [{ ...demand, id: `probe-T-1-0${round}-1` }],
        },
        clock,
      );
      recordReview(
        port,
        "T-1",
        validator,
        {
          verdict: "reject",
          validation_token: token,
          requirement_ids: ["R-1"],
          checks: [{ command_id: `C-${validator}` }],
          findings: [{ ...defect, id: `F-${round}` }],
        },
        clock,
      );
      const task = port.read().tasks["T-1"]!;
      expect(task.probe_round).toBe(round);
      expect(task.repair_round).toBe(round);
      if (round < 20) {
        expect(task.status).toBe("changes_requested");
        const repair = claimTask(port, "T-1", "implementer", "repairer", { clock });
        registerTaskPacket(port, "repairer", "implementer", round + 1);
        submitTask(port, "T-1", "implementer", repair.token, report, clock);
      }
    }
    expect(port.read().tasks["T-1"]!.status).toBe("escalated");
  });

  test("a task record from before probes existed still parses and counts zero probes", () => {
    const task = workflowState().tasks["T-1"]!;
    expect(task.probe_round).toBeUndefined();
    expect(probeRoundsRecorded(task)).toBe(0);
  });
});
