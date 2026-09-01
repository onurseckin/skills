import { afterAll, describe, expect, test } from "bun:test";
import { constants, mkdirSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspectRepositoryNode } from "../../../../olt/scripts/src/packets/repository-content-node.ts";
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

function repository(): string {
  const root = `/virtual/repository-special-node-${Math.random().toString(36).slice(2)}`;
  vfs.mkdirSync(root, { recursive: true });
  return root;
}

describe("repository special-file scanning", () => {
  test("rejects a non-regular leaf before the injected open seam", () => {
    const repo = repository();
    mkdirSync(join(repo, "special"));
    let opens = 0;
    const hooks = {
      openFile: () => {
        opens += 1;
        throw new Error("special leaf reached open");
      },
    } as Parameters<typeof inspectRepositoryNode>[3] & {
      openFile: (path: string, flags: number) => number;
    };
    expect(() => inspectRepositoryNode(repo, { path: "special", index: [] }, 1024, hooks)).toThrow(
      "unsupported repository content node type",
    );
    expect(opens).toBe(0);
  });

  test("opens a raced leaf nonblocking and rejects its non-regular descriptor", () => {
    const repo = repository();
    const leaf = join(repo, "leaf");
    writeFileSync(leaf, "regular bytes\n");
    let openedFlags = 0;
    const hooks = {
      beforeLeafOpen: () => {
        unlinkSync(leaf);
        mkdirSync(leaf);
      },
      openFile: (path: string, flags: number) => {
        openedFlags = flags;
        return openSync(path, flags);
      },
    } as Parameters<typeof inspectRepositoryNode>[3] & {
      beforeLeafOpen: () => void;
      openFile: (path: string, flags: number) => number;
    };
    expect(() => inspectRepositoryNode(repo, { path: "leaf", index: [] }, 1024, hooks)).toThrow(
      "repository content scan was unstable",
    );
    expect(openedFlags & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
    expect(openedFlags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
  });
});
