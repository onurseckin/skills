import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { safeRmSync } from "../../../olt/scripts/src/core/shared/safe-fs/index.ts";

describe("safe-fs destructive guard", () => {
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const mockSymlinks = new Map<string, string>();
  const spies: { mockRestore: () => void }[] = [];
  let rootCounter = 0;

  function makeFixtureRoot(): string {
    const root = `/tmp/virtual/safe-fs-test-${++rootCounter}`;
    mockDirs.add(root);
    return root;
  }

  function expectRefusal(fn: () => void, rule: string): HarnessError {
    let caught: unknown;
    try {
      fn();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HarnessError);
    const error = caught as HarnessError;
    expect(error.code).toBe("PATH_SAFETY");
    expect(error.message).toContain(rule);
    return error;
  }

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockSymlinks.clear();

    const resolveSymlinksInPath = (p: string): string => {
      const parts = p.split(sep);
      let current = "";
      for (const part of parts) {
        if (!part && !current) {
          current = sep;
          continue;
        }
        current = current === sep ? sep + part : join(current, part);
        if (mockSymlinks.has(current)) {
          current = mockSymlinks.get(current)!;
        }
      }
      return current;
    };

    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s === "/" || s === homedir() || resolve(s) === resolve(homedir())) return true;
        return mockFiles.has(s) || mockDirs.has(s) || mockSymlinks.has(s);
      }),
      spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike) => {
        let s = String(p);
        while (s && s !== "/" && s !== ".") {
          mockDirs.add(s);
          s = dirname(s);
        }
        return undefined as unknown as string;
      }) as unknown as typeof fs.mkdirSync),
      spyOn(fs, "writeFileSync").mockImplementation(((
        p: fs.PathOrFileDescriptor,
        data: string | NodeJS.ArrayBufferView,
      ) => {
        const s = String(p);
        mockFiles.set(
          s,
          typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"),
        );
      }) as unknown as typeof fs.writeFileSync),
      spyOn(fs, "symlinkSync").mockImplementation(((target: fs.PathLike, p: fs.PathLike) => {
        mockSymlinks.set(String(p), String(target));
      }) as unknown as typeof fs.symlinkSync),
      spyOn(fs, "realpathSync").mockImplementation(((p: fs.PathLike) => {
        const s = String(p);
        if (s === "/" || s === homedir()) return s;
        return resolveSymlinksInPath(s);
      }) as unknown as typeof fs.realpathSync),
      spyOn(fs, "lstatSync").mockImplementation(((p: fs.PathLike) => {
        const s = String(p);
        if (s === "/" || s === homedir()) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false,
          } as unknown as fs.Stats;
        }
        if (mockSymlinks.has(s)) {
          return {
            isDirectory: () => false,
            isFile: () => false,
            isSymbolicLink: () => true,
          } as unknown as fs.Stats;
        }
        if (mockDirs.has(s)) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false,
          } as unknown as fs.Stats;
        }
        if (mockFiles.has(s)) {
          return {
            isDirectory: () => false,
            isFile: () => true,
            isSymbolicLink: () => false,
          } as unknown as fs.Stats;
        }
        const err = new Error(`ENOENT: no such file or directory, lstat '${s}'`) as Error & {
          code: string;
        };
        err.code = "ENOENT";
        throw err;
      }) as unknown as typeof fs.lstatSync),
      spyOn(fs, "rmSync").mockImplementation(((p: fs.PathLike) => {
        const s = String(p);
        mockFiles.delete(s);
        mockDirs.delete(s);
        mockSymlinks.delete(s);
        for (const f of Array.from(mockFiles.keys())) {
          if (f.startsWith(s + "/")) mockFiles.delete(f);
        }
        for (const d of Array.from(mockDirs)) {
          if (d.startsWith(s + "/")) mockDirs.delete(d);
        }
        for (const sym of Array.from(mockSymlinks.keys())) {
          if (sym.startsWith(s + "/")) mockSymlinks.delete(sym);
        }
      }) as unknown as typeof fs.rmSync),
      spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        const data = mockFiles.get(s);
        if (data !== undefined) return data;
        throw new Error(`ENOENT: no such file, open '${s}'`);
      }) as unknown as typeof fs.readFileSync),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  it("succeeds deleting a directory strictly inside an allowed root", () => {
    const root = makeFixtureRoot();
    const target = join(root, "nested", "victim");
    fs.mkdirSync(target);
    fs.writeFileSync(join(target, "file.txt"), "data");

    safeRmSync(target, { allowedRoots: [root] });

    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(root)).toBe(true);
  });

  it("refuses to delete the allowed root itself", () => {
    const root = makeFixtureRoot();
    const error = expectRefusal(() => safeRmSync(root, { allowedRoots: [root] }), "CONTAINMENT");
    expect(error.message).toContain(root);
    expect(fs.existsSync(root)).toBe(true);
  });

  it("refuses to delete an ancestor of an allowed root", () => {
    const root = makeFixtureRoot();
    const nestedRoot = join(root, "nested-root");
    fs.mkdirSync(nestedRoot);

    expectRefusal(() => safeRmSync(root, { allowedRoots: [nestedRoot] }), "CONTAINMENT");
    expect(fs.existsSync(root)).toBe(true);
  });

  it("refuses to delete a sibling directory outside the allowed root", () => {
    const root = makeFixtureRoot();
    const allowedRoot = join(root, "allowed");
    const sibling = join(root, "sibling");
    fs.mkdirSync(allowedRoot);
    fs.mkdirSync(sibling);

    expectRefusal(() => safeRmSync(sibling, { allowedRoots: [allowedRoot] }), "CONTAINMENT");
    expect(fs.existsSync(sibling)).toBe(true);
  });

  it("refuses a symlinked parent that redirects the target outside the allowed root", () => {
    const root = makeFixtureRoot();
    const allowedRoot = join(root, "allowed");
    const outside = join(root, "outside");
    fs.mkdirSync(allowedRoot);
    fs.mkdirSync(outside);
    fs.writeFileSync(join(outside, "leaf.txt"), "secret");
    fs.symlinkSync(outside, join(allowedRoot, "escape"));

    const target = join(allowedRoot, "escape", "leaf.txt");
    expectRefusal(() => safeRmSync(target, { allowedRoots: [allowedRoot] }), "CONTAINMENT");
    expect(fs.existsSync(join(outside, "leaf.txt"))).toBe(true);
  });

  it("deletes a symlink itself without following it into the real target", () => {
    const root = makeFixtureRoot();
    const realTarget = join(root, "real-target");
    fs.mkdirSync(realTarget);
    fs.writeFileSync(join(realTarget, "keep.txt"), "keep me");
    const linkPath = join(root, "link-to-target");
    fs.symlinkSync(realTarget, linkPath);

    safeRmSync(linkPath, { allowedRoots: [root] });

    expect(() => fs.lstatSync(linkPath)).toThrow();
    expect(fs.existsSync(realTarget)).toBe(true);
    expect(fs.readFileSync(join(realTarget, "keep.txt"), "utf8")).toBe("keep me");
  });

  it("refuses to recursively delete a directory that itself contains .git", () => {
    const root = makeFixtureRoot();
    const repo = join(root, "repo");
    fs.mkdirSync(join(repo, ".git"));

    expectRefusal(() => safeRmSync(repo, { allowedRoots: [root] }), "REPOSITORY_INTERLOCK");
    expect(fs.existsSync(repo)).toBe(true);
  });

  it("refuses to delete a subdirectory whose ancestor up to the allowed root contains .git", () => {
    const root = makeFixtureRoot();
    const repo = join(root, "repo");
    const nested = join(repo, "sub", "dir");
    fs.mkdirSync(join(repo, ".git"));
    fs.mkdirSync(nested);

    expectRefusal(() => safeRmSync(nested, { allowedRoots: [root] }), "REPOSITORY_INTERLOCK");
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("allows deleting inside a git-bearing tree only with an explicit override", () => {
    const root = makeFixtureRoot();
    const repo = join(root, "repo");
    const nested = join(repo, "sub", "dir");
    fs.mkdirSync(join(repo, ".git"));
    fs.mkdirSync(nested);

    safeRmSync(nested, { allowedRoots: [root], allowGitRepositoryDeletion: true });
    expect(fs.existsSync(nested)).toBe(false);
  });

  it("refuses the filesystem root regardless of allowed roots", () => {
    expectRefusal(
      () => safeRmSync("/", { allowedRoots: ["/"] }),
      "ABSOLUTE_DENYLIST_FILESYSTEM_ROOT",
    );
    expect(fs.existsSync("/")).toBe(true);
  });

  it("refuses the user's home directory regardless of allowed roots", () => {
    const home = resolve(homedir());
    expectRefusal(
      () => safeRmSync(home, { allowedRoots: [dirname(home)] }),
      "ABSOLUTE_DENYLIST_HOME_DIRECTORY",
    );
    expect(fs.existsSync(home)).toBe(true);
  });

  it("refuses a direct child of the home directory regardless of allowed roots", () => {
    const home = resolve(homedir());
    const homeChild = join(home, "some-direct-child-that-should-never-be-touched");
    expectRefusal(
      () => safeRmSync(homeChild, { allowedRoots: [home] }),
      "ABSOLUTE_DENYLIST_HOME_CHILD",
    );
  });
});
