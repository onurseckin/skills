import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  consolidateWorktrees,
  recordConsolidation,
} from "../../../../olt/scripts/src/workflow/worktree/consolidate.ts";
import { readWorktreeLedger } from "../../../../olt/scripts/src/workflow/worktree/ledger.ts";
import type { GitResult, GitRunner } from "../../../../olt/scripts/src/workflow/worktree/git.ts";
import type { WorktreeLedgerState } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { FakeRunStore, baseLedger, seedLedger } from "../fixtures/fake-transact.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function trackedDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `harness-${prefix}-`));
  roots.push(dir);
  return dir;
}

type Call = { cwd: string; argv: readonly string[] };

function scripted(script: (call: Call, index: number) => GitResult): {
  runner: GitRunner;
  calls: Call[];
} {
  const calls: Call[] = [];
  const runner: GitRunner = (cwd, argv) => {
    const call = { cwd, argv };
    calls.push(call);
    return script(call, calls.length - 1);
  };
  return { runner, calls };
}

const ok = (stdout = ""): GitResult => ({ status: 0, stdout, stderr: "" });
const fail = (stderr = "", status = 1): GitResult => ({ status, stdout: "", stderr });

function ledgerWith(
  repoRoot: string,
  overrides: Partial<WorktreeLedgerState>,
): WorktreeLedgerState {
  return baseLedger({
    root: join(repoRoot, "..", "wt-root"),
    worktrees: [
      { id: "wt-0", path: "/wt/wt-0", branch: "harness--wt-0", base_sha: "base", created_at: "t" },
      { id: "wt-1", path: "/wt/wt-1", branch: "harness--wt-1", base_sha: "base", created_at: "t" },
    ],
    commits: [
      {
        task_id: "t1",
        worktree_id: "wt-0",
        sha: "sha0",
        subject: "s",
        changed_lines: 1,
        over_limit: false,
        committed_at: "t",
      },
    ],
    ...overrides,
  });
}

describe("recordConsolidation", () => {
  test("drops the removed worktrees and stores the consolidation record on the ledger", () => {
    const store = new FakeRunStore();
    const ledger = baseLedger({
      worktrees: [
        { id: "wt-0", path: "/wt/wt-0", branch: "b0", base_sha: "s", created_at: "t" },
        { id: "wt-1", path: "/wt/wt-1", branch: "b1", base_sha: "s", created_at: "t" },
      ],
    });
    seedLedger(store, ledger);
    const consolidation = {
      harness_branch: ledger.harness_branch,
      merged_worktree_ids: ["wt-0"],
      rebased: false,
      removed_worktree_ids: ["wt-0", "wt-1"],
      commit_count: 1,
      diffstat: "1 file changed",
      consolidated_at: "2026-08-19T00:00:00.000Z",
    };
    recordConsolidation(store.runRoot, "tester", consolidation, store.transact);
    const state = store.read();
    const stored = readWorktreeLedger(state)!;
    expect(stored.worktrees).toEqual([]);
    expect(stored.consolidation).toEqual(consolidation);
  });

  test("throws INVALID_STATE when there is no worktree ledger to consolidate against", () => {
    const store = new FakeRunStore();
    expect(() =>
      recordConsolidation(
        store.runRoot,
        "tester",
        {
          harness_branch: "h",
          merged_worktree_ids: [],
          rebased: false,
          removed_worktree_ids: [],
          commit_count: 0,
          diffstat: "0 files changed",
          consolidated_at: "2026-08-19T00:00:00.000Z",
        },
        store.transact,
      ),
    ).toThrow(/no worktree ledger to consolidate/);
  });
});
