import { describe, expect, it } from "bun:test";
import {
  isBranchStatus,
  isBranchSubTaskStatus,
  isBranchLease,
  isBranchSubTask,
  isBranchRecord,
  isSubTaskTerminal,
  isBranchOpen,
  BRANCH_STATUSES,
  BRANCH_SUB_TASK_STATUSES,
} from "../../../olt/scripts/src/core/contracts/git/branch.ts";
import {
  isWorktreeConsolidationRecord,
  isWorktreeLedgerState,
} from "../../../olt/scripts/src/core/contracts/git/worktree.ts";
import {
  evidenced,
} from "../../../olt/scripts/src/core/contracts/system/evidence.ts";

describe("core/contracts/git/branch.ts", () => {
  it("validates branch status, subtasks, records, and terminal checks", () => {
    for (const s of BRANCH_STATUSES) {
      expect(isBranchStatus(s)).toBe(true);
    }
    expect(isBranchStatus("bad")).toBe(false);

    for (const s of BRANCH_SUB_TASK_STATUSES) {
      expect(isBranchSubTaskStatus(s)).toBe(true);
    }
    expect(isBranchSubTaskStatus("bad")).toBe(false);

    const lease = {
      agent_id: "agent-1",
      token_digest: "tok-abc",
      issued_at: "2026-08-30T00:00:00Z",
      expires_at: "2026-08-30T01:00:00Z",
      duration_seconds: 3600,
    };
    expect(isBranchLease(lease)).toBe(true);
    expect(isBranchLease({ ...lease, duration_seconds: 3600.5 })).toBe(false);
    expect(isBranchLease(null)).toBe(false);

    const subTask = {
      id: "st-1",
      label: "Subtask 1",
      write_scope: ["src/file.ts"],
      status: "claimed" as const,
      agent_id: "agent-1",
      lease,
    };
    expect(isBranchSubTask(subTask)).toBe(true);
    expect(isBranchSubTask({ ...subTask, write_scope: [] })).toBe(false);
    expect(isBranchSubTask(null)).toBe(false);

    const record = {
      id: "branch-1",
      parent_task_id: "task-1",
      parent_agent_id: "agent-0",
      reason: "parallelization",
      depth: 1,
      sub_tasks: [subTask],
      status: "open" as const,
      opened_at: "2026-08-30T00:00:00Z",
      files_changed: evidenced(["src/file.ts"], "harness_observed"),
      opened_observation: {
        observed_at: "2026-08-30T00:00:00Z",
        git_available: true,
        head: "main",
        entries: [{ path: "src/file.ts", status_code: "M", sha256: "abc" }],
      },
    };
    expect(isBranchRecord(record)).toBe(true);
    expect(isBranchRecord({ ...record, depth: 0 })).toBe(false);
    expect(isBranchRecord(null)).toBe(false);

    expect(isSubTaskTerminal({ ...subTask, status: "submitted" })).toBe(true);
    expect(isSubTaskTerminal({ ...subTask, status: "abandoned" })).toBe(true);
    expect(isSubTaskTerminal({ ...subTask, status: "claimed" })).toBe(false);

    expect(isBranchOpen(record)).toBe(true);
    expect(isBranchOpen({ ...record, status: "collected" })).toBe(false);
  });
});

describe("core/contracts/git/worktree.ts", () => {
  it("validates worktree consolidation and ledger state records", () => {
    const consolidation = {
      harness_branch: "olt/main",
      merged_worktree_ids: ["wt-1", "wt-2"],
      merge_conflict: {
        worktree_id: "wt-1",
        branch: "olt/wt-1",
        paths: ["conflicted.ts"],
      },
      rebased: true,
      rebase_target: "main",
      rebase_conflict_paths: [],
      removed_worktree_ids: ["wt-1"],
      commit_count: 3,
      diffstat: "2 files changed",
      consolidated_at: "2026-08-30T00:00:00Z",
    };
    expect(isWorktreeConsolidationRecord(consolidation)).toBe(true);
    expect(isWorktreeConsolidationRecord({ ...consolidation, commit_count: -1 })).toBe(true);
    expect(isWorktreeConsolidationRecord({ ...consolidation, harness_branch: 123 })).toBe(false);
    expect(isWorktreeConsolidationRecord(null)).toBe(false);

    const ledger = {
      harness_branch: "olt/main",
      base_sha: "sha123",
      root: "/tmp/worktrees",
      worktrees: [
        {
          id: "wt-1",
          path: "/tmp/worktrees/wt-1",
          branch: "olt/wt-1",
          base_sha: "sha123",
          created_at: "2026-08-30T00:00:00Z",
        },
      ],
      assignments: [
        {
          task_id: "task-1",
          worktree_id: "wt-1",
          wave: 1,
        },
      ],
      commits: [
        {
          task_id: "task-1",
          worktree_id: "wt-1",
          sha: "sha456",
          subject: "feat: work done",
          changed_lines: 50,
          over_limit: false,
          committed_at: "2026-08-30T00:01:00Z",
        },
      ],
      consolidation,
    };
    expect(isWorktreeLedgerState(ledger)).toBe(true);
    expect(isWorktreeLedgerState({ ...ledger, base_sha: 123 })).toBe(false);
    expect(isWorktreeLedgerState(null)).toBe(false);
  });
});
