import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRepositoryBinding } from "../../orchestrating-long-tasks/scripts/src/packets/repository-identity.ts";
import {
  repositoryGit,
  type RepositoryGitCommand,
} from "../../orchestrating-long-tasks/scripts/src/packets/repository-git-command.ts";

// tests/unit/branch/depth.test.ts's "trips the depth escalation threshold at the sixth level"
// threw "repository Git identity changed during scan" under real concurrent-agent load, with no
// write anywhere between the two identity reads (the scan is read-only). These prove the
// settle-retry added to inspectRepositoryBinding absorbs a transient before/after flap on a real
// repository without masking a persistent difference.

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
  const root = mkdtempSync(join(tmpdir(), "repository-identity-settle-"));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, ["init", "-q"]);
  writeFileSync(join(repo, "tracked.txt"), "tracked\n");
  git(repo, ["add", "tracked.txt"]);
  git(repo, ["commit", "-qm", "test: seed"]);
  return realpathSync(repo);
}

/** Forces the first `flapTimes` HEAD-verify reads after the very first to answer with a decoy SHA. */
function flappingHeadCommand(flapTimes: number): {
  command: RepositoryGitCommand;
  matchedCalls: () => number;
} {
  let matched = 0;
  const command: RepositoryGitCommand = (repo, argv, maximum, accepted) => {
    if (argv.includes("--verify") && argv.includes("HEAD")) {
      matched += 1;
      // Call 1 establishes "before"; only the reads after it are the flaky ones under test.
      if (matched > 1 && matched <= 1 + flapTimes) {
        return { status: 0, bytes: Buffer.from(`${"f".repeat(40)}\n`) };
      }
    }
    return repositoryGit(repo, argv, maximum, accepted);
  };
  return { command, matchedCalls: () => matched };
}

describe("inspectRepositoryBinding settles a transiently flapping Git identity", () => {
  test("recovers when the re-read disagrees fewer times than the retry budget", () => {
    const repo = fixture();
    const { command, matchedCalls } = flappingHeadCommand(2);

    const binding = inspectRepositoryBinding(repo, {}, { command });

    expect(binding.git_identity_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(matchedCalls()).toBe(4); // before + 2 flapped after-reads + the settling read
  });

  test("still throws once the identity disagrees past the retry budget", () => {
    const repo = fixture();
    const { command, matchedCalls } = flappingHeadCommand(100);

    expect(() => inspectRepositoryBinding(repo, {}, { command })).toThrow(
      /repository Git identity changed during scan/,
    );
    expect(matchedCalls()).toBe(5); // before + 3 bounded retries of after, never more
  });

  test("a HEAD that genuinely moved between reads is still reported", () => {
    const repo = fixture();
    writeFileSync(join(repo, "second.txt"), "second\n");
    git(repo, ["add", "second.txt"]);
    let calls = 0;
    const command: RepositoryGitCommand = (r, argv, maximum, accepted) => {
      if (argv.includes("--verify") && argv.includes("HEAD")) {
        calls += 1;
        // The very first read observes the pristine HEAD; commit a real new one right after —
        // every subsequent read genuinely differs and never coincidentally settles back.
        if (calls === 1) {
          git(r, ["commit", "-qm", "moved during the scan"]);
        }
      }
      return repositoryGit(r, argv, maximum, accepted);
    };

    expect(() => inspectRepositoryBinding(repo, {}, { command })).toThrow(
      /repository Git identity changed during scan/,
    );
  });
});
