import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRepositoryGitControls } from "../../orchestrating-long-tasks/scripts/src/packets/repository-git-controls.ts";
import {
  repositoryGit,
  type RepositoryGitCommand,
} from "../../orchestrating-long-tasks/scripts/src/packets/repository-git-command.ts";

// Two real runs (tests/unit/branch/completion.test.ts's "stops blocking once the branch is
// collected" and tests/unit/reporting/handoff-triggers.test.ts's "sealing the run rewrites it
// against the completed state") threw "repository Git directory path is invalid" and "repository
// worktree config path is invalid" under real concurrent-agent load: an accepted git exit status
// paired with empty stdout, for commands that never legitimately print nothing on success. These
// prove repository-git-controls.ts now absorbs that shape without masking a genuinely broken repo.

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(repo: string, args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", repo, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Harness Test",
      GIT_AUTHOR_EMAIL: "harness@example.invalid",
      GIT_COMMITTER_NAME: "Harness Test",
      GIT_COMMITTER_EMAIL: "harness@example.invalid",
    },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "repository-git-controls-retry-"));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, ["init", "-q"]);
  writeFileSync(join(repo, "tracked.txt"), "tracked\n");
  git(repo, ["add", "tracked.txt"]);
  git(repo, ["commit", "-qm", "test: seed"]);
  // Every real caller canonicalizes first (repository-identity.ts:13) before this function ever
  // sees `repo` — git itself always reports canonical paths, so an uncanonicalized `repo` here
  // would fail the worktree-config comparison on any host where the tmp dir traverses a symlink
  // (e.g. macOS's /var -> /private/var), for reasons unrelated to what this file tests.
  return realpathSync(repo);
}

/** Forces the first `emptyTimes` calls whose argv matches `needle` to return accepted-but-empty. */
function flakyCommand(
  match: (argv: string[]) => boolean,
  emptyTimes: number,
): {
  command: RepositoryGitCommand;
  matchedCalls: () => number;
} {
  let matched = 0;
  const command: RepositoryGitCommand = (repo, argv, maximum, accepted) => {
    if (match(argv)) {
      matched += 1;
      if (matched <= emptyTimes) return { status: 0, bytes: Buffer.alloc(0) };
    }
    return repositoryGit(repo, argv, maximum, accepted);
  };
  return { command, matchedCalls: () => matched };
}

const isAbsoluteGitDir = (argv: string[]) => argv.includes("--absolute-git-dir");
const isWorktreeConfig = (argv: string[]) => argv.includes("config.worktree");

describe("inspectRepositoryGitControls absorbs a transient accepted-but-empty rev-parse", () => {
  test("recovers when --absolute-git-dir is empty fewer times than the retry budget", () => {
    const repo = fixture();
    const { command, matchedCalls } = flakyCommand(isAbsoluteGitDir, 2);

    const result = inspectRepositoryGitControls(repo, command, 64 * 1024 * 1024, 256 * 1024 * 1024);

    expect(result.bytes).toBeGreaterThan(0);
    expect(matchedCalls()).toBe(3); // 2 empty + the succeeding retry
  });

  test("still throws once --absolute-git-dir stays empty past the retry budget", () => {
    const repo = fixture();
    const { command, matchedCalls } = flakyCommand(isAbsoluteGitDir, 100);

    expect(() =>
      inspectRepositoryGitControls(repo, command, 64 * 1024 * 1024, 256 * 1024 * 1024),
    ).toThrow(/repository Git directory path is invalid/);
    expect(matchedCalls()).toBe(4); // one initial call plus three bounded retries, never more
  });

  test("recovers when config.worktree is empty fewer times than the retry budget", () => {
    const repo = fixture();
    const { command, matchedCalls } = flakyCommand(isWorktreeConfig, 2);

    const result = inspectRepositoryGitControls(repo, command, 64 * 1024 * 1024, 256 * 1024 * 1024);

    expect(result.bytes).toBeGreaterThan(0);
    expect(matchedCalls()).toBe(3);
  });

  test("still throws once config.worktree stays empty past the retry budget", () => {
    const repo = fixture();
    const { command, matchedCalls } = flakyCommand(isWorktreeConfig, 100);

    expect(() =>
      inspectRepositoryGitControls(repo, command, 64 * 1024 * 1024, 256 * 1024 * 1024),
    ).toThrow(/repository worktree config path is invalid/);
    expect(matchedCalls()).toBe(4);
  });
});
