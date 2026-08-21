import { describe, expect, test } from "bun:test";
import { attachGateResult } from "../../../orchestrating-long-tasks/scripts/src/workflow/gates/attach-result.ts";
import { completionIssues } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/completion-state.ts";
import { finishTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/gates/finish-task.ts";
import { makeAuthorityDecisionRecord } from "../../../orchestrating-long-tasks/scripts/src/workflow/authority/decision-record.ts";
import { applicableGates } from "../../../orchestrating-long-tasks/scripts/src/workflow/gates/gate-policy.ts";
import { validateGraph } from "../../../orchestrating-long-tasks/scripts/src/graph/validate-graph.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import { workflowState, TestPort, at, commandRecord } from "./test-port.ts";

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

describe("gates and completion", () => {
  test("refuses direct finish without authoritative mandatory gate", () => {
    const port = validatedPort();
    expect(() => finishTask(port, "T-1", "coordinator", clock)).toThrow();
    expect(port.read().tasks["T-1"]!.status).toBe("validated");
  });

  test("refuses to finish a task that is not validated or gating", () => {
    const port = new TestPort(workflowState());
    expect(() => finishTask(port, "T-1", "coordinator", clock)).toThrow(
      /only validated or gating tasks can finish/,
    );
  });

  test("refuses to finish a validated task with no passing review and report", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "validated";
    const port = new TestPort(state);
    expect(() => finishTask(port, "T-1", "coordinator", clock)).toThrow(
      /task lacks a passing review and report/,
    );
  });

  test("refuses to finish a task carrying an open finding", () => {
    const port = validatedPort();
    attachGateResult(port, "T-1", "G-1", "C-1", "coordinator", clock);
    const state = port.read();
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
    const dirty = new TestPort(state);
    expect(() => finishTask(dirty, "T-1", "coordinator", clock)).toThrow(
      /task has open findings/,
    );
  });

  test("promotes a dependent proposed task to ready once its dependency finishes", () => {
    const port = validatedPort();
    attachGateResult(port, "T-1", "G-1", "C-1", "coordinator", clock);
    port.transact("test", "add-dependent", {}, (state) => {
      state.tasks["T-2"] = {
        id: "T-2",
        status: "proposed",
        requirement_ids: ["R-1"],
        write_scope: ["src/owned-2"],
        dependencies: ["T-1"],
        attempts: [],
        history: [],
        repair_round: 0,
      };
    });
    const done = finishTask(port, "T-1", "coordinator", clock);
    expect(done.tasks["T-2"]!.status).toBe("ready");
    expect(done.tasks["T-2"]!.history.at(-1)).toMatchObject({
      from: "proposed",
      to: "ready",
      reason: "dependencies satisfied",
    });
  });

  test("binds a successful matching command and finishes mechanically", () => {
    const port = validatedPort();
    const gated = attachGateResult(port, "T-1", "G-1", "C-1", "coordinator", clock);
    expect(gated.tasks["T-1"]!.status).toBe("gating");
    const done = finishTask(port, "T-1", "coordinator", clock);
    expect(done.tasks["T-1"]!.status).toBe("done");
    expect(done.requirements[0]!.status).toBe("satisfied");
    expect(completionIssues(port.read())).toContain("authoritative completion review is missing");
  });

  test("refuses to finish a task with an open attempt and prescribes the fix", () => {
    const port = validatedPort();
    const gated = attachGateResult(port, "T-1", "G-1", "C-1", "coordinator", clock);
    expect(gated.tasks["T-1"]!.status).toBe("gating");
    const state = port.read();
    state.tasks["T-1"]!.attempts.push({
      attempt: 1,
      agent_id: "agent-a",
      role: "implementer",
      kind: "implementation",
      started_at: clock.now().toISOString(),
    });
    const dirty = new TestPort(state);
    let caught: unknown;
    try {
      finishTask(dirty, "T-1", "coordinator", clock);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HarnessError);
    const error = caught as HarnessError;
    expect(error.code).toBe("INVALID_STATE");
    expect(error.message).toContain("open attempt 1 by agent-a (implementer)");
    expect(error.message).toContain("submit it, run recoverStale to reclaim an expired lease");
    expect(error.message).toContain("run task:abandon to close it explicitly");
    expect(dirty.read().tasks["T-1"]!.status).toBe("gating");
  });

  test("does not fabricate satisfaction evidence for a declined mixed obligation", () => {
    const port = validatedPort();
    port.transact("test", "add-declined-requirement", {}, (state) => {
      state.requirements.push({
        id: "R-2",
        status: "planned",
        evidence: [],
        disposition: "needs_authority",
        authority_status: "declined",
        authority_history: [
          makeAuthorityDecisionRecord(
            "R-2",
            "coordinator",
            { decision: "decline", rationale: "The user declined this optional obligation." },
            "2026-08-13T12:00:00.000Z",
          ),
        ],
        dependencies: [],
      });
      state.tasks["T-1"]!.requirement_ids.push("R-2");
    });
    attachGateResult(port, "T-1", "G-1", "C-1", "coordinator", clock);
    const done = finishTask(port, "T-1", "coordinator", clock);

    expect(done.requirements[0]).toMatchObject({ status: "satisfied", evidence: ["task:T-1"] });
    expect(done.requirements[1]).toMatchObject({ status: "planned", evidence: [] });
  });

  test("finishes a graph-valid mixed task without a disposed-only gate", () => {
    const port = validatedPort();
    port.transact("test", "add-declined-gate", {}, (state) => {
      state.requirements.push({
        id: "R-2",
        status: "planned",
        evidence: [],
        disposition: "needs_authority",
        authority_status: "declined",
        authority_history: [
          makeAuthorityDecisionRecord(
            "R-2",
            "coordinator",
            { decision: "decline", rationale: "The user declined deployment authority." },
            "2026-08-13T12:00:00.000Z",
          ),
        ],
        dependencies: [],
      });
      state.tasks["T-1"]!.requirement_ids.push("R-2");
      state.gates.push({
        id: "G-DISPOSED",
        command: ["bun", "test", "deployment"],
        cwd: ".",
        scope: "task",
        requirement_ids: ["R-2"],
        mandatory: true,
      });
    });
    const state = port.read();
    const graph = {
      schema: "harness.graph",
      version: 1,
      revision: 1,
      nodes: [
        { id: "requirement-1", type: "requirement", label: "R-1", requirement_id: "R-1" },
        { id: "requirement-2", type: "requirement", label: "R-2", requirement_id: "R-2" },
        { id: "artifact-1", type: "artifact", label: "Mixed output" },
        {
          id: "T-1",
          type: "task",
          label: "Implement mixed task",
          requirement_ids: ["R-1", "R-2"],
          write_scope: ["src/owned"],
          resource_scope: [],
          status: "ready",
          priority: 10,
          effort: 1,
          created_order: 0,
        },
      ],
      edges: [{ source: "T-1", target: "artifact-1", type: "produces" }],
      gates: [
        ...state.gates,
        {
          id: "G-RUN",
          command: ["git", "diff", "--check"],
          cwd: ".",
          scope: "run",
          requirement_ids: [],
          mandatory: true,
        },
      ],
    };
    expect(validateGraph(graph, { requirements: state.requirements })).toEqual([]);
    expect(applicableGates(state, state.tasks["T-1"]!).map(({ id }) => id)).toEqual(["G-1"]);

    attachGateResult(port, "T-1", "G-1", "C-1", "coordinator", clock);
    const done = finishTask(port, "T-1", "coordinator", clock);
    expect(done.tasks["T-1"]!.status).toBe("done");
    expect(done.requirements[1]).toMatchObject({ status: "planned", evidence: [] });
  });

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
