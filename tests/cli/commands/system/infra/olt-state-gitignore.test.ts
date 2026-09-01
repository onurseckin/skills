import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ensureHarnessIgnored } from "../../../../../olt/scripts/src/cli/git-ignore.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];

beforeEach(() => {
  setupVirtualCliFS();
});

afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

function initRepo(): string {
  const repo = `/virtual/cli/olt-state-gitignore-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  roots.push(repo);
  mkdirSync(join(repo, ".git", "info"), { recursive: true });
  return repo;
}

function writeCapsulesOnlyGitignore(repo: string): void {
  writeFileSync(join(repo, ".gitignore"), ".olt/capsules/\n");
}

function isGitIgnored(repo: string, relativePath: string): boolean {
  const excludePath = join(repo, ".git", "info", "exclude");
  const gitignorePath = join(repo, ".gitignore");
  const exclude = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
  const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";

  if (gitignore.includes("!.olt/")) {
    if (relativePath === ".olt/policy.json") return false;
  }
  if (gitignore.includes(".olt/capsules/") && relativePath.startsWith(".olt/capsules")) {
    return true;
  }
  if (exclude.includes(".olt/") && relativePath.startsWith(".olt/")) {
    return true;
  }
  return false;
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
    const repo = `/virtual/cli/olt-state-gitignore-no-git-${Date.now()}`;
    mkdirSync(repo, { recursive: true });
    roots.push(repo);

    expect(ensureHarnessIgnored(repo)).toBe("not-a-git-worktree");
  });
});
