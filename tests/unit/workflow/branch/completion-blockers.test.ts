import { describe, expect, test } from "bun:test";
import { openBranchIssues } from "../../../../olt/scripts/src/workflow/branch/completion-blockers.ts";
import { BRANCH_LEDGER_KEY } from "../../../../olt/scripts/src/workflow/branch/ledger.ts";
import type { JsonObject } from "../../../../olt/scripts/src/core/contracts/json.ts";
import { branchRecord } from "./fixture.ts";

describe("openBranchIssues", () => {
  test("returns no issues when the ledger is empty", () => {
    expect(openBranchIssues({})).toEqual([]);
  });

  test("reports every open or collecting branch as blocking, and ignores terminal branches", () => {
    const state: JsonObject = {
      [BRANCH_LEDGER_KEY]: [
        branchRecord({
          id: "B-1",
          parent_task_id: "T-1",
          depth: 1,
          status: "open",
        }) as unknown as JsonObject,
        branchRecord({
          id: "B-2",
          parent_task_id: "T-2",
          depth: 2,
          status: "collecting",
        }) as unknown as JsonObject,
        branchRecord({
          id: "B-3",
          parent_task_id: "T-3",
          depth: 1,
          status: "collected",
        }) as unknown as JsonObject,
        branchRecord({
          id: "B-4",
          parent_task_id: "T-4",
          depth: 1,
          status: "abandoned",
        }) as unknown as JsonObject,
      ],
    };
    expect(openBranchIssues(state)).toEqual([
      "branch B-1 on T-1 at depth 1 is open, not collected",
      "branch B-2 on T-2 at depth 2 is collecting, not collected",
    ]);
  });
});
