import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspectRepository } from "../../../../olt/scripts/src/packets/repository-snapshot.ts";
import { inspectRepositoryBinding } from "../../../../olt/scripts/src/packets/repository-identity.ts";
import {
  validateRepositoryInspectionPair,
  repositoryInspectionContext,
  repositoryInspectionDigest,
} from "../../../../olt/scripts/src/packets/repository-inspection.ts";
import {
  createRepositoryGitCommand,
  type RepositoryGitCommand,
} from "../../../../olt/scripts/src/packets/repository-git-command.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

const vfs = new VirtualMemoryFS();
const session = createVirtualFSSession(vfs);

afterAll(() => {
  session.cleanup();
  vfs.reset();
});

function createRepo(prefix: string): string {
  const repo = `/virtual/${prefix}${Math.random().toString(36).slice(2)}`;
  vfs.mkdirSync(repo, { recursive: true });
  return repo;
}

describe("repository-snapshot", () => {
  test("inspects a non-git directory with instructions and conventions", () => {
    const repo = createRepo("repo-snap-");
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
    const repo = createRepo("repo-snap-olt-");
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
    const tempDir = createRepo("repo-snap-");
    const filePath = join(tempDir, "file.txt");
    writeFileSync(filePath, "content");

    expect(() =>
      inspectRepository(filePath, "baseline", new Date("2026-08-14T00:00:00.000Z")),
    ).toThrow("repository root is not a directory");
  });

  test("rejects a directory whose entry count exceeds an injected traversal ceiling", () => {
    const repo = createRepo("repo-snap-limit-");
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
    const repo = createRepo("repo-snap-git-");
    vfs.mkdirSync(join(repo, ".git"), { recursive: true });
    vfs.writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    vfs.writeFileSync(join(repo, ".git", "config"), "[core]\n\tbare = false\n");
    const head = "a".repeat(40);
    const command: RepositoryGitCommand = (_repo, argv) => {
      const bytes = (text: string) => Buffer.from(text);
      switch (argv[0]) {
        case "status":
          return { status: 0, bytes: bytes("# branch.oid " + head + "\n") };
        case "rev-parse":
          if (argv.includes("--is-inside-work-tree")) return { status: 0, bytes: bytes("true\n") };
          if (argv.includes("config.worktree"))
            return { status: 0, bytes: bytes(`${join(repo, ".git", "config.worktree")}\n`) };
          if (argv.includes("--absolute-git-dir") || argv.includes("--git-common-dir"))
            return { status: 0, bytes: bytes(`${join(repo, ".git")}\n`) };
          if (argv.includes("--show-toplevel")) return { status: 0, bytes: bytes(`${repo}\n`) };
          return { status: 0, bytes: bytes(head + "\n") };
        case "branch":
          return { status: 0, bytes: bytes("main\n") };
        case "log":
          return { status: 0, bytes: bytes("abc1234 init\n") };
        case "--version":
          return { status: 0, bytes: bytes("git version 2.42.0\n") };
        case "config":
          return { status: 1, bytes: Buffer.alloc(0) };
        case "ls-files":
          return { status: 0, bytes: Buffer.alloc(0) };
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
    const repo = createRepo("repo-snap-drift-");
    vfs.mkdirSync(join(repo, ".git"), { recursive: true });
    vfs.writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    vfs.writeFileSync(join(repo, ".git", "config"), "[core]\n\tbare = false\n");

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

  test("validateRepositoryInspectionPair and repositoryInspectionContext reject corrupted inspection fields and mismatched bindings", () => {
    const validBase = {
      schema: "harness.repository-inspection",
      version: 3,
      phase: "baseline",
      captured_at: "2026-08-14T00:00:00.000Z",
      repository_root: "/repo",
      repository_identity_sha256: "a".repeat(64),
      repository_git_identity_sha256: "b".repeat(64),
      repository_content_sha256: "c".repeat(64),
      repository_file_count: 10,
      repository_total_bytes: 1000,
    };
    const validBaseWithDigest = {
      ...validBase,
      inspection_sha256: repositoryInspectionDigest(validBase),
    };

    // Invalid file count (< 0) -> throws INTEGRITY
    expect(() =>
      validateRepositoryInspectionPair({
        baseline_repository_state: { ...validBaseWithDigest, repository_file_count: -1 },
        current_repository_state: validBaseWithDigest,
      }),
    ).toThrow("baseline repository inspection is invalid");

    // Empty repository_root -> throws INTEGRITY
    expect(() =>
      validateRepositoryInspectionPair({
        baseline_repository_state: { ...validBaseWithDigest, repository_root: "" },
        current_repository_state: validBaseWithDigest,
      }),
    ).toThrow("baseline repository inspection is invalid");

    // fromState with mismatched binding
    const mockState = {
      baseline_repository_inspection_sha256: validBaseWithDigest.inspection_sha256,
      repository_inspections: {
        [validBaseWithDigest.inspection_sha256]: validBaseWithDigest,
      },
      baseline_repository_binding: {
        schema: "harness.repository-binding",
        version: 1,
        inspection_sha256: "mismatched",
        git_identity_sha256: "b".repeat(64),
        content_sha256: "c".repeat(64),
        file_count: 10,
        total_bytes: 1000,
      },
    } as unknown as Parameters<typeof repositoryInspectionContext>[0];

    expect(() => repositoryInspectionContext(mockState, false)).toThrow(
      "baseline repository binding differs",
    );
  });
});
