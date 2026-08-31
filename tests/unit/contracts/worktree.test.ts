import { describe, expect, test } from "bun:test";
import {
  isWorktreeConsolidationRecord,
  isWorktreeLedgerState,
  type WorktreeAssignment,
  type WorktreeCommitRecord,
  type WorktreeConsolidationRecord,
  type WorktreeLedgerState,
  type WorktreeMergeConflict,
  type WorktreeRecord,
} from "../../../olt/scripts/src/core/contracts/index.ts";

function worktree(overrides: Partial<WorktreeRecord> = {}): WorktreeRecord {
  return {
    id: "wt-1",
    path: "/repo/.worktrees/wt-1",
    branch: "harness/wt-1",
    base_sha: "a".repeat(40),
    created_at: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

function assignment(overrides: Partial<WorktreeAssignment> = {}): WorktreeAssignment {
  return { task_id: "T-1", worktree_id: "wt-1", wave: 1, ...overrides };
}

function commit(overrides: Partial<WorktreeCommitRecord> = {}): WorktreeCommitRecord {
  return {
    task_id: "T-1",
    worktree_id: "wt-1",
    sha: "b".repeat(40),
    subject: "feat: add thing",
    changed_lines: 12,
    over_limit: false,
    committed_at: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

function mergeConflict(overrides: Partial<WorktreeMergeConflict> = {}): WorktreeMergeConflict {
  return { worktree_id: "wt-1", branch: "harness/wt-1", paths: ["src/a.ts"], ...overrides };
}

function consolidation(
  overrides: Partial<WorktreeConsolidationRecord> = {},
): WorktreeConsolidationRecord {
  return {
    harness_branch: "harness/main",
    merged_worktree_ids: ["wt-1"],
    rebased: false,
    removed_worktree_ids: ["wt-1"],
    commit_count: 1,
    diffstat: "1 file changed",
    consolidated_at: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

function ledger(overrides: Partial<WorktreeLedgerState> = {}): WorktreeLedgerState {
  return {
    harness_branch: "harness/main",
    base_sha: "a".repeat(40),
    root: "/repo",
    worktrees: [worktree()],
    assignments: [assignment()],
    commits: [commit()],
    ...overrides,
  };
}

describe("isWorktreeConsolidationRecord", () => {
  test("accepts a minimal record and one carrying every optional field", () => {
    expect(isWorktreeConsolidationRecord(consolidation())).toBeTrue();
    expect(
      isWorktreeConsolidationRecord(
        consolidation({
          merge_conflict: mergeConflict(),
          rebased: true,
          rebase_target: "main",
          rebase_conflict_paths: ["src/a.ts"],
        }),
      ),
    ).toBeTrue();
  });

  test("refuses a non-object, and each required field individually gone wrong", () => {
    expect(isWorktreeConsolidationRecord(null)).toBeFalse();
    expect(isWorktreeConsolidationRecord(["not", "an", "object"])).toBeFalse();
    expect(
      isWorktreeConsolidationRecord(consolidation({ harness_branch: 7 as never })),
    ).toBeFalse();
    expect(
      isWorktreeConsolidationRecord(consolidation({ merged_worktree_ids: "wt-1" as never })),
    ).toBeFalse();
    expect(isWorktreeConsolidationRecord(consolidation({ rebased: "false" as never }))).toBeFalse();
    expect(
      isWorktreeConsolidationRecord(consolidation({ removed_worktree_ids: [1] as never })),
    ).toBeFalse();
    expect(
      isWorktreeConsolidationRecord(consolidation({ commit_count: 1.5 as never })),
    ).toBeFalse();
    expect(isWorktreeConsolidationRecord(consolidation({ diffstat: 7 as never }))).toBeFalse();
    expect(
      isWorktreeConsolidationRecord(consolidation({ consolidated_at: 7 as never })),
    ).toBeFalse();
  });

  test("refuses a malformed optional field even though the field itself is optional", () => {
    expect(
      isWorktreeConsolidationRecord(
        consolidation({ merge_conflict: { paths: "not-array" } as never }),
      ),
    ).toBeFalse();
    expect(isWorktreeConsolidationRecord(consolidation({ rebase_target: 7 as never }))).toBeFalse();
    expect(
      isWorktreeConsolidationRecord(consolidation({ rebase_conflict_paths: [7] as never })),
    ).toBeFalse();
  });

  test("refuses a merge conflict whose own fields are malformed", () => {
    expect(
      isWorktreeConsolidationRecord(
        consolidation({ merge_conflict: mergeConflict({ worktree_id: 7 as never }) }),
      ),
    ).toBeFalse();
    expect(
      isWorktreeConsolidationRecord(
        consolidation({ merge_conflict: mergeConflict({ branch: 7 as never }) }),
      ),
    ).toBeFalse();
    expect(
      isWorktreeConsolidationRecord(
        consolidation({ merge_conflict: mergeConflict({ paths: [7] as never }) }),
      ),
    ).toBeFalse();
  });
});

describe("isWorktreeLedgerState", () => {
  test("accepts a minimal ledger and one carrying a consolidation record", () => {
    expect(isWorktreeLedgerState(ledger())).toBeTrue();
    expect(isWorktreeLedgerState(ledger({ base_branch: "main" }))).toBeTrue();
    expect(isWorktreeLedgerState(ledger({ consolidation: consolidation() }))).toBeTrue();
  });

  test("refuses a non-object and each top-level field individually gone wrong", () => {
    expect(isWorktreeLedgerState(null)).toBeFalse();
    expect(isWorktreeLedgerState(ledger({ harness_branch: 7 as never }))).toBeFalse();
    expect(isWorktreeLedgerState(ledger({ base_sha: 7 as never }))).toBeFalse();
    expect(isWorktreeLedgerState(ledger({ base_branch: 7 as never }))).toBeFalse();
    expect(isWorktreeLedgerState(ledger({ root: 7 as never }))).toBeFalse();
    expect(isWorktreeLedgerState(ledger({ worktrees: "not-array" as never }))).toBeFalse();
    expect(isWorktreeLedgerState(ledger({ assignments: "not-array" as never }))).toBeFalse();
    expect(isWorktreeLedgerState(ledger({ commits: "not-array" as never }))).toBeFalse();
    expect(
      isWorktreeLedgerState(ledger({ consolidation: { rebased: "no" } as never })),
    ).toBeFalse();
  });

  test("refuses a worktree entry with any single field wrong", () => {
    for (const bad of [
      worktree({ id: 7 as never }),
      worktree({ path: 7 as never }),
      worktree({ branch: 7 as never }),
      worktree({ base_sha: 7 as never }),
      worktree({ created_at: 7 as never }),
      "not-an-object",
    ]) {
      expect(isWorktreeLedgerState(ledger({ worktrees: [bad as WorktreeRecord] }))).toBeFalse();
    }
  });

  test("refuses an assignment entry with any single field wrong", () => {
    for (const bad of [
      assignment({ task_id: 7 as never }),
      assignment({ worktree_id: 7 as never }),
      assignment({ wave: 1.5 as never }),
    ]) {
      expect(isWorktreeLedgerState(ledger({ assignments: [bad] }))).toBeFalse();
    }
  });

  test("refuses a commit entry with any single field wrong", () => {
    for (const bad of [
      commit({ task_id: 7 as never }),
      commit({ worktree_id: 7 as never }),
      commit({ sha: 7 as never }),
      commit({ subject: 7 as never }),
      commit({ changed_lines: 1.5 as never }),
      commit({ over_limit: "false" as never }),
      commit({ committed_at: 7 as never }),
    ]) {
      expect(isWorktreeLedgerState(ledger({ commits: [bad] }))).toBeFalse();
    }
  });
});
