import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRepository } from "../../olt/scripts/src/packets/repository-snapshot.ts";
import { inspectRepositoryBinding } from "../../olt/scripts/src/packets/repository-identity.ts";
import {
  createRepositoryGitCommand,
  type RepositoryGitCommand,
} from "../../olt/scripts/src/packets/repository-git-command.ts";

describe("repository-snapshot", () => {
  test("inspects a non-git directory with instructions and conventions", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "repo-snap-")));
    writeFileSync(join(repo, "AGENTS.md"), "# Agents");
    writeFileSync(join(repo, "GEMINI.md"), "# Gemini");
    writeFileSync(join(repo, "package.json"), "{}");
    writeFileSync(join(repo, "tsconfig.json"), "{}");
    writeFileSync(join(repo, "Cargo.toml"), "");

    // Nested directory
    const nested = join(repo, "src", "deep");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "prettier.config.js"), "module.exports = {};");

    // Add ignored directory and symlink
    const ignoredDir = join(repo, "node_modules");
    mkdirSync(ignoredDir);
    writeFileSync(join(ignoredDir, "package.json"), "{}");
    symlinkSync(join(repo, "package.json"), join(repo, "symlink.json"));

    const snapshot = inspectRepository(repo, "baseline", new Date("2026-08-14T00:00:00.000Z"));
    expect(snapshot.git.available).toBe(false);
    expect(snapshot.instruction_files.length).toBe(2);
    expect(snapshot.instruction_files[0].path).toBe("AGENTS.md");
    expect(snapshot.convention_files.length).toBe(4);
    expect(snapshot.tool_versions.git).toBe("unavailable");
  });

  test("excludes .olt capsule state from the walk, including vendored instruction/convention copies", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "repo-snap-olt-")));
    writeFileSync(join(repo, "CLAUDE.md"), "# Root instructions");
    writeFileSync(join(repo, "package.json"), "{}");

    const vendored = join(repo, ".olt", "capsules", "run-1", "runtime", "src");
    mkdirSync(vendored, { recursive: true });
    writeFileSync(join(vendored, "CLAUDE.md"), "# Vendored capsule copy");
    writeFileSync(join(vendored, "package.json"), "{}");

    const snapshot = inspectRepository(repo, "baseline", new Date("2026-08-14T00:00:00.000Z"));
    expect(snapshot.instruction_files).toEqual([expect.objectContaining({ path: "CLAUDE.md" })]);
    expect(snapshot.convention_files).toEqual([expect.objectContaining({ path: "package.json" })]);
  });

  test("rejects when repo root is not a directory", () => {
    const tempDir = realpathSync(mkdtempSync(join(tmpdir(), "repo-snap-")));
    const filePath = join(tempDir, "file.txt");
    writeFileSync(filePath, "content");

    expect(() =>
      inspectRepository(filePath, "baseline", new Date("2026-08-14T00:00:00.000Z")),
    ).toThrow("repository root is not a directory");
  });

  test("rejects a directory whose entry count exceeds an injected traversal ceiling", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "repo-snap-limit-")));
    writeFileSync(join(repo, "a.txt"), "a");
    writeFileSync(join(repo, "b.txt"), "b");
    writeFileSync(join(repo, "c.txt"), "c");

    expect(() =>
      inspectRepository(repo, "baseline", new Date("2026-08-14T00:00:00.000Z"), {
        maxDirectoryEntries: 2,
      }),
    ).toThrow("repository inspection file limit exceeded");
  });

  test("inspects real git repository", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "repo-snap-git-")));
    // inspectRepositoryBinding() (called unconditionally inside inspectRepository) does its own
    // real Git identity/control/content-listing inspection with no dependency injection reaching
    // it from here — repository-content-paths.ts's gitRepository() helper even hardcodes the real
    // `repositoryGit` command directly, with no override parameter at all. A genuine `.git`
    // directory from `git init` is therefore the only way to reach the git-available branch. The
    // command fake below covers every probe this module's own `run()` helper issues
    // (status/head/branch/log/version), so no further real Git process runs beyond that one init.
    Bun.spawnSync(["git", "init", "-q", repo]);
    const head = "a".repeat(40);
    const command: RepositoryGitCommand = (_repo, argv) => {
      const bytes = (text: string) => Buffer.from(text);
      switch (argv[0]) {
        case "status":
          return { status: 0, bytes: bytes("# branch.oid " + head + "\n") };
        case "rev-parse":
          return { status: 0, bytes: bytes(head + "\n") };
        case "branch":
          return { status: 0, bytes: bytes("main\n") };
        case "log":
          return { status: 0, bytes: bytes("abc1234 init\n") };
        case "--version":
          return { status: 0, bytes: bytes("git version 2.42.0\n") };
        default:
          throw new Error(`unexpected git invocation: ${argv.join(" ")}`);
      }
    };

    const snapshot = inspectRepository(repo, "current", new Date("2026-08-14T00:00:00.000Z"), {
      command,
    });
    expect(snapshot.git.available).toBe(true);
    if (snapshot.git.available) {
      expect(snapshot.git.head).toMatch(/^[0-9a-f]{40}$/);
      expect(snapshot.git.recent_commits.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("inspectRepositoryBinding retries and throws INTEGRITY if git identity continuously changes", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "repo-snap-drift-")));
    Bun.spawnSync(["git", "init", "-q", repo]);

    let counter = 0;
    const realGit = createRepositoryGitCommand();
    const driftingCommand: RepositoryGitCommand = (r, argv, max, accepted) => {
      if (argv[0] === "status") {
        counter += 1;
        return {
          status: 0,
          bytes: Buffer.from(`# branch.oid 000000000000000000000000000000000000000${counter}\n`),
        };
      }
      return realGit(r, argv, max, accepted);
    };

    expect(() => inspectRepositoryBinding(repo, {}, { command: driftingCommand })).toThrow(
      "repository Git identity changed during scan",
    );
  });
});
