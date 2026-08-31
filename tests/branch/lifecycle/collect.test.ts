import { describe, expect, it } from "bun:test";
import { openBranchIssues } from "../../../olt/scripts/src/workflow/branch/completion-blockers.ts";

describe("Branch Lifecycle: Branch Collect & Blockers", () => {
  it("returns no issues when all branches are collected", () => {
    const state = {
      branches: [
        {
          id: "B-1",
          parent_task_id: "task-1",
          parent_agent_id: "worker-1",
          reason: "Done",
          depth: 1,
          status: "collected",
          opened_at: "2026-08-31T00:00:00Z",
          sub_tasks: [],
        },
      ],
    };
    const issues = openBranchIssues(state);
    expect(issues.length).toBe(0);
  });

  it("returns issue when branch remains open during parent completion", () => {
    const state = {
      branches: [
        {
          id: "B-2",
          parent_task_id: "task-2",
          parent_agent_id: "worker-2",
          reason: "In progress",
          depth: 1,
          status: "open",
          opened_at: "2026-08-31T00:00:00Z",
          sub_tasks: [],
        },
      ],
    };
    const issues = openBranchIssues(state);
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("branch B-2 on task-2 at depth 1 is open, not collected");
  });
});
