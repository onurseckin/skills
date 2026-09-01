import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { repositoryContentPaths } from "../../../../olt/scripts/src/packets/repository-content-paths.ts";
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

describe("repositoryContentPaths directory traversal limit", () => {
  test("rejects a directory listing that exceeds an injected entry ceiling", () => {
    const repo = createRepo("repo-content-paths-limit-");
    vfs.writeFileSync(join(repo, "a.txt"), "a");
    vfs.writeFileSync(join(repo, "b.txt"), "b");
    vfs.writeFileSync(join(repo, "c.txt"), "c");

    expect(() => repositoryContentPaths(repo, 1024 * 1024, {}, 2)).toThrow(
      "repository content traversal limit exceeded",
    );
  });

  test("accepts the same directory once the ceiling comfortably covers its entries", () => {
    const repo = createRepo("repo-content-paths-limit-ok-");
    vfs.writeFileSync(join(repo, "a.txt"), "a");
    vfs.writeFileSync(join(repo, "b.txt"), "b");

    const paths = repositoryContentPaths(repo, 1024 * 1024, {}, 50_000);
    expect(paths.map((entry) => entry.path).sort()).toEqual(["a.txt", "b.txt"]);
  });
});
