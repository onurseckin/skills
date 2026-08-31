import { describe, expect, test } from "bun:test";
import { attachGateResult } from "../../../../olt/scripts/src/workflow/gates/attach-result.ts";
import { completionIssues } from "../../../../olt/scripts/src/workflow/completion/completion-state.ts";
import { finishTask } from "../../../../olt/scripts/src/workflow/gates/finish-task.ts";
import { makeAuthorityDecisionRecord } from "../../../../olt/scripts/src/workflow/authority/decision-record.ts";
import { applicableGates } from "../../../../olt/scripts/src/workflow/gates/gate-policy.ts";
import { validateGraph } from "../../../../olt/scripts/src/graph/validate-graph.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { workflowState, TestPort, at, commandRecord } from "../../shared/test-port.ts";

const clock = at("2026-08-13T12:00:00.000Z");
function validatedPort(): TestPort {
  const state = workflowState();
  Object.assign(state.tasks["T-1"]!, {
    status: "validated",
    report: { summary: "done" },
    validations: [
      {
        validator_id: "validator",
        domain: "code-quality",
        token_digest: "digest",
        attempt: 1,
        started_at: clock.now().toISOString(),
        deadline_at: clock.now().toISOString(),
        verdict: "pass",
        reviewed_requirement_ids: ["R-1"],
        checks: [{ command_id: "C-VALIDATE" }],
      },
    ],
  });
  state.commands["C-1"] = commandRecord("C-1", {
    task_id: "T-1",
    gate_id: "G-1",
  });
  state.commands["C-VALIDATE"] = commandRecord("C-VALIDATE");
  return new TestPort(state);
}

describe("mandatory task gates at completion proofs", () => {
  test("run-gate requirement metadata never strands task satisfaction", () => {
    const port = validatedPort();
    const state = port.read();
    state.gates.push({
      id: "G-RUN",
      command: ["bun", "test", "tests"],
      cwd: ".",
      scope: "run",
      requirement_ids: ["R-1"],
      mandatory: true,
    });
    const historical = new TestPort(state);
    attachGateResult(historical, "T-1", "G-1", "C-1", "coordinator", clock);
    const done = finishTask(historical, "T-1", "coordinator", clock);
    expect(done.requirements[0]!.status).toBe("satisfied");
    expect(done.requirements[0]!.evidence).toEqual(["task:T-1"]);
  });

  test("refuses to attach a gate result to a task that is not validated or gating", () => {
    const port = new TestPort(workflowState());
    expect(() => attachGateResult(port, "T-1", "G-1", "C-1", "coordinator", clock)).toThrow(
      /task must be validated before gating/,
    );
  });

  test("rejects mismatched, failed, and conflicting gate records", () => {
    const port = validatedPort();
    const state = port.read();
    state.commands["C-1"]!.fingerprint = "wrong";
    const bad = new TestPort(state);
    expect(() => attachGateResult(bad, "T-1", "G-1", "C-1", "coordinator", clock)).toThrow();
    attachGateResult(port, "T-1", "G-1", "C-1", "coordinator", clock);
    expect(() => attachGateResult(port, "T-1", "G-1", "missing", "coordinator", clock)).toThrow();
  });

  test("refuses to overwrite an already-attached gate result with a different command", () => {
    const port = validatedPort();
    attachGateResult(port, "T-1", "G-1", "C-1", "coordinator", clock);
    const state = port.read();
    state.commands["C-2"] = commandRecord("C-2", { task_id: "T-1", gate_id: "G-1" });
    const dirty = new TestPort(state);
    expect(() => attachGateResult(dirty, "T-1", "G-1", "C-2", "coordinator", clock)).toThrow(
      /gate result cannot be overwritten/,
    );
  });

  test("completion reports unfinished, open, live, and unsatisfied state", () => {
    const state = workflowState();
    state.tasks["T-1"]!.findings = [
      {
        id: "F-1",
        requirement_id: "R-1",
        severity: "important",
        observation: "bug",
        evidence: [{ path: "a" }],
        remediation: "fix",
        revalidation: "test",
        status: "open",
      },
    ];
    const issues = completionIssues(new TestPort(state).read());
    expect(issues.some((issue) => issue.includes("not done"))).toBeTrue();
    expect(issues.some((issue) => issue.includes("open finding"))).toBeTrue();
    expect(issues.some((issue) => issue.includes("not satisfied"))).toBeTrue();
  });
});
