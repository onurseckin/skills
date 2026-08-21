import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  repositoryGit,
  repositoryWorktree,
  type RepositoryGitCommand,
} from "../../../orchestrating-long-tasks/scripts/src/packets/repository-git-command.ts";
import { inspectRepositoryGitIdentity } from "../../../orchestrating-long-tasks/scripts/src/packets/repository-git-identity.ts";

// tests/unit/packets/repository-snapshot.test.ts's "inspects real git repository" threw
// "repository Git worktree probe returned invalid output" under real concurrent-agent load: an
// accepted `git rev-parse --is-inside-work-tree` exit status paired with empty stdout, which is
// never a legitimate answer for that command. commandOutputRetryingEmpty
// (repository-git-command.ts) now absorbs that; these prove it for both call sites that use it.

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
  const root = mkdtempSync(join(tmpdir(), "repository-git-empty-output-retry-"));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, ["init", "-q"]);
  writeFileSync(join(repo, "tracked.txt"), "tracked\n");
  git(repo, ["add", "tracked.txt"]);
  git(repo, ["commit", "-qm", "test: seed"]);
  // Every real caller canonicalizes first (repository-identity.ts:13), matching what git itself
  // reports back for --absolute-git-dir and friends.
  return realpathSync(repo);
}

/** Forces the first `emptyTimes` calls whose argv matches to return accepted-but-empty. */
function flakyCommand(
  match: (argv: string[]) => boolean,
  emptyTimes: number,
): { command: RepositoryGitCommand; matchedCalls: () => number } {
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

const isWorktreeProbe = (argv: string[]) => argv.includes("--is-inside-work-tree");
const isHeadVerify = (argv: string[]) => argv.includes("--verify") && argv.includes("HEAD");

describe("repositoryWorktree absorbs a transient accepted-but-empty probe", () => {
  test("recovers when the probe is empty fewer times than the retry budget", () => {
    const repo = fixture();
    const { command, matchedCalls } = flakyCommand(isWorktreeProbe, 2);

    expect(repositoryWorktree(repo, command)).toBe(true);
    expect(matchedCalls()).toBe(3); // 2 empty + the succeeding retry
  });

  test("still throws once the probe stays empty past the retry budget", () => {
    const repo = fixture();
    const { command, matchedCalls } = flakyCommand(isWorktreeProbe, 100);

    expect(() => repositoryWorktree(repo, command)).toThrow(
      /Git worktree probe returned invalid output/,
    );
    expect(matchedCalls()).toBe(4); // one initial call plus three bounded retries, never more
  });
});

describe("inspectRepositoryGitIdentity's HEAD probes absorb the same hazard", () => {
  test("recovers when rev-parse --verify HEAD is empty fewer times than the retry budget", () => {
    const repo = fixture();
    const { command, matchedCalls } = flakyCommand(isHeadVerify, 2);

    const identity = inspectRepositoryGitIdentity(repo, 1_048_576, 1_048_576, 1_048_576, {
      command,
    });

    expect(identity.head_oid).toMatch(/^[0-9a-f]{40}$/);
    expect(matchedCalls()).toBe(3);
  });

  test("throws rather than reporting a fabricated null once retries are exhausted", () => {
    const repo = fixture();
    const { command, matchedCalls } = flakyCommand(isHeadVerify, 100);

    expect(() =>
      inspectRepositoryGitIdentity(repo, 1_048_576, 1_048_576, 1_048_576, { command }),
    ).toThrow(/Git ref probe returned an accepted status with no output/);
    expect(matchedCalls()).toBe(4);
  });

  test("a genuinely detached HEAD's empty symbolic-ref (status 1) is never retried", () => {
    const repo = fixture();
    let calls = 0;
    const command: RepositoryGitCommand = (r, argv, maximum, accepted) => {
      if (argv.includes("symbolic-ref")) {
        calls += 1;
        return { status: 1, bytes: Buffer.alloc(0) };
      }
      return repositoryGit(r, argv, maximum, accepted);
    };

    const identity = inspectRepositoryGitIdentity(repo, 1_048_576, 1_048_576, 1_048_576, {
      command,
    });

    expect(identity.head_ref).toBeNull();
    expect(calls).toBe(1); // a real "doesn't apply" answer is never mistaken for the empty-output hazard
  });
});
