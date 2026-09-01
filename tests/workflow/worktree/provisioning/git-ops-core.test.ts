import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  addWorktree,
  addWorktreeForBranch,
  branchExists,
  commitChangedLines,
  createBranch,
  currentBranch,
  deleteBranch,
  diffStat,
  headSha,
  mergeBranch,
  pruneWorktrees,
  rebaseOnto,
  removeWorktree,
  stageAndCommit,
  commitProvenance,
} from "../../../../olt/scripts/src/workflow/worktree/git-ops.ts";
import type { GitResult, GitRunner } from "../../../../olt/scripts/src/workflow/worktree/git.ts";
import { setupWorkflowVirtualFs } from "../../shared/index.ts";

type Call = { cwd: string; argv: readonly string[] };

function recordingRunner(script: (call: Call, index: number) => GitResult): {
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
const fail = (stderr = "boom", status = 1): GitResult => ({ status, stdout: "", stderr });

describe("headSha", () => {
  let vfsCleanup: (() => void) | undefined;

  beforeEach(() => {
    const setup = setupWorkflowVirtualFs();
    vfsCleanup = setup.cleanup;
  });

  afterEach(() => {
    vfsCleanup?.();
    vfsCleanup = undefined;
  });

  test("trims trailing whitespace from rev-parse output", () => {
    const { runner } = recordingRunner(() => ok("deadbeef\n"));
    expect(headSha("/repo", runner)).toBe("deadbeef");
  });
});

describe("branchExists", () => {
  test("is true when rev-parse --verify exits zero", () => {
    const { runner, calls } = recordingRunner(() => ok());
    expect(branchExists("/repo", "feature", runner)).toBe(true);
    expect(calls[0]!.argv).toEqual(["rev-parse", "--verify", "--quiet", "refs/heads/feature"]);
  });

  test("is false when rev-parse --verify exits non-zero", () => {
    const { runner } = recordingRunner(() => fail("", 1));
    expect(branchExists("/repo", "missing", runner)).toBe(false);
  });
});

describe("createBranch", () => {
  test("runs git branch <name> <sha>", () => {
    const { runner, calls } = recordingRunner(() => ok());
    createBranch("/repo", "feature", "abc123", runner);
    expect(calls[0]!.argv).toEqual(["branch", "feature", "abc123"]);
  });
});

describe("addWorktree / addWorktreeForBranch", () => {
  test("addWorktree creates a new branch at the given sha", () => {
    const { runner, calls } = recordingRunner(() => ok());
    addWorktree("/repo", "/repo/../wt-0", "harness--wt-0", "abc123", runner);
    expect(calls[0]!.argv).toEqual([
      "worktree",
      "add",
      "-b",
      "harness--wt-0",
      "/repo/../wt-0",
      "abc123",
    ]);
  });

  test("addWorktreeForBranch attaches an existing branch", () => {
    const { runner, calls } = recordingRunner(() => ok());
    addWorktreeForBranch("/repo", "/scratch", "harness/run-1", runner);
    expect(calls[0]!.argv).toEqual(["worktree", "add", "/scratch", "harness/run-1"]);
  });
});

describe("currentBranch", () => {
  test("returns the branch name on success", () => {
    const { runner } = recordingRunner(() => ok("main\n"));
    expect(currentBranch("/repo", runner)).toBe("main");
  });

  test("returns null on detached HEAD (non-zero exit)", () => {
    const { runner } = recordingRunner(() => fail("", 1));
    expect(currentBranch("/repo", runner)).toBeNull();
  });

  test("returns null when stdout is blank even on success", () => {
    const { runner } = recordingRunner(() => ok("  \n"));
    expect(currentBranch("/repo", runner)).toBeNull();
  });
});

describe("mergeBranch", () => {
  test("returns null on a clean merge", () => {
    const { runner, calls } = recordingRunner(() => ok());
    const outcome = mergeBranch("/scratch", "wt-0-branch", "chore: merge", runner);
    expect(outcome).toBeNull();
    expect(calls[0]!.argv).toEqual(["merge", "--no-ff", "-m", "chore: merge", "wt-0-branch"]);
  });

  test("returns conflict paths and aborts the merge on conflict", () => {
    const { runner, calls } = recordingRunner((call, index) => {
      if (index === 0) return fail("CONFLICT", 1);
      if (call.argv[0] === "diff") return ok("a.txt\nb.txt\n");
      return ok();
    });
    const outcome = mergeBranch("/scratch", "wt-0-branch", "chore: merge", runner);
    expect(outcome).toEqual({ conflictPaths: ["a.txt", "b.txt"] });
    expect(calls.at(-1)!.argv).toEqual(["merge", "--abort"]);
  });

  test("throws INTEGRITY when the merge fails without any conflicted paths", () => {
    const { runner } = recordingRunner((call) => {
      if (call.argv[0] === "merge" && call.argv.includes("--no-ff"))
        return fail("fatal: bad object", 128);
      if (call.argv[0] === "diff") return ok("");
      return ok();
    });
    expect(() => mergeBranch("/scratch", "wt-0-branch", "chore: merge", runner)).toThrow(
      /git merge --no-ff wt-0-branch exited 128: fatal: bad object/,
    );
  });

  test("reports the fallback detail when both stderr and conflict paths are empty", () => {
    const { runner } = recordingRunner((call) => {
      if (call.argv[0] === "merge" && call.argv.includes("--no-ff")) return fail("", 1);
      return ok("");
    });
    expect(() => mergeBranch("/scratch", "wt-0-branch", "chore: merge", runner)).toThrow(
      /no conflicted paths found/,
    );
  });
});

describe("rebaseOnto", () => {
  test("returns null on a clean rebase", () => {
    const { runner, calls } = recordingRunner(() => ok());
    expect(rebaseOnto("/scratch", "main", runner)).toBeNull();
    expect(calls[0]!.argv).toEqual(["rebase", "main"]);
  });

  test("returns conflict paths and aborts on conflict", () => {
    const { runner, calls } = recordingRunner((call, index) => {
      if (index === 0) return fail("CONFLICT", 1);
      if (call.argv[0] === "diff") return ok("src/a.ts\n");
      return ok();
    });
    const outcome = rebaseOnto("/scratch", "main", runner);
    expect(outcome).toEqual({ conflictPaths: ["src/a.ts"] });
    expect(calls.at(-1)!.argv).toEqual(["rebase", "--abort"]);
  });

  test("throws INTEGRITY when the rebase fails without any conflicted paths", () => {
    const { runner } = recordingRunner((call) => {
      if (call.argv[0] === "rebase" && call.argv[1] === "main")
        return fail("fatal: no such branch", 128);
      return ok("");
    });
    expect(() => rebaseOnto("/scratch", "main", runner)).toThrow(
      /git rebase main exited 128: fatal: no such branch/,
    );
  });
});

describe("removeWorktree / deleteBranch / pruneWorktrees", () => {
  test("removeWorktree forces removal at the given path", () => {
    const { runner, calls } = recordingRunner(() => ok());
    removeWorktree("/repo", "/repo/../wt-0", runner);
    expect(calls[0]!.argv).toEqual(["worktree", "remove", "--force", "/repo/../wt-0"]);
  });

  test("deleteBranch force-deletes the named branch", () => {
    const { runner, calls } = recordingRunner(() => ok());
    deleteBranch("/repo", "harness--wt-0", runner);
    expect(calls[0]!.argv).toEqual(["branch", "-D", "harness--wt-0"]);
  });

  test("pruneWorktrees runs git worktree prune", () => {
    const { runner, calls } = recordingRunner(() => ok());
    pruneWorktrees("/repo", runner);
    expect(calls[0]!.argv).toEqual(["worktree", "prune"]);
  });
});
