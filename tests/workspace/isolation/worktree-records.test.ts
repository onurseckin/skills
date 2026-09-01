import { describe, expect, it } from "bun:test";
import {
  isWorktreeConsolidationRecord,
  isWorktreeLedgerState,
  type WorktreeLedgerState,
} from "../../../olt/scripts/src/core/contracts/git/worktree.ts";

describe("Workspace Isolation: Worktree Records & Ledger State", () => {
  it("validates valid WorktreeLedgerState objects", () => {
    const validState: WorktreeLedgerState = {
      harness_branch: "harness/main",
      base_sha: "abc1234",
      root: "/repos/skills",
      worktrees: [
        {
          id: "wt-01",
          path: "/repos/skills/worktrees/wt-01",
          branch: "branch-01",
          base_sha: "abc1234",
          created_at: "2026-08-31T00:00:00Z",
        },
      ],
      assignments: [
        {
          task_id: "task-01",
          worktree_id: "wt-01",
          wave: 1,
        },
      ],
      commits: [],
    };

    expect(isWorktreeLedgerState(validState)).toBe(true);
  });

  it("rejects invalid worktree ledger states", () => {
    expect(isWorktreeLedgerState(null)).toBe(false);
    expect(isWorktreeLedgerState({})).toBe(false);
    expect(isWorktreeLedgerState({ harness_branch: 123 })).toBe(false);
  });

  it("validates WorktreeConsolidationRecord objects", () => {
    const record = {
      harness_branch: "harness/main",
      merged_worktree_ids: ["wt-01", "wt-02"],
      rebased: true,
      removed_worktree_ids: ["wt-01"],
      commit_count: 2,
      diffstat: "2 files changed",
      consolidated_at: "2026-08-31T00:00:00Z",
    };
    expect(isWorktreeConsolidationRecord(record)).toBe(true);
  });
});
