import { afterEach, describe, expect, test } from "bun:test";
import {
  constants,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRepositoryNode } from "../../orchestrating-long-tasks/scripts/src/packets/repository-content-node.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "repository-special-node-"));
  roots.push(root);
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
