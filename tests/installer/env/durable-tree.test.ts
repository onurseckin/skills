import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { syncTree } from "../../../olt/scripts/src/installer/durable-tree.ts";
import { scratchRoot } from "../../shared/fixtures/scratch-root.ts";
import {
  cleanupVirtualInstallerFS,
  getVirtualInstallerFS,
  handleCreateSymlink,
  registerSpecialFile,
  setupVirtualInstallerFS,
} from "../helpers.ts";

beforeEach(setupVirtualInstallerFS);
afterEach(cleanupVirtualInstallerFS);

describe("syncTree", () => {
  test("fsyncs every file and directory in a nested tree without throwing", () => {
    const root = scratchRoot(import.meta.path, "nested-tree");
    const vfs = getVirtualInstallerFS();
    vfs.mkdirSync(join(root, "a", "b"), { recursive: true });
    vfs.writeFileSync(join(root, "top.txt"), "top");
    vfs.writeFileSync(join(root, "a", "mid.txt"), "mid");
    vfs.writeFileSync(join(root, "a", "b", "leaf.txt"), "leaf");
    expect(() => syncTree(root)).not.toThrow();
  });

  test("succeeds on an empty directory", () => {
    const root = scratchRoot(import.meta.path, "empty-tree");
    expect(() => syncTree(root)).not.toThrow();
  });

  test("throws on a symlink anywhere in the tree", () => {
    const root = scratchRoot(import.meta.path, "symlink-tree");
    const elsewhere = join(root, "symlink-target");
    const vfs = getVirtualInstallerFS();
    vfs.mkdirSync(elsewhere, { recursive: true });
    handleCreateSymlink(elsewhere, join(root, "link"));
    expect(() => syncTree(root)).toThrow(HarnessError);
    try {
      syncTree(root);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).message).toContain("cannot sync symlinked tree path");
    }
  });

  describe("special files", () => {
    test("throws on a non-regular, non-directory path such as a unix socket", () => {
      const shortRoot = "/virtual/dt-special";
      const vfs = getVirtualInstallerFS();
      vfs.mkdirSync(shortRoot, { recursive: true });
      const socketPath = join(shortRoot, "socket");
      vfs.writeFileSync(socketPath, "");
      registerSpecialFile(socketPath, "socket");
      expect(() => syncTree(shortRoot)).toThrow(HarnessError);
      try {
        syncTree(shortRoot);
        throw new Error("expected throw");
      } catch (error) {
        expect(error).toBeInstanceOf(HarnessError);
        expect((error as HarnessError).message).toContain("cannot sync special tree path");
      }
    });
  });
});
