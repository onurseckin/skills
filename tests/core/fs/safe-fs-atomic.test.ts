import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertSafeToDelete,
  safeCpSync,
  safeMkdirSync,
  safeRenameSync,
  safeRmSync,
  safeWriteFileSync,
  type DestructiveAuditEvent,
} from "../../../olt/scripts/src/core/shared/safe-fs/index.ts";

describe("safe-fs: directory guards and atomic operations", () => {
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const mockSymlinks = new Map<string, string>();
  const spies: { mockRestore: () => void }[] = [];
  let rootCounter = 0;

  function makeFixtureRoot(): string {
    const root = `/tmp/virtual/safe-fs-fixture-${++rootCounter}`;
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
      let current = "";
      for (const part of p.split(sep)) {
        if (!part && !current) {
          current = sep;
          continue;
        }
        current = current === sep ? sep + part : join(current, part);
        if (mockSymlinks.has(current)) current = mockSymlinks.get(current)!;
      }
      return current;
    };

    spies.push(
      spyOn(fs, "existsSync").mockImplementation(
        (p: fs.PathLike) =>
          mockFiles.has(String(p)) ||
          mockDirs.has(String(p)) ||
          mockSymlinks.has(String(p)) ||
          String(p) === "/" ||
          String(p) === sep,
      ),
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
        mockFiles.set(
          String(p),
          typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"),
        );
      }) as unknown as typeof fs.writeFileSync),
      spyOn(fs, "symlinkSync").mockImplementation(((target: fs.PathLike, p: fs.PathLike) => {
        mockSymlinks.set(String(p), String(target));
      }) as unknown as typeof fs.symlinkSync),
      spyOn(fs, "realpathSync").mockImplementation(((p: fs.PathLike) =>
        String(p) === "/" || String(p) === sep
          ? String(p)
          : resolveSymlinksInPath(String(p))) as unknown as typeof fs.realpathSync),
      spyOn(fs, "lstatSync").mockImplementation(((p: fs.PathLike) => {
        const s = String(p);
        if (s === "/" || s === sep)
          return {
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false,
          } as unknown as fs.Stats;
        if (mockSymlinks.has(s))
          return {
            isDirectory: () => false,
            isFile: () => false,
            isSymbolicLink: () => true,
          } as unknown as fs.Stats;
        if (mockDirs.has(s))
          return {
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false,
          } as unknown as fs.Stats;
        if (mockFiles.has(s))
          return {
            isDirectory: () => false,
            isFile: () => true,
            isSymbolicLink: () => false,
          } as unknown as fs.Stats;
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
        for (const f of Array.from(mockFiles.keys()))
          if (f.startsWith(s + "/")) mockFiles.delete(f);
        for (const d of Array.from(mockDirs)) if (d.startsWith(s + "/")) mockDirs.delete(d);
        for (const sym of Array.from(mockSymlinks.keys()))
          if (sym.startsWith(s + "/")) mockSymlinks.delete(sym);
      }) as unknown as typeof fs.rmSync),
      spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
        const fromStr = String(from);
        const toStr = String(to);
        const val = mockFiles.get(fromStr);
        if (val !== undefined) {
          mockFiles.set(toStr, val);
          mockFiles.delete(fromStr);
        }
        if (mockDirs.has(fromStr)) {
          mockDirs.delete(fromStr);
          mockDirs.add(toStr);
        }
        for (const f of Array.from(mockFiles.keys())) {
          if (f.startsWith(fromStr + "/")) {
            mockFiles.set(toStr + f.slice(fromStr.length), mockFiles.get(f)!);
            mockFiles.delete(f);
          }
        }
        for (const d of Array.from(mockDirs)) {
          if (d.startsWith(fromStr + "/")) {
            mockDirs.add(toStr + d.slice(fromStr.length));
            mockDirs.delete(d);
          }
        }
      }) as unknown as typeof fs.renameSync),
      spyOn(fs, "cpSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
        const fromStr = String(from);
        const toStr = String(to);
        const val = mockFiles.get(fromStr);
        if (val !== undefined) mockFiles.set(toStr, val);
        if (mockDirs.has(fromStr)) mockDirs.add(toStr);
        for (const f of Array.from(mockFiles.keys())) {
          if (f.startsWith(fromStr + "/"))
            mockFiles.set(toStr + f.slice(fromStr.length), mockFiles.get(f)!);
        }
        for (const d of Array.from(mockDirs)) {
          if (d.startsWith(fromStr + "/")) mockDirs.add(toStr + d.slice(fromStr.length));
        }
      }) as unknown as typeof fs.cpSync),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  it("refuses the current working directory and its ancestors", () => {
    const fixtureRoot = makeFixtureRoot();
    const deepCwd = join(fixtureRoot, "a", "b", "c", "d");
    fs.mkdirSync(deepCwd);

    const cwdSpy = spyOn(process, "cwd").mockReturnValue(deepCwd);
    try {
      expectRefusal(
        () => safeRmSync(deepCwd, { allowedRoots: [dirname(deepCwd)] }),
        "ABSOLUTE_DENYLIST_CWD",
      );
      const ancestor = dirname(deepCwd);
      expectRefusal(
        () => safeRmSync(ancestor, { allowedRoots: [dirname(ancestor)] }),
        "ABSOLUTE_DENYLIST_CWD_ANCESTOR",
      );
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("refuses paths with fewer than the minimum number of segments", () => {
    const shallow = `${sep}shallow-root-guard-test`;
    expectRefusal(
      () => safeRmSync(shallow, { allowedRoots: [sep] }),
      "ABSOLUTE_DENYLIST_TOO_SHALLOW",
    );
  });

  it("throws when the target does not exist and missingOk is not set", () => {
    const root = makeFixtureRoot();
    const missing = join(root, "does-not-exist");
    let caught: unknown;
    try {
      safeRmSync(missing, { allowedRoots: [root] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HarnessError);
    expect((caught as HarnessError).code).toBe("INVALID_STATE");
  });

  it("is a no-op when the target does not exist and missingOk is set", () => {
    const root = makeFixtureRoot();
    const missing = join(root, "does-not-exist");
    expect(() => safeRmSync(missing, { allowedRoots: [root], missingOk: true })).not.toThrow();
    const result = assertSafeToDelete(missing, { allowedRoots: [root], missingOk: true });
    expect(result.exists).toBe(false);
  });

  it("still enforces containment refusal even when missingOk is set", () => {
    const root = makeFixtureRoot();
    const allowedRoot = join(root, "allowed");
    fs.mkdirSync(allowedRoot);
    const outsideMissing = join(root, "outside-missing");

    expectRefusal(
      () => safeRmSync(outsideMissing, { allowedRoots: [allowedRoot], missingOk: true }),
      "CONTAINMENT",
    );
  });

  it("names the target, the rule, and the allowed roots in a refusal message", () => {
    const root = makeFixtureRoot();
    const allowedRoot = join(root, "allowed");
    const sibling = join(root, "sibling");
    fs.mkdirSync(allowedRoot);
    fs.mkdirSync(sibling);

    let caught: unknown;
    try {
      safeRmSync(sibling, { allowedRoots: [allowedRoot] });
    } catch (error) {
      caught = error;
    }
    const error = caught as HarnessError;
    expect(error).toBeInstanceOf(HarnessError);
    expect(error.message).toContain(sibling);
    expect(error.message).toContain(allowedRoot);
    expect(error.message).toContain("CONTAINMENT");
    expect(error.issues[0]).toMatchObject({
      rule: "CONTAINMENT",
      target: sibling,
      allowedRoots: [allowedRoot],
    });
  });

  it("records a successful delete through the audit hook", () => {
    const root = makeFixtureRoot();
    const target = join(root, "audited");
    fs.mkdirSync(target);
    const events: DestructiveAuditEvent[] = [];

    safeRmSync(target, { allowedRoots: [root], onAudit: (event) => events.push(event) });

    expect(events).toHaveLength(1);
    expect(events[0]?.operation).toBe("delete");
    expect(events[0]?.resolvedPath).toBe(resolve(target));
    expect(typeof events[0]?.timestamp).toBe("string");
  });

  it("guards safeRenameSync source the same way as a delete", () => {
    const root = makeFixtureRoot();
    const repo = join(root, "repo");
    fs.mkdirSync(join(repo, ".git"));
    const destination = join(root, "moved-out");

    expectRefusal(
      () => safeRenameSync(repo, destination, { allowedRoots: [root] }),
      "REPOSITORY_INTERLOCK",
    );
    expect(fs.existsSync(repo)).toBe(true);

    const plain = join(root, "plain-source");
    fs.mkdirSync(plain);
    safeRenameSync(plain, destination, { allowedRoots: [root] });
    expect(fs.existsSync(plain)).toBe(false);
    expect(fs.existsSync(destination)).toBe(true);
  });

  it("refuses safeCpSync onto an existing destination without allowOverwrite", () => {
    const root = makeFixtureRoot();
    const source = join(root, "source");
    const destination = join(root, "destination");
    fs.mkdirSync(source);
    fs.writeFileSync(join(source, "a.txt"), "one");
    fs.mkdirSync(destination);

    expectRefusal(
      () => safeCpSync(source, destination, { allowedRoots: [root] }),
      "COPY_DESTINATION_EXISTS",
    );

    safeCpSync(source, destination, { allowedRoots: [root], allowOverwrite: true });
    expect(fs.existsSync(join(destination, "a.txt"))).toBe(true);
  });

  it("refuses safeWriteFileSync and safeMkdirSync outside the allowed root", () => {
    const root = makeFixtureRoot();
    const allowedRoot = join(root, "allowed");
    fs.mkdirSync(allowedRoot);
    const outsideFile = join(root, "outside", "file.txt");
    const outsideDir = join(root, "outside", "dir");

    expectRefusal(
      () => safeWriteFileSync(outsideFile, "data", { allowedRoots: [allowedRoot] }),
      "CONTAINMENT",
    );
    expectRefusal(() => safeMkdirSync(outsideDir, { allowedRoots: [allowedRoot] }), "CONTAINMENT");
    expect(fs.existsSync(outsideFile)).toBe(false);
    expect(fs.existsSync(outsideDir)).toBe(false);

    safeWriteFileSync(join(allowedRoot, "inside.txt"), "data", { allowedRoots: [allowedRoot] });
    safeMkdirSync(join(allowedRoot, "inside-dir"), { allowedRoots: [allowedRoot] });
    expect(fs.existsSync(join(allowedRoot, "inside.txt"))).toBe(true);
    expect(fs.existsSync(join(allowedRoot, "inside-dir"))).toBe(true);
  });
});
