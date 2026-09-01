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

describe("diffStat", () => {
  let vfsCleanup: (() => void) | undefined;

  beforeEach(() => {
    const setup = setupWorkflowVirtualFs();
    vfsCleanup = setup.cleanup;
  });

  afterEach(() => {
    vfsCleanup?.();
    vfsCleanup = undefined;
  });

  test("returns the last line of git diff --stat output", () => {
    const { runner, calls } = recordingRunner(() =>
      ok(" a.txt | 2 +-\n b.txt | 1 +\n 2 files changed, 2 insertions(+), 1 deletion(-)\n"),
    );
    expect(diffStat("/scratch", "base", "HEAD", runner)).toBe(
      "2 files changed, 2 insertions(+), 1 deletion(-)",
    );
    expect(calls[0]!.argv).toEqual(["diff", "--stat", "base..HEAD"]);
  });

  test("reports no changes when the diff is empty", () => {
    const { runner } = recordingRunner(() => ok("   \n"));
    expect(diffStat("/scratch", "base", "HEAD", runner)).toBe("0 files changed");
  });
});

describe("stageAndCommit", () => {
  test("returns null when the pathspecs match no files", () => {
    const { runner } = recordingRunner((call) => {
      if (call.argv[0] === "add") return fail("fatal: pathspec 'src/x' did not match any files", 1);
      return ok();
    });
    expect(stageAndCommit("/scratch", ["src/x"], "feat: x", runner)).toBeNull();
  });

  test("throws INTEGRITY when git add fails for a reason other than an empty pathspec", () => {
    const { runner } = recordingRunner((call) => {
      if (call.argv[0] === "add") return fail("fatal: permission denied", 1);
      return ok();
    });
    expect(() => stageAndCommit("/scratch", ["src/x"], "feat: x", runner)).toThrow(
      /git add -A -- src\/x exited 1: fatal: permission denied/,
    );
  });

  test("returns null when nothing ends up staged", () => {
    const { runner } = recordingRunner((call) => {
      if (call.argv[0] === "add") return ok();
      if (call.argv[0] === "diff") return ok(); // --cached --quiet exits 0 => nothing staged
      return ok();
    });
    expect(stageAndCommit("/scratch", ["src/x"], "feat: x", runner)).toBeNull();
  });

  test("commits staged changes and returns the new head sha", () => {
    const { runner, calls } = recordingRunner((call) => {
      if (call.argv[0] === "add") return ok();
      if (call.argv[0] === "diff") return fail("", 1); // staged changes present
      if (call.argv[0] === "commit") return ok();
      if (call.argv[0] === "rev-parse") return ok("cafef00d\n");
      return ok();
    });
    expect(stageAndCommit("/scratch", ["src/x"], "feat: x", runner)).toBe("cafef00d");
    expect(calls.some((c) => c.argv[0] === "commit" && c.argv.includes("feat: x"))).toBe(true);
    expect(calls.some((c) => c.argv[0] === "add" && c.argv.includes("-A"))).toBe(true);
  });

  test("throws INVALID_ARGUMENT when given no pathspecs", () => {
    const { runner } = recordingRunner(() => ok());
    expect(() => stageAndCommit("/scratch", [], "feat: x", runner)).toThrow(
      /needs at least one write-scope path/,
    );
  });
});

describe("commitChangedLines", () => {
  test("sums insertions and deletions parsed from shortstat", () => {
    const { runner } = recordingRunner(() =>
      ok(" 2 files changed, 3 insertions(+), 5 deletions(-)\n"),
    );
    expect(commitChangedLines("/scratch", "cafef00d", runner)).toBe(8);
  });

  test("treats a missing insertion or deletion count as zero", () => {
    const { runner } = recordingRunner(() => ok(" 1 file changed, 4 insertions(+)\n"));
    expect(commitChangedLines("/scratch", "cafef00d", runner)).toBe(4);
  });

  test("returns zero when shortstat reports no changes at all", () => {
    const { runner } = recordingRunner(() => ok(""));
    expect(commitChangedLines("/scratch", "cafef00d", runner)).toBe(0);
  });
});

describe("stageAndCommit with deletions", () => {
  test("stages additions, modifications, and deletions atomically via add -A", () => {
    const { runner, calls } = recordingRunner((call) => {
      if (call.argv[0] === "add") return ok();
      if (call.argv[0] === "diff") return fail("", 1); // changes staged
      if (call.argv[0] === "commit") return ok();
      if (call.argv[0] === "rev-parse") return ok("deleted-sha\n");
      return ok();
    });
    const sha = stageAndCommit("/scratch", ["src/deleted.ts"], "feat: delete file", runner);
    expect(sha).toBe("deleted-sha");
    expect(calls.some((c) => c.argv[0] === "add" && c.argv.includes("-A"))).toBe(true);
  });
});

describe("commitProvenance", () => {
  test("resolves parentSha and treeSha from git rev-parse", () => {
    const { runner } = recordingRunner((call) => {
      if (call.argv.includes("HEAD^")) return ok("parent-sha-123\n");
      if (call.argv.includes("HEAD^{tree}")) return ok("tree-sha-456\n");
      return ok();
    });
    const prov = commitProvenance("/scratch", "HEAD", runner);
    expect(prov).toEqual({
      parentSha: "parent-sha-123",
      treeSha: "tree-sha-456",
    });
  });

  test("handles root commit without parentSha", () => {
    const { runner } = recordingRunner((call) => {
      if (call.argv.includes("HEAD^")) return fail("bad revision", 1);
      if (call.argv.includes("HEAD^{tree}")) return ok("tree-sha-456\n");
      return ok();
    });
    const prov = commitProvenance("/scratch", "HEAD", runner);
    expect(prov).toEqual({
      treeSha: "tree-sha-456",
    });
  });
});
