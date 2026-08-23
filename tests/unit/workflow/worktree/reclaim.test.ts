import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  reclaimOrphanedWorktrees,
  recordReclaim,
} from "../../../../olt/scripts/src/workflow/worktree/reclaim.ts";
import { readWorktreeLedger } from "../../../../olt/scripts/src/workflow/worktree/ledger.ts";
import type { GitResult, GitRunner } from "../../../../olt/scripts/src/workflow/worktree/git.ts";
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

function scripted(
  script: (call: Call, index: number) => GitResult = () => ({ status: 0, stdout: "", stderr: "" }),
): {
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

describe("reclaimOrphanedWorktrees", () => {
  test("removes and reports every worktree whose path still exists on disk", () => {
    const repoRoot = trackedDir("reclaim-repo");
    const present = trackedDir("reclaim-wt-present");
    const ledger = baseLedger({
      worktrees: [
        { id: "wt-0", path: present, branch: "b0", base_sha: "s", created_at: "t" },
        { id: "wt-1", path: join(present, "gone"), branch: "b1", base_sha: "s", created_at: "t" },
      ],
    });
    const { runner, calls } = scripted();
    const result = reclaimOrphanedWorktrees({ repoRoot, ledger, runner });
    expect(result).toEqual({ reclaimed_worktree_ids: ["wt-0"] });
    const removeCall = calls.find((c) => c.argv[0] === "worktree" && c.argv[1] === "remove");
    expect(removeCall?.argv).toEqual(["worktree", "remove", "--force", present]);
    const pruneCall = calls.at(-1)!;
    expect(pruneCall.argv).toEqual(["worktree", "prune"]);
  });

  test("prunes but reclaims nothing when no worktree path exists on disk", () => {
    const repoRoot = trackedDir("reclaim-repo-empty");
    const ledger = baseLedger({
      worktrees: [
        {
          id: "wt-0",
          path: join(repoRoot, "does-not-exist"),
          branch: "b0",
          base_sha: "s",
          created_at: "t",
        },
      ],
    });
    const { runner, calls } = scripted();
    const result = reclaimOrphanedWorktrees({ repoRoot, ledger, runner });
    expect(result.reclaimed_worktree_ids).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.argv).toEqual(["worktree", "prune"]);
  });
});

describe("recordReclaim", () => {
  test("drops the reclaimed worktrees from the ledger", () => {
    const store = new FakeRunStore();
    const ledger = baseLedger({
      worktrees: [
        { id: "wt-0", path: "/repo/wt-0", branch: "b0", base_sha: "s", created_at: "t" },
        { id: "wt-1", path: "/repo/wt-1", branch: "b1", base_sha: "s", created_at: "t" },
      ],
    });
    seedLedger(store, ledger);
    recordReclaim(store.runRoot, "tester", { reclaimed_worktree_ids: ["wt-0"] }, store.transact);
    const state = store.read();
    const remaining = readWorktreeLedger(state)!;
    expect(remaining.worktrees.map((w) => w.id)).toEqual(["wt-1"]);
  });

  test("throws INVALID_STATE when there is no worktree ledger to reclaim against", () => {
    const store = new FakeRunStore();
    expect(() =>
      recordReclaim(store.runRoot, "tester", { reclaimed_worktree_ids: [] }, store.transact),
    ).toThrow(/no worktree ledger to reclaim/);
  });
});
