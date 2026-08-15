import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRepository } from "../../../orchestrating-long-tasks/scripts/src/packets/repository-snapshot.ts";

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

  test("rejects when repo root is not a directory", () => {
    const tempDir = realpathSync(mkdtempSync(join(tmpdir(), "repo-snap-")));
    const filePath = join(tempDir, "file.txt");
    writeFileSync(filePath, "content");

    expect(() =>
      inspectRepository(filePath, "baseline", new Date("2026-08-14T00:00:00.000Z")),
    ).toThrow("repository root is not a directory");
  });

  test("inspects real git repository", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "repo-snap-git-")));
    Bun.spawnSync(["git", "init", repo]);
    Bun.spawnSync(["git", "-C", repo, "config", "user.name", "Test"]);
    Bun.spawnSync(["git", "-C", repo, "config", "user.email", "test@example.com"]);

    writeFileSync(join(repo, "file.txt"), "hello");
    Bun.spawnSync(["git", "-C", repo, "add", "file.txt"]);
    Bun.spawnSync(["git", "-C", repo, "commit", "-m", "init"]);

    const snapshot = inspectRepository(repo, "current", new Date("2026-08-14T00:00:00.000Z"));
    expect(snapshot.git.available).toBe(true);
    if (snapshot.git.available) {
      expect(snapshot.git.head).toMatch(/^[0-9a-f]{40}$/);
      expect(snapshot.git.recent_commits.length).toBeGreaterThanOrEqual(1);
    }
  });
});
