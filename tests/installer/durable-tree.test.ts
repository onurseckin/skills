import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { syncTree } from "../../olt/scripts/src/installer/durable-tree.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

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
    let server: Server | undefined;
    let shortRoot: string | undefined;

    afterEach(() => {
      server?.close();
      server = undefined;
      if (shortRoot) rmSync(shortRoot, { recursive: true, force: true });
      shortRoot = undefined;
    });

    test("throws on a non-regular, non-directory path such as a unix socket", async () => {
      // A real AF_UNIX socket path is capped at ~104 bytes on macOS, well under the length that
      // the shared scratchRoot()'s repo-nested directories produce, so this one case deliberately
      // uses a short-lived, short-path temp dir instead and cleans it up itself.
      shortRoot = mkdtempSync(join(tmpdir(), "dt-"));
      const socketPath = join(shortRoot, "socket");
      server = createServer();
      await new Promise<void>((resolve, reject) => {
        server?.once("error", reject);
        server?.listen(socketPath, resolve);
      });
      expect(() => syncTree(shortRoot!)).toThrow(HarnessError);
      try {
        syncTree(shortRoot!);
        throw new Error("expected throw");
      } catch (error) {
        expect(error).toBeInstanceOf(HarnessError);
        expect((error as HarnessError).message).toContain("cannot sync special tree path");
      }
    });
  });
});
