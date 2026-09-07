import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { safeRepoPath } from "../../../olt/scripts/src/core/paths.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const pathsSuiteName = "core paths & safeRepoPath safety invariants";

describe(pathsSuiteName, () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let dirCounter = 0;

  function makeVirtualDir(prefix: string): string {
    const dir = `/tmp/virtual/paths-${prefix}-${++dirCounter}`;
    vfs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  test("safeRepoPath validates repository directory existence and rejects invalid roots", () => {
    const root = makeVirtualDir("validation");

    const nonExistent = join(root, "missing-dir");
    expect(() => safeRepoPath(nonExistent, "file.txt")).toThrow(/not a directory/i);

    const fileAsRoot = join(root, "plain-file.txt");
    vfs.writeFileSync(fileAsRoot, "content");
    expect(() => safeRepoPath(fileAsRoot, "file.txt")).toThrow(/not a directory/i);
  });

  test("safeRepoPath rejects absolute paths and parent traversal", () => {
    const repo = makeVirtualDir("traversal-repo");

    expect(() => safeRepoPath(repo, "/absolute/path/file.txt")).toThrow(
      /absolute paths are not allowed/i,
    );
    expect(() => safeRepoPath(repo, "../outside.txt")).toThrow(/parent traversal is not allowed/i);
    expect(() => safeRepoPath(repo, "sub/../../escape.txt")).toThrow(
      /parent traversal is not allowed/i,
    );
  });

  test("safeRepoPath rejects escaping paths and empty/root-resolving paths", () => {
    const repo = makeVirtualDir("escape-repo");

    expect(() => safeRepoPath(repo, "")).toThrow();
    expect(() => safeRepoPath(repo, ".")).toThrow();
    expect(() => safeRepoPath(repo, "./")).toThrow();
  });

  test("safeRepoPath rejects symbolic links inside path hierarchy", () => {
    const repo = makeVirtualDir("symlink-repo");
    const outside = makeVirtualDir("outside-target");

    session.symlinkSync(outside, join(repo, "sym-link-dir"));
    expect(() => safeRepoPath(repo, "sym-link-dir/file.txt")).toThrow(
      /symbolic path components are not allowed/i,
    );
  });

  test("safeRepoPath allows valid relative sub-paths and handles non-existent leaf files cleanly", () => {
    const repo = makeVirtualDir("valid-repo");
    vfs.mkdirSync(join(repo, "src", "nested"), { recursive: true });
    vfs.writeFileSync(join(repo, "src", "nested", "index.ts"), "export {}");

    const resolved = safeRepoPath(repo, "src/nested/index.ts");
    expect(resolved).toBe(join(repo, "src", "nested", "index.ts"));

    const futureLeaf = safeRepoPath(repo, "src/nested/future.ts");
    expect(futureLeaf).toBe(join(repo, "src", "nested", "future.ts"));
  });
});
