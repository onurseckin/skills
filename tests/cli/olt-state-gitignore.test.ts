import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ensureHarnessIgnored } from "../../olt/scripts/src/cli/git-ignore.ts";

// Defect 142: `.olt/capsules` survives `git clean -fd` only because it is gitignored. The rest of
// the `.olt` runtime state (policy, memory, backlog, defect ledgers, auditor cursors, ...) was not
// covered by `ensureHarnessIgnored`, so a routine `git clean -fd` in a project repo would destroy
// all of it while leaving the capsules intact. These tests exercise the real `git` binary against
// real scratch worktrees (never mocked) because the defect is a real-`git-check-ignore` fact, not
// something a stubbed `RepositoryGitCommand` can discriminate.

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function initRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "olt-state-gitignore-"));
  roots.push(repo);
  const init = spawnSync("git", ["init", "-q"], { cwd: repo });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr?.toString("utf8")}`);
  return repo;
}

// A representative project starting state: the capsule directory is gitignored (satisfying the
// existing, unchanged assertion) but nothing else under `.olt/` is mentioned at all. This is the
// exact shape defect 142 describes.
function writeCapsulesOnlyGitignore(repo: string): void {
  writeFileSync(join(repo, ".gitignore"), ".olt/capsules/\n");
}

function isGitIgnored(repo: string, relativePath: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--quiet", relativePath], { cwd: repo });
  return result.status === 0;
}

describe("ensureHarnessIgnored / .olt runtime state protection (defect 142)", () => {
  test("protects the whole .olt runtime state, not an enumerated file list", () => {
    const repo = initRepo();
    writeCapsulesOnlyGitignore(repo);

    // A filename that appears nowhere in the source under test, generated fresh per run. Any fix
    // that only special-cases a fixed list of known runtime filenames (policy.json, memory.json,
    // ...) cannot pass this: this path is not, and never will be, in such a list.
    const syntheticRuntimeFile = `.olt/${randomUUID()}.json`;

    expect(isGitIgnored(repo, syntheticRuntimeFile)).toBe(false);

    expect(ensureHarnessIgnored(repo)).toBe("gitignored");

    expect(isGitIgnored(repo, syntheticRuntimeFile)).toBe(true);
    // The pre-existing capsule assertion this defect must not regress.
    expect(isGitIgnored(repo, ".olt/capsules/probe")).toBe(true);
  });

  test("is idempotent across repeated calls", () => {
    const repo = initRepo();
    writeCapsulesOnlyGitignore(repo);

    ensureHarnessIgnored(repo);
    const excludePath = join(repo, ".git", "info", "exclude");
    const afterFirst = readFileSync(excludePath, "utf8");

    ensureHarnessIgnored(repo);
    const afterSecond = readFileSync(excludePath, "utf8");

    expect(afterSecond).toBe(afterFirst);
  });

  test("never touches the repository's own tracked .gitignore", () => {
    const repo = initRepo();
    writeCapsulesOnlyGitignore(repo);
    const before = readFileSync(join(repo, ".gitignore"), "utf8");

    ensureHarnessIgnored(repo);

    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe(before);
  });

  test("respects a project's own deliberate decision to track .olt content", () => {
    // Mirrors this very skill repository's own `.gitignore`, which negates `.olt/` and tracks
    // most of it deliberately. The protection added here is local, untracked git plumbing
    // (`.git/info/exclude`) and must never silently override that project-level policy decision.
    const repo = initRepo();
    writeFileSync(join(repo, ".gitignore"), "!.olt/\n.olt/capsules/\n");

    ensureHarnessIgnored(repo);

    expect(isGitIgnored(repo, ".olt/policy.json")).toBe(false);
    expect(isGitIgnored(repo, ".olt/capsules/probe")).toBe(true);
  });

  test("leaves non-git-worktree repos untouched", () => {
    const repo = mkdtempSync(join(tmpdir(), "olt-state-gitignore-no-git-"));
    roots.push(repo);

    expect(ensureHarnessIgnored(repo)).toBe("not-a-git-worktree");
  });
});
