import { describe, expect, test, afterAll } from "bun:test";
import { chmodSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { safeRepoPath } from "../../olt/scripts/src/core/paths.ts";

describe("core paths & safeRepoPath safety invariants", () => {
  const scratchBase = join(process.cwd(), "coverage", "scratch", "safe-repo-paths-test");

  afterAll(() => {
    rmSync(scratchBase, { recursive: true, force: true });
  });

  test("safeRepoPath validates repository directory existence and rejects invalid roots", () => {
    const root = join(scratchBase, "validation");
    mkdirSync(root, { recursive: true });

    const nonExistent = join(root, "missing-dir");
    expect(() => safeRepoPath(nonExistent, "file.txt")).toThrow(/not a directory/i);

    const fileAsRoot = join(root, "plain-file.txt");
    writeFileSync(fileAsRoot, "content", "utf-8");
    expect(() => safeRepoPath(fileAsRoot, "file.txt")).toThrow(/not a directory/i);

    rmSync(root, { recursive: true, force: true });
  });

  test("safeRepoPath rejects absolute paths and parent traversal", () => {
    const repo = join(scratchBase, "traversal-repo");
    mkdirSync(repo, { recursive: true });

    expect(() => safeRepoPath(repo, "/absolute/path/file.txt")).toThrow(
      /absolute paths are not allowed/i,
    );
    expect(() => safeRepoPath(repo, "../outside.txt")).toThrow(/parent traversal is not allowed/i);
    expect(() => safeRepoPath(repo, "sub/../../escape.txt")).toThrow(
      /parent traversal is not allowed/i,
    );

    rmSync(repo, { recursive: true, force: true });
  });

  test("safeRepoPath rejects escaping paths and empty/root-resolving paths", () => {
    const repo = join(scratchBase, "escape-repo");
    mkdirSync(repo, { recursive: true });

    expect(() => safeRepoPath(repo, "")).toThrow();
    expect(() => safeRepoPath(repo, ".")).toThrow();
    expect(() => safeRepoPath(repo, "./")).toThrow();

    rmSync(repo, { recursive: true, force: true });
  });

  test("safeRepoPath rejects symbolic links inside path hierarchy", () => {
    const repo = join(scratchBase, "symlink-repo");
    const outside = join(scratchBase, "outside-target");
    mkdirSync(repo, { recursive: true });
    mkdirSync(outside, { recursive: true });

    symlinkSync(outside, join(repo, "sym-link-dir"));
    expect(() => safeRepoPath(repo, "sym-link-dir/file.txt")).toThrow(
      /symbolic path components are not allowed/i,
    );

    rmSync(repo, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  test("safeRepoPath allows valid relative sub-paths and handles non-existent leaf files cleanly", () => {
    const repo = join(scratchBase, "valid-repo");
    mkdirSync(join(repo, "src", "nested"), { recursive: true });
    writeFileSync(join(repo, "src", "nested", "index.ts"), "export {}", "utf-8");

    const resolved = safeRepoPath(repo, "src/nested/index.ts");
    expect(resolved).toBe(join(realpathSync(repo), "src/nested/index.ts"));

    // Future/non-existent leaf in valid directory
    const futureLeaf = safeRepoPath(repo, "src/nested/future.ts");
    expect(futureLeaf).toBe(join(realpathSync(repo), "src/nested/future.ts"));

    rmSync(repo, { recursive: true, force: true });
  });
});
