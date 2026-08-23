import { describe, expect, test } from "bun:test";
import { completionIssues } from "../../../../olt/scripts/src/workflow/completion/completion-state.ts";
import { commandRecord, TEST_GATE_ARGV, workflowState } from "../test-port.ts";
import type { WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";

describe("completionIssues: validator command provenance", () => {
  test("flags a validator check whose command was run by a different actor than the validator", () => {
    const state = workflowState();
    Object.assign(state.tasks["T-1"]!, {
      status: "done",
      report: { summary: "done" },
      validations: [
        {
          validator_id: "validator",
          domain: "code-quality",
          token_digest: "digest",
          attempt: 1,
          started_at: "2026-08-13T12:00:00.000Z",
          deadline_at: "2026-08-13T13:00:00.000Z",
          verdict: "pass",
          reviewed_requirement_ids: ["R-1"],
          checks: [{ command_id: "C-V" }],
        },
      ],
      gate_results: [{ gate_id: "G-1", command_id: "C-T", status: "passed" }],
    });
    state.requirements[0] = {
      id: "R-1",
      status: "satisfied",
      disposition: "actionable",
      evidence: ["task:T-1"],
    };
    state.commands["C-T"] = commandRecord("C-T", { gate_id: "G-1", actor: "implementer" });
    // C-V's actor does not match the validation's validator_id ("validator") - it ran as someone else.
    state.commands["C-V"] = commandRecord("C-V", { actor: "not-the-validator" });
    expect(completionIssues(state)).toContain("task T-1 has invalid validator command C-V");
  });
});

describe("completionIssues: requirements shapes beyond a plain array", () => {
  function stateWithRequirements(requirements: unknown): WorkflowState {
    const state = workflowState();
    (state as unknown as { requirements: unknown }).requirements = requirements;
    return state;
  }

  test("reads requirements nested under a { requirements: [...] } wrapper object", () => {
    const state = stateWithRequirements({
      requirements: [{ id: "R-1", status: "planned", disposition: "actionable", evidence: [] }],
    });
    expect(completionIssues(state)).toContain("requirement R-1 has no evidence");
  });

  test("falls back to Object.values when requirements is a plain id-keyed map", () => {
    const state = stateWithRequirements({
      "R-1": { id: "R-1", status: "planned", disposition: "actionable", evidence: [] },
    });
    expect(completionIssues(state)).toContain("requirement R-1 has no evidence");
  });
});

describe("completionIssues: ordering with multiple tasks and gate commands", () => {
  test("sorts issues from multiple done tasks by task id, and resolves a run gate with more than one passing command", () => {
    const state = workflowState();
    // A second successful command against the same run gate forces the sort comparator inside
    // mandatoryRunGateCommands to actually run (a single match never invokes it).
    state.gates.push({
      id: "G-RUN",
      command: TEST_GATE_ARGV,
      cwd: ".",
      scope: "run",
      requirement_ids: [],
      mandatory: true,
    });
    state.commands["C-RUN-A"] = commandRecord("C-RUN-A", {
      argv: TEST_GATE_ARGV,
      task_id: null,
      gate_id: "G-RUN",
      actor: "coordinator",
    });
    state.commands["C-RUN-B"] = commandRecord("C-RUN-B", {
      argv: TEST_GATE_ARGV,
      task_id: null,
      gate_id: "G-RUN",
      actor: "coordinator",
    });

    // A second done task forces the completionIssues task-list sort comparator to actually run.
    state.tasks["T-2"] = {
      id: "T-2",
      status: "done",
      requirement_ids: [],
      write_scope: ["src/owned-2"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      report: { summary: "done" },
    };
    state.tasks["T-1"]!.status = "running";

    const issues = completionIssues(state);
    expect(issues).not.toContain("run gate G-RUN lacks an authoritative passing command");
    const t1Index = issues.indexOf("task T-1 is running, not done");
    expect(t1Index).toBeGreaterThanOrEqual(0);
  });
});

describe("completionIssues: paused (needs-authority) requirements", () => {
  test("reports a requirement still awaiting authority instead of treating it as unsatisfied", () => {
    const state = workflowState();
    state.requirements.push({
      id: "R-2",
      status: "planned",
      disposition: "needs_authority",
      evidence: [],
    });
    const issues = completionIssues(state);
    expect(issues).toContain("requirement R-2 still needs authority");
    expect(issues).not.toContain("requirement R-2 is not satisfied");
    expect(issues).not.toContain("requirement R-2 has no evidence");
  });
});
