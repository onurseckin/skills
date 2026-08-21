import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  consolidateWorktrees,
  recordConsolidation,
} from "../../../../orchestrating-long-tasks/scripts/src/workflow/worktree/consolidate.ts";
import { readWorktreeLedger } from "../../../../orchestrating-long-tasks/scripts/src/workflow/worktree/ledger.ts";
import type {
  GitResult,
  GitRunner,
} from "../../../../orchestrating-long-tasks/scripts/src/workflow/worktree/git.ts";
import type { WorktreeLedgerState } from "../../../../orchestrating-long-tasks/scripts/src/contracts/worktree.ts";
import { FakeRunStore, baseLedger, seedLedger } from "./fake-transact.ts";

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

describe("consolidateWorktrees", () => {
  test("merges every worktree with commits, removes them all, and reports a finished consolidation", () => {
    const repoRoot = trackedDir("consolidate-repo");
    const ledger = ledgerWith(repoRoot, {});
    const { runner, calls } = scripted(() => ok());
    const result = consolidateWorktrees({
      repoRoot,
      runId: "run-1",
      ledger,
      rebaseOnComplete: false,
      now: new Date("2026-08-19T00:00:00.000Z"),
      runner,
    });
    expect(result.merged_worktree_ids).toEqual(["wt-0"]);
    expect(result.merge_conflict).toBeUndefined();
    expect(result.rebased).toBe(false);
    expect(result.rebase_target).toBeUndefined();
    expect(result.removed_worktree_ids).toEqual(["wt-0", "wt-1"]);
    expect(result.commit_count).toBe(1);
    expect(result.consolidated_at).toBe("2026-08-19T00:00:00.000Z");
    expect(result.harness_branch).toBe(ledger.harness_branch);
    const mergeCall = calls.find((c) => c.argv[0] === "merge" && c.argv.includes("--no-ff"));
    expect(mergeCall?.argv).toContain("harness--wt-0");
    expect(
      calls.some(
        (c) => c.argv[0] === "worktree" && c.argv[1] === "remove" && c.argv.at(-1) === "/wt/wt-1",
      ),
    ).toBe(true);
    expect(
      calls.some(
        (c) => c.argv[0] === "branch" && c.argv[1] === "-D" && c.argv[2] === "harness--wt-1",
      ),
    ).toBe(true);
  });

  test("skips a worktree with no commits and reports it as neither merged nor removed-for-merge-purposes but still removed", () => {
    const repoRoot = trackedDir("consolidate-no-commits");
    const ledger = ledgerWith(repoRoot, { commits: [] });
    const { runner, calls } = scripted(() => ok());
    const result = consolidateWorktrees({
      repoRoot,
      runId: "run-1",
      ledger,
      rebaseOnComplete: false,
      runner,
    });
    expect(result.merged_worktree_ids).toEqual([]);
    expect(calls.some((c) => c.argv[0] === "merge")).toBe(false);
    expect(result.removed_worktree_ids).toEqual(["wt-0", "wt-1"]);
  });

  test("stops merging at the first conflict, leaves worktrees in place, but still cleans up the scratch worktree", () => {
    const repoRoot = trackedDir("consolidate-conflict");
    const ledger = ledgerWith(repoRoot, {
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
        {
          task_id: "t2",
          worktree_id: "wt-1",
          sha: "sha1",
          subject: "s",
          changed_lines: 1,
          over_limit: false,
          committed_at: "t",
        },
      ],
    });
    const { runner, calls } = scripted((call) => {
      if (call.argv[0] === "merge" && call.argv.includes("--no-ff")) return fail("CONFLICT", 1);
      if (call.argv[0] === "diff" && call.argv.includes("--name-only")) return ok("a.txt\n");
      return ok();
    });
    const result = consolidateWorktrees({
      repoRoot,
      runId: "run-1",
      ledger,
      rebaseOnComplete: false,
      runner,
    });
    expect(result.merge_conflict).toEqual({
      worktree_id: "wt-0",
      branch: "harness--wt-0",
      paths: ["a.txt"],
    });
    expect(result.merged_worktree_ids).toEqual([]);
    expect(result.removed_worktree_ids).toEqual([]);
    // wt-1 never even attempted since the loop breaks on the first conflict
    expect(calls.filter((c) => c.argv[0] === "merge" && c.argv.includes("--no-ff"))).toHaveLength(
      1,
    );
    // the scratch worktree is still torn down even though consolidation did not finish
    expect(
      calls.some(
        (c) =>
          c.argv[0] === "worktree" &&
          c.argv[1] === "remove" &&
          c.argv.at(-1)?.includes("consolidate"),
      ),
    ).toBe(true);
  });

  test("rebases onto the base branch when requested, merges are clean, and a base branch is recorded", () => {
    const repoRoot = trackedDir("consolidate-rebase");
    const ledger = ledgerWith(repoRoot, { base_branch: "main", commits: [] });
    const { runner, calls } = scripted(() => ok());
    const result = consolidateWorktrees({
      repoRoot,
      runId: "run-1",
      ledger,
      rebaseOnComplete: true,
      runner,
    });
    expect(result.rebased).toBe(true);
    expect(result.rebase_target).toBe("main");
    expect(result.rebase_conflict_paths).toBeUndefined();
    expect(calls.some((c) => c.argv[0] === "rebase" && c.argv[1] === "main")).toBe(true);
    expect(result.removed_worktree_ids).toEqual(["wt-0", "wt-1"]);
  });

  test("records a rebase conflict, leaves it unfinished, and does not remove the worktrees", () => {
    const repoRoot = trackedDir("consolidate-rebase-conflict");
    const ledger = ledgerWith(repoRoot, { base_branch: "main", commits: [] });
    const { runner } = scripted((call) => {
      if (call.argv[0] === "rebase" && call.argv[1] === "main") return fail("CONFLICT", 1);
      if (call.argv[0] === "diff" && call.argv.includes("--name-only")) return ok("b.txt\n");
      return ok();
    });
    const result = consolidateWorktrees({
      repoRoot,
      runId: "run-1",
      ledger,
      rebaseOnComplete: true,
      runner,
    });
    expect(result.rebased).toBe(false);
    expect(result.rebase_conflict_paths).toEqual(["b.txt"]);
    expect(result.removed_worktree_ids).toEqual([]);
  });

  test("skips rebasing when rebaseOnComplete is false, even with a base branch on record", () => {
    const repoRoot = trackedDir("consolidate-no-rebase-flag");
    const ledger = ledgerWith(repoRoot, { base_branch: "main", commits: [] });
    const { runner, calls } = scripted(() => ok());
    const result = consolidateWorktrees({
      repoRoot,
      runId: "run-1",
      ledger,
      rebaseOnComplete: false,
      runner,
    });
    expect(result.rebased).toBe(false);
    expect(result.rebase_target).toBe("main");
    expect(calls.some((c) => c.argv[0] === "rebase")).toBe(false);
  });

  test("skips rebasing when there is no base branch on record, even when requested", () => {
    const repoRoot = trackedDir("consolidate-no-base-branch");
    const ledger = ledgerWith(repoRoot, { commits: [] });
    const { runner, calls } = scripted(() => ok());
    const result = consolidateWorktrees({
      repoRoot,
      runId: "run-1",
      ledger,
      rebaseOnComplete: true,
      runner,
    });
    expect(result.rebased).toBe(false);
    expect(result.rebase_target).toBeUndefined();
    expect(calls.some((c) => c.argv[0] === "rebase")).toBe(false);
  });

  test("defaults consolidated_at to the current time when now is not supplied", () => {
    const repoRoot = trackedDir("consolidate-default-now");
    const ledger = ledgerWith(repoRoot, { commits: [] });
    const { runner } = scripted(() => ok());
    const before = Date.now();
    const result = consolidateWorktrees({
      repoRoot,
      runId: "run-1",
      ledger,
      rebaseOnComplete: false,
      runner,
    });
    expect(new Date(result.consolidated_at).getTime()).toBeGreaterThanOrEqual(before);
  });
});

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
