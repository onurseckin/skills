import { describe, expect, test } from "bun:test";
import type { AgentGrantRecord } from "../../../../olt/scripts/src/core/contracts/agents.ts";
import { transitionSummaryIssues } from "../../../../olt/scripts/src/workflow/completion/transition-summary-issues.ts";
import { AGENT_LEDGER_KEY } from "../../../../olt/scripts/src/workflow/agents/ledger.ts";
import { BRANCH_LEDGER_KEY } from "../../../../olt/scripts/src/workflow/branch/ledger.ts";
import { branchRecord, subTask } from "../branch/fixture.ts";
import { workflowState } from "../test-port.ts";

function grant(overrides: Partial<AgentGrantRecord> = {}): AgentGrantRecord {
  return {
    id: "agent-1",
    role: "implementer",
    parent_agent_id: null,
    parent_task_id: null,
    host: "local",
    granted_at: "2026-08-19T00:00:00.000Z",
    status: "active",
    ...overrides,
  };
}

describe("transitionSummaryIssues: branch and sub-task chain", () => {
  test("passes a branch that was collected with an outcome summary", () => {
    const state = workflowState();
    (state as unknown as Record<string, unknown>)[BRANCH_LEDGER_KEY] = [
      branchRecord({ status: "collected", outcome_summary: "sub-tasks landed" }),
    ];
    expect(transitionSummaryIssues(state)).toEqual([]);
  });

  test("flags a collected branch with no recorded outcome summary", () => {
    const state = workflowState();
    (state as unknown as Record<string, unknown>)[BRANCH_LEDGER_KEY] = [
      branchRecord({ status: "collected" }),
    ];
    expect(transitionSummaryIssues(state)).toEqual([
      "branch B-1 is collected with no recorded outcome summary",
    ]);
  });

  test("flags an abandoned branch with no recorded outcome summary", () => {
    const state = workflowState();
    (state as unknown as Record<string, unknown>)[BRANCH_LEDGER_KEY] = [
      branchRecord({ status: "abandoned" }),
    ];
    expect(transitionSummaryIssues(state)).toEqual([
      "branch B-1 is abandoned with no recorded outcome summary",
    ]);
  });

  test("flags a still-open branch that already carries an outcome summary", () => {
    const state = workflowState();
    (state as unknown as Record<string, unknown>)[BRANCH_LEDGER_KEY] = [
      branchRecord({ status: "open", outcome_summary: "premature" }),
    ];
    expect(transitionSummaryIssues(state)).toEqual([
      "branch B-1 carries an outcome summary but is still open",
    ]);
  });

  test("flags a submitted sub-task with no recorded summary", () => {
    const state = workflowState();
    (state as unknown as Record<string, unknown>)[BRANCH_LEDGER_KEY] = [
      branchRecord({
        status: "open",
        sub_tasks: [subTask({ status: "submitted" })],
      }),
    ];
    expect(transitionSummaryIssues(state)).toEqual([
      "branch B-1 sub-task ST-1 is submitted with no recorded summary",
    ]);
  });

  test("flags a sub-task that carries a summary but was never submitted", () => {
    const state = workflowState();
    (state as unknown as Record<string, unknown>)[BRANCH_LEDGER_KEY] = [
      branchRecord({
        status: "open",
        sub_tasks: [subTask({ status: "open", summary: "premature" })],
      }),
    ];
    expect(transitionSummaryIssues(state)).toEqual([
      "branch B-1 sub-task ST-1 carries a summary but is open, not submitted",
    ]);
  });

  test("passes a submitted sub-task that carries its summary", () => {
    const state = workflowState();
    (state as unknown as Record<string, unknown>)[BRANCH_LEDGER_KEY] = [
      branchRecord({
        status: "open",
        sub_tasks: [subTask({ status: "submitted", summary: "done" })],
      }),
    ];
    expect(transitionSummaryIssues(state)).toEqual([]);
  });

  test("does not require an individual summary from a sub-task abandoned by a whole-branch abandon", () => {
    const state = workflowState();
    (state as unknown as Record<string, unknown>)[BRANCH_LEDGER_KEY] = [
      branchRecord({
        status: "abandoned",
        outcome_summary: "parent never returned to collect",
        sub_tasks: [subTask({ status: "abandoned" })],
      }),
    ];
    expect(transitionSummaryIssues(state)).toEqual([]);
  });
});

describe("transitionSummaryIssues: agent grant release", () => {
  test("flags a released grant with no recorded release reason", () => {
    const state = workflowState();
    (state as unknown as Record<string, unknown>)[AGENT_LEDGER_KEY] = [
      grant({ status: "released", released_at: "2026-08-19T00:05:00.000Z" }),
    ];
    expect(transitionSummaryIssues(state)).toEqual([
      "agent agent-1 is released with no recorded release reason",
    ]);
  });

  test("flags an active grant that already carries a release reason", () => {
    const state = workflowState();
    (state as unknown as Record<string, unknown>)[AGENT_LEDGER_KEY] = [
      grant({ status: "active", release_reason: "premature" }),
    ];
    expect(transitionSummaryIssues(state)).toEqual([
      "agent agent-1 carries a release reason but is still active",
    ]);
  });

  test("passes a released grant that carries its release reason", () => {
    const state = workflowState();
    (state as unknown as Record<string, unknown>)[AGENT_LEDGER_KEY] = [
      grant({
        status: "released",
        released_at: "2026-08-19T00:05:00.000Z",
        release_reason: "work complete",
      }),
    ];
    expect(transitionSummaryIssues(state)).toEqual([]);
  });
});

describe("transitionSummaryIssues: task submission and hand-off", () => {
  test("flags a task report with no recorded summary", () => {
    const state = workflowState();
    state.tasks["T-1"]!.report = { requirement_ids: ["R-1"], files_changed: [] };
    expect(transitionSummaryIssues(state)).toEqual([
      "task T-1 has a submission report with no recorded summary",
    ]);
  });

  test("passes a task report that carries its summary", () => {
    const state = workflowState();
    state.tasks["T-1"]!.report = { summary: "implemented", requirement_ids: ["R-1"] };
    expect(transitionSummaryIssues(state)).toEqual([]);
  });

  test("flags a hand-off to a replacement repairer with no recorded evidence", () => {
    const state = workflowState();
    Object.assign(state.tasks["T-1"]!, {
      original_implementer: "agent-1",
      repair_assignee: "agent-2",
      replacement_reason: "stale",
    });
    expect(transitionSummaryIssues(state)).toEqual([
      "task T-1 was handed off to agent-2 with no recorded handoff evidence",
    ]);
  });

  test("passes a hand-off to a replacement repairer that carries its evidence", () => {
    const state = workflowState();
    Object.assign(state.tasks["T-1"]!, {
      original_implementer: "agent-1",
      repair_assignee: "agent-2",
      replacement_reason: "stale",
      replacement_evidence: "lease expired twice with no submission",
    });
    expect(transitionSummaryIssues(state)).toEqual([]);
  });

  test("does not treat reassignment back to the original implementer as a hand-off", () => {
    const state = workflowState();
    Object.assign(state.tasks["T-1"]!, {
      original_implementer: "agent-1",
      repair_assignee: "agent-1",
    });
    expect(transitionSummaryIssues(state)).toEqual([]);
  });
});
