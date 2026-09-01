import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { guardedRemoveSync, smartEnsureSymlink } from "../../../scripts/sync/fs-helpers.ts";

describe("sync-fs-helpers (in-memory virtual)", () => {
  const root = `${process.cwd()}/.olt/virtual-sync-fs`;
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const mockSymlinks = new Map<string, string>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockSymlinks.clear();
    mockDirs.add(root);

    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p) => {
        const s = String(p);
        return mockFiles.has(s) || mockDirs.has(s) || mockSymlinks.has(s);
      }),
      spyOn(fs, "lstatSync").mockImplementation((p) => {
        const s = String(p);
        if (mockSymlinks.has(s))
          return {
            isSymbolicLink: () => true,
            isDirectory: () => false,
            isFile: () => false,
          } as unknown as fs.Stats;
        if (mockDirs.has(s))
          return {
            isSymbolicLink: () => false,
            isDirectory: () => true,
            isFile: () => false,
          } as unknown as fs.Stats;
        if (mockFiles.has(s))
          return {
            isSymbolicLink: () => false,
            isDirectory: () => false,
            isFile: () => true,
          } as unknown as fs.Stats;
        const err = new Error(`ENOENT: no such file, lstat '${s}'`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }),
      spyOn(fs, "statSync").mockImplementation((p) => {
        let s = String(p);
        if (mockSymlinks.has(s)) s = mockSymlinks.get(s)!;
        if (mockDirs.has(s))
          return {
            isSymbolicLink: () => false,
            isDirectory: () => true,
            isFile: () => false,
          } as unknown as fs.Stats;
        if (mockFiles.has(s))
          return {
            isSymbolicLink: () => false,
            isDirectory: () => false,
            isFile: () => true,
          } as unknown as fs.Stats;
        const err = new Error(`ENOENT: no such file, stat '${s}'`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }),
      spyOn(fs, "readlinkSync").mockImplementation((p) => {
        const target = mockSymlinks.get(String(p));
        if (target !== undefined) return target;
        throw new Error(`EINVAL: invalid argument, readlink '${String(p)}'`);
      }),
      spyOn(fs, "symlinkSync").mockImplementation((target, path) => {
        mockSymlinks.set(String(path), String(target));
      }),
      spyOn(fs, "unlinkSync").mockImplementation((p) => {
        mockFiles.delete(String(p));
        mockSymlinks.delete(String(p));
      }),
      spyOn(fs, "renameSync").mockImplementation((oldP, newP) => {
        const o = String(oldP);
        const n = String(newP);
        if (mockSymlinks.has(o)) {
          mockSymlinks.set(n, mockSymlinks.get(o)!);
          mockSymlinks.delete(o);
        } else if (mockFiles.has(o)) {
          mockFiles.set(n, mockFiles.get(o)!);
          mockFiles.delete(o);
        }
      }),
      spyOn(fs, "mkdirSync").mockImplementation((p) => {
        mockDirs.add(String(p));
        return undefined as unknown as string;
      }),
      spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
        mockFiles.set(
          String(p),
          typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8"),
        );
      }),
      spyOn(fs, "readFileSync").mockImplementation((p) => {
        const val = mockFiles.get(String(p));
        if (val !== undefined) return val;
        throw new Error(`ENOENT: no such file, open '${String(p)}'`);
      }),
      spyOn(fs, "rmSync").mockImplementation((p) => {
        const s = String(p);
        mockFiles.delete(s);
        mockDirs.delete(s);
        mockSymlinks.delete(s);
        for (const k of [...mockFiles.keys()]) if (k.startsWith(s)) mockFiles.delete(k);
        for (const k of [...mockDirs]) if (k.startsWith(s)) mockDirs.delete(k);
        for (const k of [...mockSymlinks.keys()]) if (k.startsWith(s)) mockSymlinks.delete(k);
      }),
      spyOn(fs, "realpathSync").mockImplementation((p) => String(p)),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  describe("smartEnsureSymlink refuses to destroy a real directory", () => {
    test("a real git-repo directory at the link path throws and survives untouched", () => {
      const assistantDir = join(root, "assistant-skills");
      const targetOlt = join(root, "olt-deployment");
      mockDirs.add(targetOlt);
      mockFiles.set(join(targetOlt, "SKILL.md"), "canonical\n");

      const linkPath = join(assistantDir, "olt");
      mockDirs.add(assistantDir);
      mockDirs.add(linkPath);
      mockDirs.add(join(linkPath, ".git"));
      mockFiles.set(join(linkPath, "precious.txt"), "do-not-delete-me\n");

      expect(() =>
        smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] }),
      ).toThrow(HarnessError);
      expect(fs.existsSync(linkPath)).toBe(true);
      expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(false);
      expect(fs.lstatSync(linkPath).isDirectory()).toBe(true);
      expect(fs.existsSync(join(linkPath, ".git"))).toBe(true);
      expect(fs.readFileSync(join(linkPath, "precious.txt"), "utf-8")).toBe("do-not-delete-me\n");
    });

    test("a real plain directory (no .git) at the link path also throws and survives untouched", () => {
      const assistantDir = join(root, "assistant-skills");
      const targetOlt = join(root, "olt-deployment");
      mockDirs.add(assistantDir);
      mockDirs.add(targetOlt);

      const linkPath = join(assistantDir, "olt");
      mockDirs.add(linkPath);
      mockFiles.set(join(linkPath, "keepme.txt"), "still-here\n");

      let caught: unknown;
      try {
        smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(HarnessError);
      expect((caught as HarnessError).code).toBe("PATH_SAFETY");
      expect((caught as HarnessError).message).toContain(linkPath);
      expect(fs.existsSync(linkPath)).toBe(true);
      expect(fs.lstatSync(linkPath).isDirectory()).toBe(true);
      expect(fs.readFileSync(join(linkPath, "keepme.txt"), "utf-8")).toBe("still-here\n");
    });

    test("a real file at the link path throws and survives untouched", () => {
      const assistantDir = join(root, "assistant-skills");
      mockDirs.add(assistantDir);
      const targetOlt = join(root, "olt-deployment");
      mockDirs.add(targetOlt);

      const linkPath = join(assistantDir, "olt");
      mockFiles.set(linkPath, "not-a-symlink\n");

      expect(() =>
        smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] }),
      ).toThrow(HarnessError);
      expect(fs.readFileSync(linkPath, "utf-8")).toBe("not-a-symlink\n");
    });
  });

  describe("smartEnsureSymlink normal operation", () => {
    test("creates a symlink where nothing existed before", () => {
      const assistantDir = join(root, "assistant-skills");
      mockDirs.add(assistantDir);
      const targetOlt = join(root, "olt-deployment");
      mockDirs.add(targetOlt);

      const linkPath = join(assistantDir, "olt");
      const status = smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] });

      expect(status).toBe("created");
      expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(linkPath)).toBe(targetOlt);
    });

    test("is idempotent when the symlink already points at target", () => {
      const assistantDir = join(root, "assistant-skills");
      mockDirs.add(assistantDir);
      const targetOlt = join(root, "olt-deployment");
      mockDirs.add(targetOlt);

      const linkPath = join(assistantDir, "olt");
      mockSymlinks.set(linkPath, targetOlt);

      const status = smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] });

      expect(status).toBe("skipped");
      expect(fs.readlinkSync(linkPath)).toBe(targetOlt);
    });

    test("re-points a stale symlink that targets something else", () => {
      const assistantDir = join(root, "assistant-skills");
      mockDirs.add(assistantDir);
      const oldTarget = join(root, "old-olt-deployment");
      const newTarget = join(root, "new-olt-deployment");
      mockDirs.add(oldTarget);
      mockDirs.add(newTarget);

      const linkPath = join(assistantDir, "olt");
      mockSymlinks.set(linkPath, oldTarget);

      const status = smartEnsureSymlink(newTarget, linkPath, { allowedRoots: [assistantDir] });

      expect(status).toBe("created");
      expect(fs.readlinkSync(linkPath)).toBe(newTarget);
    });

    test("refuses when the link path falls outside the declared allowed roots", () => {
      const assistantDir = join(root, "assistant-skills");
      const otherDir = join(root, "unrelated-dir");
      mockDirs.add(assistantDir);
      mockDirs.add(otherDir);
      const targetOlt = join(root, "olt-deployment");
      mockDirs.add(targetOlt);

      const linkPath = join(otherDir, "olt");

      expect(() =>
        smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] }),
      ).toThrow(HarnessError);
      expect(fs.existsSync(linkPath)).toBe(false);
    });
  });

  describe("guardedRemoveSync", () => {
    test("removes a plain file inside the allowed root", () => {
      const victim = join(root, "nested", "victim.txt");
      mockDirs.add(join(root, "nested"));
      mockFiles.set(victim, "gone-soon\n");

      guardedRemoveSync(victim, { allowedRoots: [root] });
      expect(fs.existsSync(victim)).toBe(false);
    });

    test("is a no-op by default when the target is already missing", () => {
      const missing = join(root, "never-existed");
      expect(() => guardedRemoveSync(missing, { allowedRoots: [root] })).not.toThrow();
    });

    test("refuses to delete a directory containing a .git entry without an explicit override", () => {
      const repoDir = join(root, "some-repo");
      mockDirs.add(repoDir);
      mockDirs.add(join(repoDir, ".git"));
      mockFiles.set(join(repoDir, "precious.txt"), "do-not-delete-me\n");

      expect(() => guardedRemoveSync(repoDir, { allowedRoots: [root] })).toThrow(HarnessError);
      expect(fs.existsSync(repoDir)).toBe(true);
      expect(fs.existsSync(join(repoDir, ".git"))).toBe(true);
      expect(fs.readFileSync(join(repoDir, "precious.txt"), "utf-8")).toBe("do-not-delete-me\n");
    });

    test("refuses to delete outside the declared allowed roots even when the caller asks", () => {
      const allowedRoot = join(root, "allowed");
      const sibling = join(root, "sibling");
      mockDirs.add(allowedRoot);
      mockDirs.add(sibling);
      mockFiles.set(join(sibling, "keep.txt"), "keep\n");

      expect(() => guardedRemoveSync(sibling, { allowedRoots: [allowedRoot] })).toThrow(
        HarnessError,
      );
      expect(fs.existsSync(join(sibling, "keep.txt"))).toBe(true);
    });
  });
});
