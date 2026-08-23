import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRepositoryGitIdentity } from "../../../olt/scripts/src/packets/repository-git-identity.ts";
import type { RepositoryGitCommand } from "../../../olt/scripts/src/packets/repository-git-command.ts";

function fixtureRepo(prefix: string): { repo: string; gitDir: string } {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const gitDir = join(repo, ".git");
  mkdirSync(gitDir);
  return { repo, gitDir };
}

/** A command mock that answers every rev-parse/ls-files/status/config probe with fixed output. */
function fullCommand(
  gitDir: string,
  overrides: { headOid?: string; headRef?: string } = {},
): RepositoryGitCommand {
  return (_repo, argv) => {
    if (argv[0] === "rev-parse" && argv.includes("--is-inside-work-tree"))
      return { status: 0, bytes: Buffer.from("true\n") };
    if (argv[0] === "rev-parse" && argv.includes("--absolute-git-dir"))
      return { status: 0, bytes: Buffer.from(`${gitDir}\n`) };
    if (argv[0] === "rev-parse" && argv.includes("--git-common-dir"))
      return { status: 0, bytes: Buffer.from(`${gitDir}\n`) };
    if (argv[0] === "rev-parse" && argv.includes("config.worktree"))
      return { status: 0, bytes: Buffer.from(`${join(gitDir, "config.worktree")}\n`) };
    if (argv[0] === "rev-parse" && argv.includes("--verify"))
      return overrides.headOid === undefined
        ? { status: 1, bytes: Buffer.alloc(0) }
        : { status: 0, bytes: Buffer.from(`${overrides.headOid}\n`) };
    if (argv[0] === "symbolic-ref")
      return overrides.headRef === undefined
        ? { status: 1, bytes: Buffer.alloc(0) }
        : { status: 0, bytes: Buffer.from(`${overrides.headRef}\n`) };
    if (argv[0] === "ls-files") return { status: 0, bytes: Buffer.alloc(0) };
    if (argv[0] === "status") return { status: 0, bytes: Buffer.alloc(0) };
    if (argv.includes("--null") || argv.includes("--get-regexp"))
      return { status: 1, bytes: Buffer.alloc(0) };
    throw new Error(`unexpected git invocation in test: ${argv.join(" ")}`);
  };
}

describe("inspectRepositoryGitIdentity", () => {
  test("reports unavailable for a directory with no Git metadata at all", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "git-identity-no-git-")));
    expect(inspectRepositoryGitIdentity(repo)).toEqual({ available: false });
  });

  test("reports unavailable when the .git directory does not mark a real worktree", () => {
    const { repo } = fixtureRepo("git-identity-not-worktree-");
    const command: RepositoryGitCommand = () => ({ status: 0, bytes: Buffer.from("false\n") });
    expect(inspectRepositoryGitIdentity(repo, 1024, 1024 * 1024, 1024 * 1024, { command })).toEqual(
      { available: false },
    );
  });

  test("captures the full identity, with head_oid/head_ref null when HEAD is unborn", () => {
    const { repo, gitDir } = fixtureRepo("git-identity-unborn-");
    const identity = inspectRepositoryGitIdentity(repo, 1024, 1024 * 1024, 1024 * 1024, {
      command: fullCommand(gitDir),
    });
    expect(identity.available).toBe(true);
    expect(identity.head_oid).toBeNull();
    expect(identity.head_ref).toBeNull();
    expect(identity.index).toEqual({ bytes: 0, sha256: expect.any(String) });
    expect(identity.local_controls).toBeDefined();
  });

  test("captures a resolved HEAD commit and branch ref", () => {
    const { repo, gitDir } = fixtureRepo("git-identity-resolved-head-");
    writeFileSync(join(gitDir, "config.worktree"), "");
    const identity = inspectRepositoryGitIdentity(repo, 1024, 1024 * 1024, 1024 * 1024, {
      command: fullCommand(gitDir, { headOid: "a".repeat(40), headRef: "refs/heads/main" }),
    });
    expect(identity.head_oid).toBe("a".repeat(40));
    expect(identity.head_ref).toBe("refs/heads/main");
  });

  test("rejects a ref probe that reports success with no output even after retrying", () => {
    const { repo, gitDir } = fixtureRepo("git-identity-empty-ref-");
    const command: RepositoryGitCommand = (_repo, argv) => {
      if (argv[0] === "rev-parse" && argv.includes("--is-inside-work-tree"))
        return { status: 0, bytes: Buffer.from("true\n") };
      if (argv[0] === "rev-parse" && argv.includes("--absolute-git-dir"))
        return { status: 0, bytes: Buffer.from(`${gitDir}\n`) };
      if (argv[0] === "rev-parse" && argv.includes("--git-common-dir"))
        return { status: 0, bytes: Buffer.from(`${gitDir}\n`) };
      if (argv[0] === "rev-parse" && argv.includes("config.worktree"))
        return { status: 0, bytes: Buffer.from(`${join(gitDir, "config.worktree")}\n`) };
      if (argv[0] === "ls-files") return { status: 0, bytes: Buffer.alloc(0) };
      if (argv[0] === "status") return { status: 0, bytes: Buffer.alloc(0) };
      if (argv.includes("--null") || argv.includes("--get-regexp"))
        return { status: 1, bytes: Buffer.alloc(0) };
      // rev-parse --verify -q HEAD: an "accepted" status with no output is a probe malfunction,
      // not an unborn HEAD (which would report status 1, handled separately above).
      if (argv[0] === "rev-parse" && argv.includes("--verify"))
        return { status: 0, bytes: Buffer.alloc(0) };
      throw new Error(`unexpected git invocation in test: ${argv.join(" ")}`);
    };
    expect(() =>
      inspectRepositoryGitIdentity(repo, 1024, 1024 * 1024, 1024 * 1024, { command }),
    ).toThrow("repository Git ref probe returned an accepted status with no output");
  });
});
