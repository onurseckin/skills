import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRepositoryGitControls } from "../../../olt/scripts/src/packets/repository-git-controls.ts";
import type { RepositoryGitCommand } from "../../../olt/scripts/src/packets/repository-git-command.ts";

/**
 * inspectRepositoryGitControls never spawns git itself — every path it inspects comes back from
 * the injected `command`. These tests build a real (but never-executed-by-git) .git-shaped
 * directory and drive the function purely through that seam, the same way the module is used in
 * production with the real repositoryGit command swapped in.
 */

function fixtureRepo(prefix: string): { repo: string; gitDir: string } {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const gitDir = join(repo, ".git");
  mkdirSync(gitDir);
  return { repo, gitDir };
}

function baseCommand(gitDir: string, commonDir: string): RepositoryGitCommand {
  const worktreeConfig = join(gitDir, "config.worktree");
  return (_repo, argv, _maximum, _accepted) => {
    if (argv[0] === "rev-parse" && argv.includes("--absolute-git-dir"))
      return { status: 0, bytes: Buffer.from(`${gitDir}\n`) };
    if (argv[0] === "rev-parse" && argv.includes("--git-common-dir"))
      return { status: 0, bytes: Buffer.from(`${commonDir}\n`) };
    if (argv[0] === "rev-parse" && argv.includes("config.worktree"))
      return { status: 0, bytes: Buffer.from(`${worktreeConfig}\n`) };
    if (argv.includes("--null")) return { status: 1, bytes: Buffer.alloc(0) }; // no local helpers
    if (argv.includes("--get-regexp")) return { status: 1, bytes: Buffer.alloc(0) }; // no indirection
    throw new Error(`unexpected git invocation in test: ${argv.join(" ")}`);
  };
}

describe("inspectRepositoryGitControls", () => {
  test("digests a minimal control set where every optional file is absent", () => {
    const { repo, gitDir } = fixtureRepo("git-controls-minimal-");
    const manifest = inspectRepositoryGitControls(
      repo,
      baseCommand(gitDir, gitDir),
      1024 * 1024,
      1024 * 1024,
    );
    expect(manifest.bytes).toBeGreaterThan(0);
    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("digests real control files, a separate common dir, and an info directory", () => {
    const { repo, gitDir } = fixtureRepo("git-controls-full-");
    const commonDir = join(repo, ".git-common");
    mkdirSync(commonDir);
    mkdirSync(join(commonDir, "info"));
    writeFileSync(join(commonDir, "info", "attributes"), "* text=auto\n");
    writeFileSync(join(commonDir, "info", "exclude"), "*.log\n");
    writeFileSync(join(commonDir, "config"), "[core]\n\tbare = false\n");
    writeFileSync(join(gitDir, "config.worktree"), "[core]\n\tworktree = true\n");
    writeFileSync(join(gitDir, "commondir"), `${commonDir}\n`);
    writeFileSync(join(gitDir, "gitdir"), `${gitDir}\n`);

    const manifest = inspectRepositoryGitControls(
      repo,
      baseCommand(gitDir, commonDir),
      1024 * 1024,
      1024 * 1024,
    );
    expect(manifest.bytes).toBeGreaterThan(0);
  });

  test("rejects a repository whose common directory info path is a symlink", () => {
    const { repo, gitDir } = fixtureRepo("git-controls-symlinked-info-");
    const commonDir = join(repo, ".git-common");
    mkdirSync(commonDir);
    const realInfo = join(repo, "real-info");
    mkdirSync(realInfo);
    symlinkSync(realInfo, join(commonDir, "info"));

    expect(() =>
      inspectRepositoryGitControls(repo, baseCommand(gitDir, commonDir), 1024 * 1024, 1024 * 1024),
    ).toThrow("repository Git info path is symbolic or invalid");
  });

  test("rejects when the worktree config path git reports does not match its git-dir", () => {
    const { repo, gitDir } = fixtureRepo("git-controls-bad-worktree-config-");
    const command: RepositoryGitCommand = (_repo, argv) => {
      if (argv.includes("--absolute-git-dir"))
        return { status: 0, bytes: Buffer.from(`${gitDir}\n`) };
      if (argv.includes("--git-common-dir"))
        return { status: 0, bytes: Buffer.from(`${gitDir}\n`) };
      if (argv.includes("config.worktree"))
        return { status: 0, bytes: Buffer.from("/somewhere/else/config.worktree\n") };
      return { status: 1, bytes: Buffer.alloc(0) };
    };
    expect(() => inspectRepositoryGitControls(repo, command, 1024 * 1024, 1024 * 1024)).toThrow(
      "repository worktree config path is invalid",
    );
  });

  test("rejects a common config that indirects through include/includeIf", () => {
    const { repo, gitDir } = fixtureRepo("git-controls-indirection-");
    writeFileSync(join(gitDir, "config"), "[include]\n\tpath = other.gitconfig\n");
    const command: RepositoryGitCommand = (_repo, argv) => {
      if (argv.includes("--absolute-git-dir"))
        return { status: 0, bytes: Buffer.from(`${gitDir}\n`) };
      if (argv.includes("--git-common-dir"))
        return { status: 0, bytes: Buffer.from(`${gitDir}\n`) };
      if (argv.includes("config.worktree"))
        return { status: 0, bytes: Buffer.from(`${join(gitDir, "config.worktree")}\n`) };
      if (argv.includes("--null")) return { status: 1, bytes: Buffer.alloc(0) };
      if (argv.includes("--get-regexp")) return { status: 0, bytes: Buffer.from("include.path\n") };
      throw new Error(`unexpected git invocation: ${argv.join(" ")}`);
    };
    expect(() => inspectRepositoryGitControls(repo, command, 1024 * 1024, 1024 * 1024)).toThrow(
      "repository Git config indirection is unsupported",
    );
  });

  test("rejects control files whose combined size exceeds the total byte limit", () => {
    const { repo, gitDir } = fixtureRepo("git-controls-total-limit-");
    writeFileSync(join(gitDir, "config.worktree"), "x".repeat(200));
    expect(() =>
      inspectRepositoryGitControls(repo, baseCommand(gitDir, gitDir), 1024, 100),
    ).toThrow("repository Git controls total byte limit exceeded");
  });
});
