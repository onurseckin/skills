import { describe, expect, test } from "bun:test";
import {
  commitSubphase,
  recordWorktreeCommit,
} from "../../../../olt/scripts/src/workflow/worktree/commit.ts";
import { readWorktreeLedger } from "../../../../olt/scripts/src/workflow/worktree/ledger.ts";
import type { GitResult, GitRunner } from "../../../../olt/scripts/src/workflow/worktree/git.ts";
import type { WorktreeCommitRecord } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { FakeRunStore, baseLedger, seedLedger, seedTask } from "./fake-transact.ts";

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

describe("commitSubphase", () => {
  test("rejects a commit type that is not a recognised conventional-commit tag", () => {
    const { runner } = scripted(() => ok());
    expect(() =>
      commitSubphase({
        taskId: "T-1",
        worktreeId: "wt-0",
        worktreePath: "/scratch",
        writeScope: ["src/a"],
        label: "add a",
        commitType: "bogus",
        maxCommitLines: 400,
        runner,
      }),
    ).toThrow(/not a recognised tag/);
  });

  test("rejects a task with an empty write scope", () => {
    const { runner } = scripted(() => ok());
    expect(() =>
      commitSubphase({
        taskId: "T-1",
        worktreeId: "wt-0",
        worktreePath: "/scratch",
        writeScope: [],
        label: "add a",
        commitType: "feat",
        maxCommitLines: 400,
        runner,
      }),
    ).toThrow(/has no write scope to commit/);
  });

  test("returns committed: false when there is nothing to stage", () => {
    const { runner } = scripted((call) => {
      if (call.argv[0] === "add") return ok();
      if (call.argv[0] === "diff") return ok(); // --cached --quiet exits 0 => nothing staged
      return ok();
    });
    const outcome = commitSubphase({
      taskId: "T-1",
      worktreeId: "wt-0",
      worktreePath: "/scratch",
      writeScope: ["src/a"],
      label: "add a",
      commitType: "feat",
      maxCommitLines: 400,
      runner,
    });
    expect(outcome).toEqual({ committed: false });
  });

  test("builds a conventional commit subject, truncating an overlong label to fit 70 chars", () => {
    const { runner, calls } = scripted((call) => {
      if (call.argv[0] === "add") return ok();
      if (call.argv[0] === "diff") return fail("", 1);
      if (call.argv[0] === "commit") return ok();
      if (call.argv[0] === "rev-parse") return ok("cafef00d1234\n");
      if (call.argv[0] === "show") return ok(" 1 file changed, 2 insertions(+)\n");
      return ok();
    });
    const label = "a".repeat(80);
    const outcome = commitSubphase({
      taskId: "T-1",
      worktreeId: "wt-0",
      worktreePath: "/scratch",
      writeScope: ["src/a"],
      label,
      commitType: "feat",
      maxCommitLines: 400,
      now: new Date("2026-08-19T00:00:00.000Z"),
      runner,
    });
    expect(outcome.committed).toBe(true);
    expect(outcome.commit?.subject.length).toBeLessThanOrEqual(70);
    expect(outcome.commit?.subject.startsWith("feat: ")).toBe(true);
    expect(outcome.commit?.subject.endsWith("…")).toBe(true);
    expect(outcome.warning).toBeUndefined();
    const commitCall = calls.find((c) => c.argv[0] === "commit");
    expect(commitCall?.argv).toContain(outcome.commit?.subject);
  });

  test("flags a commit whose changed-line count exceeds the configured max", () => {
    const { runner } = scripted((call) => {
      if (call.argv[0] === "add") return ok();
      if (call.argv[0] === "diff") return fail("", 1);
      if (call.argv[0] === "commit") return ok();
      if (call.argv[0] === "rev-parse") return ok("cafef00d1234\n");
      if (call.argv[0] === "show") return ok(" 1 file changed, 500 insertions(+)\n");
      return ok();
    });
    const outcome = commitSubphase({
      taskId: "T-1",
      worktreeId: "wt-0",
      worktreePath: "/scratch",
      writeScope: ["src/a"],
      label: "big change",
      commitType: "feat",
      maxCommitLines: 400,
      runner,
    });
    expect(outcome.commit?.over_limit).toBe(true);
    expect(outcome.warning).toMatch(/over the 400-line target \(B22\.3\)/);
    expect(outcome.warning).toContain(outcome.commit!.sha.slice(0, 12));
  });

  test("converts a glob write-scope entry into a git glob pathspec and a directory scope into the directory itself", () => {
    const { runner, calls } = scripted((call) => {
      if (call.argv[0] === "add") return ok();
      if (call.argv[0] === "diff") return fail("", 1);
      if (call.argv[0] === "commit") return ok();
      if (call.argv[0] === "rev-parse") return ok("cafef00d1234\n");
      if (call.argv[0] === "show") return ok("");
      return ok();
    });
    commitSubphase({
      taskId: "T-1",
      worktreeId: "wt-0",
      worktreePath: "/scratch",
      writeScope: ["src/pkg/**", "src/*.ts", "README.md"],
      label: "many scopes",
      commitType: "chore",
      maxCommitLines: 400,
      runner,
    });
    const addCall = calls.find((c) => c.argv[0] === "add")!;
    expect(addCall.argv).toEqual(["add", "--", "src/pkg", ":(glob)src/*.ts", "README.md"]);
  });

  test("collapses a bare '/**' write-scope entry (empty directory) to '.'", () => {
    const { runner, calls } = scripted((call) => {
      if (call.argv[0] === "add") return ok();
      if (call.argv[0] === "diff") return fail("", 1);
      if (call.argv[0] === "commit") return ok();
      if (call.argv[0] === "rev-parse") return ok("cafef00d1234\n");
      if (call.argv[0] === "show") return ok("");
      return ok();
    });
    commitSubphase({
      taskId: "T-1",
      worktreeId: "wt-0",
      worktreePath: "/scratch",
      writeScope: ["/**"],
      label: "everything",
      commitType: "chore",
      maxCommitLines: 400,
      runner,
    });
    const addCall = calls.find((c) => c.argv[0] === "add")!;
    expect(addCall.argv).toEqual(["add", "--", "."]);
  });
});

