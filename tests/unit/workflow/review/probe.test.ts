import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { assignReplacementRepairer } from "../../../../orchestrating-long-tasks/scripts/src/workflow/review/assign-repairer.ts";
import { beginValidation } from "../../../../orchestrating-long-tasks/scripts/src/workflow/review/begin-validation.ts";
import { isProbeDemand } from "../../../../orchestrating-long-tasks/scripts/src/workflow/review/finding-class.ts";
import {
  failingGateRuns,
  probeRoundsRecorded,
} from "../../../../orchestrating-long-tasks/scripts/src/workflow/review/pass-preconditions.ts";
import { recordProbe } from "../../../../orchestrating-long-tasks/scripts/src/workflow/review/record-probe.ts";
import { recordReview } from "../../../../orchestrating-long-tasks/scripts/src/workflow/review/record-review.ts";
import { claimTask } from "../../../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import { submitTask } from "../../../../orchestrating-long-tasks/scripts/src/workflow/submission/submit.ts";
import { loadRun } from "../../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import type { TaskRecord } from "../../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import {
  at,
  commandRecord,
  registerCommand,
  registerTaskPacket,
  TestPort,
  workflowState,
} from "../test-port.ts";

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

  test("probes never shorten the six-round repair budget", () => {
    const port = submitted();
    for (let round = 1; round <= 6; round += 1) {
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
      if (round < 6) {
        expect(task.status).toBe("changes_requested");
        const repair = claimTask(port, "T-1", "implementer", "repairer", { clock });
        registerTaskPacket(port, "repairer", "implementer", round + 1);
        submitTask(port, "T-1", "implementer", repair.token, report, clock);
      }
    }
    expect(port.read().tasks["T-1"]!.status).toBe("escalated");
  });

  test("a capsule written before probes existed still parses and counts zero probes", () => {
    const runRoot = join(process.cwd(), ".capsules", "2026-08-17-skills-documentation-elevation");
    const loaded = loadRun(runRoot);
    const tasks = loaded.state.tasks as Record<string, TaskRecord>;
    const task = tasks["task-1"]!;
    expect(task.probe_round).toBeUndefined();
    expect(probeRoundsRecorded(task)).toBe(0);
  });
});
