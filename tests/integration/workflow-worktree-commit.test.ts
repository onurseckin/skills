import { describe, expect, test, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitSubphase } from "../../orchestrating-long-tasks/scripts/src/workflow/worktree/commit.ts";

function git(repo: string, argv: readonly string[]): string {
  const result = spawnSync("git", [...argv], { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${argv.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "harness-worktree-commit-"));
  roots.push(dir);
  git(dir, ["init", "--quiet", "--initial-branch", "main"]);
  git(dir, ["config", "user.email", "harness@example.test"]);
  git(dir, ["config", "user.name", "Harness Test"]);
  await writeFile(join(dir, "seed.txt"), "seed\n");
  git(dir, ["add", "seed.txt"]);
  git(dir, ["commit", "--quiet", "-m", "base"]);
  return dir;
}

describe("commitSubphase", () => {
  test("stages the write scope and commits with a conventional subject", async () => {
    const dir = await repo();
    await mkdir(join(dir, "src", "one"), { recursive: true });
    await writeFile(join(dir, "src", "one", "a.ts"), "export const a = 1;\n");
    const outcome = commitSubphase({
      taskId: "task-1",
      worktreeId: "wt-0",
      worktreePath: dir,
      writeScope: ["src/one"],
      label: "Database schema",
      commitType: "feat",
      maxCommitLines: 500,
    });
    expect(outcome.committed).toBe(true);
    expect(outcome.commit?.subject).toBe("feat: Database schema");
    expect(outcome.commit?.over_limit).toBe(false);
    expect(outcome.commit?.changed_lines).toBeGreaterThan(0);
    expect(outcome.warning).toBeUndefined();
    const log = git(dir, ["log", "-1", "--format=%s"]).trim();
    expect(log).toBe("feat: Database schema");
  });

  test("is a no-op when the task's write scope has no changes to stage", async () => {
    const dir = await repo();
    const outcome = commitSubphase({
      taskId: "task-1",
      worktreeId: "wt-0",
      worktreePath: dir,
      writeScope: ["src/nonexistent"],
      label: "Nothing to do",
      commitType: "chore",
      maxCommitLines: 500,
    });
    expect(outcome).toEqual({ committed: false });
  });

  test("flags a commit over max_commit_lines as a warning, never a refusal", async () => {
    const dir = await repo();
    await mkdir(join(dir, "src"), { recursive: true });
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    await writeFile(join(dir, "src", "big.txt"), `${lines}\n`);
    const outcome = commitSubphase({
      taskId: "task-2",
      worktreeId: "wt-0",
      worktreePath: dir,
      writeScope: ["src"],
      label: "Big change",
      commitType: "chore",
      maxCommitLines: 5,
    });
    expect(outcome.committed).toBe(true);
    expect(outcome.commit?.over_limit).toBe(true);
    expect(outcome.warning).toMatch(/over the 5-line target/);
  });

  test("rejects a commit type outside the approved Conventional Commits tag list", async () => {
    const dir = await repo();
    expect(() =>
      commitSubphase({
        taskId: "task-1",
        worktreeId: "wt-0",
        worktreePath: dir,
        writeScope: ["src"],
        label: "x",
        commitType: "wip",
        maxCommitLines: 500,
      }),
    ).toThrow(/not a recognised tag/);
  });

  test("truncates an over-length label so the subject still fits under 70 characters", async () => {
    const dir = await repo();
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "c.ts"), "export const c = 1;\n");
    const longLabel = "A".repeat(120);
    const outcome = commitSubphase({
      taskId: "task-3",
      worktreeId: "wt-0",
      worktreePath: dir,
      writeScope: ["src"],
      label: longLabel,
      commitType: "chore",
      maxCommitLines: 500,
    });
    expect(outcome.commit?.subject.length).toBeLessThanOrEqual(70);
    expect(outcome.commit?.subject.startsWith("chore: ")).toBe(true);
  });
});
