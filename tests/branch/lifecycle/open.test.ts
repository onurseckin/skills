import { describe, expect, it } from "bun:test";
import { isBranchOpen, type BranchRecord } from "../../../olt/scripts/src/core/contracts/index.ts";

describe("Branch Lifecycle: Open Invariants", () => {
  it("recognizes open and collected branch states", () => {
    const openRecord: BranchRecord = {
      id: "B-1",
      parent_task_id: "task-1",
      parent_agent_id: "worker-1",
      reason: "API dependency",
      depth: 1,
      status: "open",
      opened_at: "2026-08-31T00:00:00Z",
      sub_tasks: [],
    };
    expect(isBranchOpen(openRecord)).toBe(true);

    const collectedRecord: BranchRecord = {
      ...openRecord,
      status: "collected",
    };
    expect(isBranchOpen(collectedRecord)).toBe(false);
  });
});