describe("recordWorktreeCommit", () => {
  test("appends the commit to the ledger and stamps it onto the task", () => {
    const store = new FakeRunStore();
    seedLedger(store, baseLedger());
    seedTask(store, "T-1");
    const commit: WorktreeCommitRecord = {
      task_id: "T-1",
      worktree_id: "wt-0",
      sha: "cafef00d",
      subject: "feat: x",
      changed_lines: 2,
      over_limit: false,
      committed_at: "2026-08-19T00:00:00.000Z",
    };
    recordWorktreeCommit(store.runRoot, "tester", "T-1", commit, store.transact);
    const state = store.read();
    const ledger = readWorktreeLedger(state)!;
    expect(ledger.commits).toEqual([commit]);
    expect(
      (state as unknown as { tasks: Record<string, { worktree_commit: unknown }> }).tasks["T-1"]!
        .worktree_commit,
    ).toEqual(commit);
  });

  test("throws INVALID_STATE when there is no worktree ledger to record against", () => {
    const store = new FakeRunStore();
    seedTask(store, "T-1");
    const commit: WorktreeCommitRecord = {
      task_id: "T-1",
      worktree_id: "wt-0",
      sha: "cafef00d",
      subject: "feat: x",
      changed_lines: 2,
      over_limit: false,
      committed_at: "2026-08-19T00:00:00.000Z",
    };
    expect(() =>
      recordWorktreeCommit(store.runRoot, "tester", "T-1", commit, store.transact),
    ).toThrow(/no worktree ledger to record a commit against/);
  });

  test("throws INVALID_ARGUMENT when the task is unknown", () => {
    const store = new FakeRunStore();
    seedLedger(store, baseLedger());
    const commit: WorktreeCommitRecord = {
      task_id: "T-ghost",
      worktree_id: "wt-0",
      sha: "cafef00d",
      subject: "feat: x",
      changed_lines: 2,
      over_limit: false,
      committed_at: "2026-08-19T00:00:00.000Z",
    };
    expect(() =>
      recordWorktreeCommit(store.runRoot, "tester", "T-ghost", commit, store.transact),
    ).toThrow(/unknown task T-ghost/);
  });
});
