import { describe, expect, test } from "bun:test";
import {
  findAssignedWorktree,
  readWorktreeLedger,
  writeWorktreeLedger,
  WORKTREE_LEDGER_KEY,
} from "../../../../orchestrating-long-tasks/scripts/src/workflow/worktree/ledger.ts";
import type { WorktreeLedgerState } from "../../../../orchestrating-long-tasks/scripts/src/contracts/worktree.ts";
import type { JsonObject } from "../../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";

function ledger(overrides: Partial<WorktreeLedgerState> = {}): WorktreeLedgerState {
  return {
    harness_branch: "harness/run-1",
    base_sha: "abc123",
    root: "/tmp/worktrees",
    worktrees: [],
    assignments: [],
    commits: [],
    ...overrides,
  };
}

describe("readWorktreeLedger", () => {
  test("returns null when the key is absent", () => {
    expect(readWorktreeLedger({})).toBeNull();
  });

  test("returns the ledger when it is well-formed", () => {
    const state: JsonObject = { [WORKTREE_LEDGER_KEY]: ledger() as unknown as JsonObject };
    expect(readWorktreeLedger(state)).toEqual(ledger());
  });

  test("throws INTEGRITY when the stored value is malformed", () => {
    const state: JsonObject = { [WORKTREE_LEDGER_KEY]: { not: "a ledger" } };
    expect(() => readWorktreeLedger(state)).toThrow(/malformed/);
  });
});

describe("writeWorktreeLedger", () => {
  test("stores a deep clone under the ledger key, independent of the source object", () => {
    const draft: JsonObject = {};
    const source = ledger({
      worktrees: [{ id: "wt-0", path: "/p", branch: "b", base_sha: "s", created_at: "t" }],
    });
    writeWorktreeLedger(draft, source);
    expect(draft[WORKTREE_LEDGER_KEY]).toEqual(source as unknown as JsonObject);
    source.worktrees.push({
      id: "wt-1",
      path: "/p2",
      branch: "b2",
      base_sha: "s2",
      created_at: "t2",
    });
    expect((draft[WORKTREE_LEDGER_KEY] as unknown as WorktreeLedgerState).worktrees).toHaveLength(
      1,
    );
  });
});

describe("findAssignedWorktree", () => {
  test("returns null when the task has no assignment", () => {
    expect(findAssignedWorktree(ledger(), "T-1")).toBeNull();
  });

  test("returns null when the assignment references a worktree missing from the ledger", () => {
    const state = ledger({ assignments: [{ task_id: "T-1", worktree_id: "wt-0", wave: 1 }] });
    expect(findAssignedWorktree(state, "T-1")).toBeNull();
  });

  test("resolves the worktree path and id for an assigned task", () => {
    const state = ledger({
      worktrees: [{ id: "wt-0", path: "/repo/wt-0", branch: "b", base_sha: "s", created_at: "t" }],
      assignments: [{ task_id: "T-1", worktree_id: "wt-0", wave: 1 }],
    });
    expect(findAssignedWorktree(state, "T-1")).toEqual({
      worktreePath: "/repo/wt-0",
      worktreeId: "wt-0",
    });
  });

  test("uses the most recent assignment when a task was reassigned across waves", () => {
    const state = ledger({
      worktrees: [
        { id: "wt-0", path: "/repo/wt-0", branch: "b0", base_sha: "s", created_at: "t" },
        { id: "wt-1", path: "/repo/wt-1", branch: "b1", base_sha: "s", created_at: "t" },
      ],
      assignments: [
        { task_id: "T-1", worktree_id: "wt-0", wave: 1 },
        { task_id: "T-1", worktree_id: "wt-1", wave: 2 },
      ],
    });
    expect(findAssignedWorktree(state, "T-1")).toEqual({
      worktreePath: "/repo/wt-1",
      worktreeId: "wt-1",
    });
  });
});
