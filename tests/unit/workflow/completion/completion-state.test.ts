import { describe, expect, test } from "bun:test";
import {
  completionIssues,
  gateTally,
} from "../../../../olt/scripts/src/workflow/completion/completion-state.ts";
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

describe("gateTally and completion state verification edge cases", () => {
  test("gateTally tallies task and run scope gates accurately", () => {
    const state = workflowState();
    state.gates = [
      {
        id: "G-TASK",
        command: TEST_GATE_ARGV,
        cwd: ".",
        scope: "task",
        requirement_ids: ["R-1"],
        mandatory: true,
      },
      {
        id: "G-RUN",
        command: TEST_GATE_ARGV,
        cwd: ".",
        scope: "run",
        requirement_ids: [],
        mandatory: true,
      },
    ];
    state.commands["C-TASK"] = commandRecord("C-TASK", {
      gate_id: "G-TASK",
      task_id: "T-1",
      argv: TEST_GATE_ARGV,
      status: "succeeded",
      exit_code: 0,
    });
    state.commands["C-RUN"] = commandRecord("C-RUN", {
      gate_id: "G-RUN",
      task_id: null,
      argv: TEST_GATE_ARGV,
      status: "succeeded",
      exit_code: 0,
    });

    const tally = gateTally(state);
    expect(tally.total).toBe(2);
    expect(tally.green).toBe(2);
  });

  test("completionIssues detects running command, unpublished packet, invalid verification digest, and stale result", () => {
    const state = workflowState();
    state.commands["C-RUNNING"] = commandRecord("C-RUNNING", { status: "running" as never });
    state.packets = {
      "P-1": {
        id: "P-1",
        role: "implementer",
        status: "draft" as never,
        agent_id: "worker",
        task_id: "T-1",
        created_at: "2026-08-20T00:00:00.000Z",
        packet_sha256: "0".repeat(64),
      },
    };
    state.completion_verification = {
      verification_sha256: "invalid-digest",
      reviewed_at: "2026-08-20T00:00:00.000Z",
      verified_files: [],
      issues: [],
    };
    state.completion_result = {
      critic_review_sha256: "stale-sha",
      readiness_sha256: "stale-readiness",
      repository_binding: { root: "/repo", head_sha: "stale" },
      artifact_verification_sha256: "stale-art",
      mandatory_run_gate_commands: {},
    };

    const issues = completionIssues(state);
    expect(issues).toContain("running command blocks completion: C-RUNNING");
    expect(issues).toContain("packet P-1 is not durably published");
    expect(issues).toContain("completion artifact verification digest is invalid");
    expect(issues).toContain("completion result provenance is stale");
  });
});
