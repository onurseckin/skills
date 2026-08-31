import { describe, expect, test } from "bun:test";
import {
  BRANCH_LEDGER_KEY,
  branchesForParent,
  findBranch,
  locateSubTask,
  readBranchLedger,
  requireBranch,
  requireSubTask,
  writeBranchLedger,
} from "../../../../olt/scripts/src/workflow/branch/ledger.ts";
import type { JsonObject } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { branchRecord, subTask } from "./fixture.ts";

describe("readBranchLedger", () => {
  test("returns an empty array when the key is absent", () => {
    expect(readBranchLedger({})).toEqual([]);
  });

  test("returns the ledger when every entry is a well-formed branch record", () => {
    const branch = branchRecord();
    const state: JsonObject = { [BRANCH_LEDGER_KEY]: [branch as unknown as JsonObject] };
    expect(readBranchLedger(state)).toEqual([branch]);
  });

  test("throws INTEGRITY when the stored value is not an array", () => {
    const state: JsonObject = { [BRANCH_LEDGER_KEY]: { not: "an array" } };
    expect(() => readBranchLedger(state)).toThrow(/must be an array of branch records/);
  });

  test("throws INTEGRITY naming the offending index when an entry is malformed", () => {
    const state: JsonObject = { [BRANCH_LEDGER_KEY]: [{ bogus: true }] };
    expect(() => readBranchLedger(state)).toThrow(/state\.branches\[0\] is not a branch record/);
  });
});

describe("writeBranchLedger", () => {
  test("stores a shallow copy of the ledger under the branches key", () => {
    const draft: JsonObject = {};
    const ledger = [branchRecord()];
    writeBranchLedger(draft, ledger);
    expect(draft[BRANCH_LEDGER_KEY]).toEqual(ledger as unknown as JsonObject[]);
    expect(draft[BRANCH_LEDGER_KEY]).not.toBe(ledger);
  });
});

describe("findBranch / requireBranch", () => {
  test("findBranch returns undefined when the branch is not in the ledger", () => {
    expect(findBranch([branchRecord({ id: "B-1" })], "B-2")).toBeUndefined();
  });

  test("findBranch returns the matching branch", () => {
    const branch = branchRecord({ id: "B-2" });
    expect(findBranch([branchRecord({ id: "B-1" }), branch], "B-2")).toBe(branch);
  });

  test("requireBranch throws INVALID_ARGUMENT for an unknown branch id", () => {
    expect(() => requireBranch([], "B-ghost")).toThrow(/unknown branch: B-ghost/);
  });

  test("requireBranch returns the branch when found", () => {
    const branch = branchRecord({ id: "B-1" });
    expect(requireBranch([branch], "B-1")).toBe(branch);
  });
});

describe("requireSubTask", () => {
  test("throws INVALID_ARGUMENT when the sub-task does not exist on the branch", () => {
    const branch = branchRecord({ sub_tasks: [subTask({ id: "ST-1" })] });
    expect(() => requireSubTask(branch, "ST-ghost")).toThrow(/branch B-1 has no sub-task ST-ghost/);
  });

  test("returns the matching sub-task", () => {
    const target = subTask({ id: "ST-2" });
    const branch = branchRecord({ sub_tasks: [subTask({ id: "ST-1" }), target] });
    expect(requireSubTask(branch, "ST-2")).toBe(target);
  });
});

describe("locateSubTask", () => {
  test("returns undefined when no branch contains the sub-task", () => {
    const ledger = [branchRecord({ sub_tasks: [subTask({ id: "ST-1" })] })];
    expect(locateSubTask(ledger, "ST-ghost")).toBeUndefined();
  });

  test("locates the branch and sub-task across a multi-branch ledger", () => {
    const target = subTask({ id: "ST-2" });
    const owner = branchRecord({ id: "B-2", sub_tasks: [target] });
    const ledger = [branchRecord({ id: "B-1", sub_tasks: [subTask({ id: "ST-1" })] }), owner];
    expect(locateSubTask(ledger, "ST-2")).toEqual({ branch: owner, subTask: target });
  });
});

describe("branchesForParent", () => {
  test("filters the ledger down to branches opened on the given parent task", () => {
    const ledger = [
      branchRecord({ id: "B-1", parent_task_id: "T-1" }),
      branchRecord({ id: "B-2", parent_task_id: "T-2" }),
      branchRecord({ id: "B-3", parent_task_id: "T-1" }),
    ];
    expect(branchesForParent(ledger, "T-1").map((b) => b.id)).toEqual(["B-1", "B-3"]);
  });

  test("returns an empty array when no branch matches the parent task", () => {
    expect(branchesForParent([branchRecord({ parent_task_id: "T-1" })], "T-9")).toEqual([]);
  });
});
