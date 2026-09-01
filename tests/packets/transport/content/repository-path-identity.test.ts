import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  captureRepositoryLeaf,
  verifyRepositoryAncestors,
} from "../../../../olt/scripts/src/packets/repository-path-identity.ts";
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

describe("repository-path-identity", () => {
  test("captures and verifies valid nested ancestors", () => {
    const repo = createRepo("path-id-");
    const sub = join(repo, "src", "nested");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "file.txt"), "content");

    const leaf = captureRepositoryLeaf(repo, "src/nested/file.txt");
    expect(leaf.path).toBe(join(sub, "file.txt"));
    expect(leaf.ancestors.length).toBe(2);

    expect(() => verifyRepositoryAncestors(leaf, "src/nested/file.txt")).not.toThrow();
  });

  test("rejects unsafe and escaping paths", () => {
    const repo = createRepo("path-id-");

    expect(() => captureRepositoryLeaf(repo, "")).toThrow("unsafe path");
    expect(() => captureRepositoryLeaf(repo, "/absolute/path")).toThrow("unsafe path");
    expect(() => captureRepositoryLeaf(repo, "src/../escape")).toThrow("unsafe path");
  });

  test("rejects symbolic and non-directory ancestors", () => {
    const repo = createRepo("path-id-");
    const targetDir = createRepo("target-dir-");
    symlinkSync(targetDir, join(repo, "symdir"));

    expect(() => captureRepositoryLeaf(repo, "symdir/file.txt")).toThrow(
      "repository path has symbolic ancestor",
    );

    writeFileSync(join(repo, "notadir"), "content");
    expect(() => captureRepositoryLeaf(repo, "notadir/file.txt")).toThrow(
      "repository path ancestor is not a directory",
    );
  });

  test("handles missing ancestors and verifies ancestor stability", () => {
    const repo = createRepo("path-id-");
    const leaf = captureRepositoryLeaf(repo, "missing-dir/sub/file.txt");
    expect(leaf.ancestors.every((a) => "missing" in a)).toBe(true);

    // Still missing -> verifies ok
    expect(() => verifyRepositoryAncestors(leaf, "missing-dir/sub/file.txt")).not.toThrow();

    // Now created -> fails verification because expected missing but observed present
    mkdirSync(join(repo, "missing-dir", "sub"), { recursive: true });
    expect(() => verifyRepositoryAncestors(leaf, "missing-dir/sub/file.txt")).toThrow(
      "repository path ancestor changed",
    );
  });

  test("detects ancestor mode or inode change during verification", () => {
    const repo = createRepo("path-id-");
    const sub = join(repo, "watched");
    mkdirSync(sub);
    const leaf = captureRepositoryLeaf(repo, "watched/file.txt");

    // Change mode of ancestor directory
    chmodSync(sub, 0o700);
    expect(() => verifyRepositoryAncestors(leaf, "watched/file.txt")).toThrow(
      "repository path ancestor changed",
    );
  });
});
