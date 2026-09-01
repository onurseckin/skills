import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { safeRepoPath } from "../../../olt/scripts/src/core/paths.ts";
import {
  cleanupVirtualBrowserFS,
  setupVirtualBrowserFS,
  tempDir,
} from "../../reporting/browser/browser-virtual-fs.ts";

export const pathsSuiteName = "core paths & safeRepoPath safety invariants";

describe(pathsSuiteName, () => {
  beforeEach(() => {
    setupVirtualBrowserFS();
  });

  afterEach(() => {
    cleanupVirtualBrowserFS();
  });

  test("safeRepoPath validates repository directory existence and rejects invalid roots", () => {
    const root = tempDir("validation");

    const nonExistent = join(root, "missing-dir");
    expect(() => safeRepoPath(nonExistent, "file.txt")).toThrow(/not a directory/i);

    const fileAsRoot = join(root, "plain-file.txt");
    fs.writeFileSync(fileAsRoot, "content", "utf-8");
    expect(() => safeRepoPath(fileAsRoot, "file.txt")).toThrow(/not a directory/i);
  });

  test("safeRepoPath rejects absolute paths and parent traversal", () => {
    const repo = tempDir("traversal-repo");

    expect(() => safeRepoPath(repo, "/absolute/path/file.txt")).toThrow(
      /absolute paths are not allowed/i,
    );
    expect(() => safeRepoPath(repo, "../outside.txt")).toThrow(/parent traversal is not allowed/i);
    expect(() => safeRepoPath(repo, "sub/../../escape.txt")).toThrow(
      /parent traversal is not allowed/i,
    );
  });

  test("safeRepoPath rejects escaping paths and empty/root-resolving paths", () => {
    const repo = tempDir("escape-repo");

    expect(() => safeRepoPath(repo, "")).toThrow();
    expect(() => safeRepoPath(repo, ".")).toThrow();
    expect(() => safeRepoPath(repo, "./")).toThrow();
  });

  test("safeRepoPath rejects symbolic links inside path hierarchy", () => {
    const repo = tempDir("symlink-repo");
    const outside = tempDir("outside-target");

    fs.symlinkSync(outside, join(repo, "sym-link-dir"));
    expect(() => safeRepoPath(repo, "sym-link-dir/file.txt")).toThrow(
      /symbolic path components are not allowed/i,
    );
  });

  test("safeRepoPath allows valid relative sub-paths and handles non-existent leaf files cleanly", () => {
    const repo = tempDir("valid-repo");
    fs.mkdirSync(join(repo, "src", "nested"), { recursive: true });
    fs.writeFileSync(join(repo, "src", "nested", "index.ts"), "export {}", "utf-8");

    const resolved = safeRepoPath(repo, "src/nested/index.ts");
    expect(resolved).toBe(join(fs.realpathSync(repo), "src/nested/index.ts"));

    // Future/non-existent leaf in valid directory
    const futureLeaf = safeRepoPath(repo, "src/nested/future.ts");
    expect(futureLeaf).toBe(join(fs.realpathSync(repo), "src/nested/future.ts"));
  });
});
