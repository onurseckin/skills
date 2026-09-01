import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  expandScopeEntry,
  expandWriteScope,
} from "../../../olt/scripts/src/graph/scope-expansion.ts";

const vfs = new Set<string>();
const vdirs = new Set<string>();
const lockedDirs = new Set<string>();
let rootCounter = 0;
const spies: Array<{ mockRestore: () => void }> = [];
const norm = (p: fs.PathLike) => resolve(String(p)).replace(/\/+$/, "");

beforeEach(() => {
  const oe = fs.existsSync.bind(fs),
    ostat = fs.statSync.bind(fs),
    oreaddir = fs.readdirSync.bind(fs);
  const om = fs.mkdirSync.bind(fs),
    ow = fs.writeFileSync.bind(fs),
    ochmod = fs.chmodSync.bind(fs);

  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = norm(p);
      return s.startsWith("/virtual/")
        ? vfs.has(s) || vdirs.has(s) || Array.from(vfs).some((k) => k.startsWith(`${s}/`))
        : oe(p);
    }),
    spyOn(fs, "statSync").mockImplementation((p: fs.PathLike): fs.Stats => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const isFile = vfs.has(s);
        const isDir = vdirs.has(s) || Array.from(vfs).some((k) => k.startsWith(`${s}/`));
        if (!isFile && !isDir) throw new Error(`ENOENT: ${s}`);
        return {
          isFile: () => isFile,
          isDirectory: () => isDir,
          isSymbolicLink: () => false,
          size: 0,
        } as unknown as fs.Stats;
      }
      return ostat(p);
    }),
    spyOn(fs, "readdirSync").mockImplementation((p: fs.PathLike, opt?: unknown): unknown => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        if (lockedDirs.has(s)) throw new Error(`EACCES: permission denied, scandir '${s}'`);
        const prefix = `${s}/`;
        const entries = new Map<string, boolean>();
        for (const k of vfs) {
          if (k.startsWith(prefix) && k.length > prefix.length) {
            const rel = k.slice(prefix.length);
            const firstSeg = rel.split("/")[0]!;
            entries.set(firstSeg, rel.includes("/"));
          }
        }
        for (const d of vdirs) {
          if (d.startsWith(prefix) && d.length > prefix.length) {
            const rel = d.slice(prefix.length);
            entries.set(rel.split("/")[0]!, true);
          }
        }
        const withTypes =
          typeof opt === "object" &&
          opt !== null &&
          "withFileTypes" in opt &&
          Boolean((opt as { withFileTypes?: boolean }).withFileTypes);
        if (withTypes) {
          return Array.from(entries.entries()).map(([name, isDir]) => ({
            name,
            isDirectory: () => isDir,
            isFile: () => !isDir,
            isSymbolicLink: () => false,
          })) as unknown as fs.Dirent[];
        }
        return Array.from(entries.keys());
      }
      return oreaddir(p, opt as Parameters<typeof oreaddir>[1]);
    }),
    spyOn(fs, "mkdirSync").mockImplementation((p) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vdirs.add(s);
        return undefined;
      }
      return om(p) as string | undefined;
    }),
    spyOn(fs, "writeFileSync").mockImplementation((p) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vfs.add(s);
        return;
      }
      ow(p, "");
    }),
    spyOn(fs, "chmodSync").mockImplementation((p, mode) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        if (mode === 0o000 || mode === 0) lockedDirs.add(s);
        else lockedDirs.delete(s);
        return;
      }
      ochmod(p, mode);
    }),
  );
});

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  vdirs.clear();
  lockedDirs.clear();
});

function fixtureRepo(): string {
  rootCounter += 1;
  const root = `/virtual/scope-expansion-fixture-${rootCounter}`;
  vdirs.add(root);
  return root;
}

describe("expandScopeEntry", () => {
  test("a directory expands to every file beneath it", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/db"), { recursive: true });
    writeFileSync(join(repo, "src/db/index.ts"), "");
    writeFileSync(join(repo, "src/db/schema.ts"), "");
    expect(expandScopeEntry(repo, "src/db")).toEqual(["src/db/index.ts", "src/db/schema.ts"]);
  });

  test("nested directories are walked recursively", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/db/migrations"), { recursive: true });
    writeFileSync(join(repo, "src/db/index.ts"), "");
    writeFileSync(join(repo, "src/db/migrations/001.ts"), "");
    expect(expandScopeEntry(repo, "src/db").sort()).toEqual([
      "src/db/index.ts",
      "src/db/migrations/001.ts",
    ]);
  });

  test("VCS and build noise are skipped inside the walk", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/lib/node_modules"), { recursive: true });
    mkdirSync(join(repo, "src/lib/.git"), { recursive: true });
    writeFileSync(join(repo, "src/lib/index.ts"), "");
    writeFileSync(join(repo, "src/lib/node_modules/pkg.js"), "");
    writeFileSync(join(repo, "src/lib/.git/HEAD"), "");
    expect(expandScopeEntry(repo, "src/lib")).toEqual(["src/lib/index.ts"]);
  });

  test("a file counts as itself", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src/single.ts"), "");
    expect(expandScopeEntry(repo, "src/single.ts")).toEqual(["src/single.ts"]);
  });

  test("a path that does not exist yet cannot be expanded past its own token", () => {
    const repo = fixtureRepo();
    expect(expandScopeEntry(repo, "src/not-created-yet")).toEqual(["src/not-created-yet"]);
  });

  test("an empty directory counts as its own declared path, not zero files", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/empty"), { recursive: true });
    expect(expandScopeEntry(repo, "src/empty")).toEqual(["src/empty"]);
  });

  test("an unreadable nested directory is skipped rather than crashing the walk", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/db/locked"), { recursive: true });
    writeFileSync(join(repo, "src/db/index.ts"), "");
    writeFileSync(join(repo, "src/db/locked/hidden.ts"), "");
    chmodSync(join(repo, "src/db/locked"), 0o000);
    try {
      expect(expandScopeEntry(repo, "src/db")).toEqual(["src/db/index.ts"]);
    } finally {
      chmodSync(join(repo, "src/db/locked"), 0o755);
    }
  });

  test("root-like entries are never walked", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src/anything.ts"), "");
    expect(expandScopeEntry(repo, ".")).toEqual(["."]);
    expect(expandScopeEntry(repo, "/")).toEqual(["/"]);
    expect(expandScopeEntry(repo, "**")).toEqual(["**"]);
  });
});

describe("expandWriteScope", () => {
  test("deduplicates and sorts across every scope entry", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/a"), { recursive: true });
    mkdirSync(join(repo, "src/b"), { recursive: true });
    writeFileSync(join(repo, "src/a/one.ts"), "");
    writeFileSync(join(repo, "src/b/two.ts"), "");
    expect(expandWriteScope(repo, ["src/a", "src/b", "src/a"])).toEqual([
      "src/a/one.ts",
      "src/b/two.ts",
    ]);
  });

  test("an empty write scope expands to no files", () => {
    const repo = fixtureRepo();
    expect(expandWriteScope(repo, [])).toEqual([]);
  });
});
