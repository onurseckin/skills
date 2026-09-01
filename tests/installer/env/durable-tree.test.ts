import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { syncTree } from "../../../olt/scripts/src/installer/durable-tree.ts";
import { scratchRoot } from "../../shared/fixtures/scratch-root.ts";
import {
  cleanupVirtualInstallerFS,
  registerSpecialFile,
  setupVirtualInstallerFS,
} from "../helpers.ts";

beforeEach(setupVirtualInstallerFS);
afterEach(cleanupVirtualInstallerFS);

describe("syncTree", () => {
  test("fsyncs every file and directory in a nested tree without throwing", () => {
    const root = scratchRoot(import.meta.path, "nested-tree");
    mkdirSync(join(root, "a", "b"), { recursive: true });
    writeFileSync(join(root, "top.txt"), "top");
    writeFileSync(join(root, "a", "mid.txt"), "mid");
    writeFileSync(join(root, "a", "b", "leaf.txt"), "leaf");
    expect(() => syncTree(root)).not.toThrow();
  });

  test("succeeds on an empty directory", () => {
    const root = scratchRoot(import.meta.path, "empty-tree");
    expect(() => syncTree(root)).not.toThrow();
  });

  test("throws on a symlink anywhere in the tree", () => {
    const root = scratchRoot(import.meta.path, "symlink-tree");
    const elsewhere = join(root, "symlink-target");
    mkdirSync(elsewhere, { recursive: true });
    symlinkSync(elsewhere, join(root, "link"));
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
      mkdirSync(shortRoot, { recursive: true });
      const socketPath = join(shortRoot, "socket");
      writeFileSync(socketPath, "");
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
