import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  enumerateGlobMatches,
  globToRegExp,
  partitionByGlob,
  slugifyScope,
} from "../../../olt/scripts/src/graph/auto-partition.ts";

const vfs = new Set<string>();
const vdirs = new Set<string>();
const vsymlinks = new Map<string, string>();
const vlocked = new Set<string>();
let repoCounter = 0;
const spies: Array<{ mockRestore: () => void }> = [];

const norm = (p: fs.PathLike): string => resolve(String(p)).replace(/\/+$/, "");

beforeEach(() => {
  const oreaddir = fs.readdirSync.bind(fs),
    ochmod = fs.chmodSync.bind(fs);
  const omkdir = fsp.mkdir.bind(fsp),
    owrite = fsp.writeFile.bind(fsp);
  const osymlink = fsp.symlink.bind(fsp),
    orm = fsp.rm.bind(fsp),
    omkdtemp = fsp.mkdtemp.bind(fsp);

  spies.push(
    spyOn(fs, "chmodSync").mockImplementation((p, mode) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        if (mode === 0o000 || mode === 0) vlocked.add(s);
        else vlocked.delete(s);
        return;
      }
      ochmod(p, mode);
    }),
    spyOn(fs, "readdirSync").mockImplementation((p: fs.PathLike, opt?: unknown): unknown => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        if (vlocked.has(s)) throw new Error(`EACCES: permission denied, scandir '${s}'`);
        const prefix = `${s}/`;
        const entries = new Map<string, { isDir: boolean; isSym: boolean }>();
        for (const k of vfs) {
          if (k.startsWith(prefix) && k.length > prefix.length) {
            const rel = k.slice(prefix.length);
            const firstSeg = rel.split("/")[0]!;
            entries.set(firstSeg, { isDir: rel.includes("/"), isSym: false });
          }
        }
        for (const d of vdirs) {
          if (d.startsWith(prefix) && d.length > prefix.length) {
            const rel = d.slice(prefix.length);
            const firstSeg = rel.split("/")[0]!;
            if (!entries.has(firstSeg)) entries.set(firstSeg, { isDir: true, isSym: false });
          }
        }
        for (const [sym, target] of vsymlinks) {
          if (sym.startsWith(prefix) && sym.length > prefix.length) {
            const rel = sym.slice(prefix.length);
            const firstSeg = rel.split("/")[0]!;
            entries.set(firstSeg, { isDir: false, isSym: true });
          }
        }
        const withTypes =
          typeof opt === "object" &&
          opt !== null &&
          "withFileTypes" in opt &&
          Boolean((opt as { withFileTypes?: boolean }).withFileTypes);
        if (withTypes) {
          return Array.from(entries.entries()).map(([name, meta]) => ({
            name,
            isDirectory: () => meta.isDir,
            isFile: () => !meta.isDir && !meta.isSym,
            isSymbolicLink: () => meta.isSym,
          })) as unknown as fs.Dirent[];
        }
        return Array.from(entries.keys());
      }
      return oreaddir(p, opt as Parameters<typeof oreaddir>[1]);
    }),
    spyOn(fsp, "mkdir").mockImplementation(async (p) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vdirs.add(s);
        return undefined;
      }
      return omkdir(p);
    }),
    spyOn(fsp, "writeFile").mockImplementation(async (p) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vfs.add(s);
        return;
      }
      return owrite(p, "");
    }),
    spyOn(fsp, "symlink").mockImplementation(async (target, path) => {
      const s = norm(path);
      if (s.startsWith("/virtual/")) {
        vsymlinks.set(s, String(target));
        return;
      }
      return osymlink(target, path);
    }),
    spyOn(fsp, "rm").mockImplementation(async (p) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vfs.delete(s);
        vdirs.delete(s);
        vsymlinks.delete(s);
        vlocked.delete(s);
        for (const k of Array.from(vfs)) if (k.startsWith(`${s}/`)) vfs.delete(k);
        for (const d of Array.from(vdirs)) if (d.startsWith(`${s}/`)) vdirs.delete(d);
        return;
      }
      return orm(p, { recursive: true, force: true });
    }),
  );
});

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  vdirs.clear();
  vsymlinks.clear();
  vlocked.clear();
});

async function fixtureRepo(name: string): Promise<string> {
  repoCounter += 1;
  const repo = `/virtual/auto-partition-${name}-${repoCounter}`;
  vdirs.add(repo);
  return repo;
}
const mkdir = async (p: string, _opt?: unknown) => {
  vdirs.add(norm(p));
};
const writeFile = async (p: string, _d?: unknown) => {
  vfs.add(norm(p));
};
const symlink = async (target: string, path: string) => {
  vsymlinks.set(norm(path), String(target));
};
const mkdtemp = async (prefix: string) => fixtureRepo("tmp");
const chmodSync = (p: string, mode: number) => {
  const s = norm(p);
  if (mode === 0o000 || mode === 0) vlocked.add(s);
  else vlocked.delete(s);
};

describe("enumerateGlobMatches", () => {
  test("enumerates what is really on disk, sorted, never a guessed path", async () => {
    const repo = await fixtureRepo("enumerate");
    await mkdir(join(repo, "src/curriculum/mlQuestions"), { recursive: true });
    await writeFile(join(repo, "src/curriculum/mlQuestions/linearAlgebra.ts"), "export {};\n");
    await writeFile(join(repo, "src/curriculum/mlQuestions/calculus.ts"), "export {};\n");
    await writeFile(join(repo, "src/curriculum/mlQuestions/notes.md"), "# notes\n");

    const matches = enumerateGlobMatches(repo, "src/curriculum/mlQuestions/*.ts");
    expect(matches).toEqual([
      "src/curriculum/mlQuestions/calculus.ts",
      "src/curriculum/mlQuestions/linearAlgebra.ts",
    ]);
  });

  test("skips node_modules, .git and .capsules", async () => {
    const repo = await fixtureRepo("excluded");
    await mkdir(join(repo, "node_modules/pkg"), { recursive: true });
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(join(repo, ".olt/capsules/run-1"), { recursive: true });
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(join(repo, "node_modules/pkg/index.ts"), "export {};\n");
    await writeFile(join(repo, ".git/index.ts"), "export {};\n");
    await writeFile(join(repo, ".olt/capsules/run-1/index.ts"), "export {};\n");
    await writeFile(join(repo, "src/index.ts"), "export {};\n");

    expect(enumerateGlobMatches(repo, "**/*.ts")).toEqual(["src/index.ts"]);
  });

  test("never follows a symlink", async () => {
    const repo = await fixtureRepo("symlink");
    const outside = await fixtureRepo("outside");
    await writeFile(join(outside, "secret.ts"), "export {};\n");
    await mkdir(join(repo, "src"), { recursive: true });
    await symlink(outside, join(repo, "src/linked"), "dir");

    expect(enumerateGlobMatches(repo, "**/*.ts")).toEqual([]);
  });

  test("an unreadable subdirectory is skipped rather than crashing the walk", async () => {
    const repo = await fixtureRepo("locked");
    await mkdir(join(repo, "src/locked"), { recursive: true });
    await writeFile(join(repo, "src/allowed.ts"), "export {};\n");
    await writeFile(join(repo, "src/locked/hidden.ts"), "export {};\n");
    chmodSync(join(repo, "src/locked"), 0o000);
    try {
      expect(enumerateGlobMatches(repo, "**/*.ts")).toEqual(["src/allowed.ts"]);
    } finally {
      chmodSync(join(repo, "src/locked"), 0o755);
    }
  });
});

describe("partitionByGlob", () => {
  test("one entry per matched file by default", async () => {
    const repo = await fixtureRepo("per-file");
    await mkdir(join(repo, "src/domains"), { recursive: true });
    await writeFile(join(repo, "src/domains/a.ts"), "export {};\n");
    await writeFile(join(repo, "src/domains/b.ts"), "export {};\n");

    const entries = partitionByGlob(repo, "src/domains/*.ts", "file");
    expect(entries).toEqual([
      { scope: "src/domains/a.ts", files: ["src/domains/a.ts"] },
      { scope: "src/domains/b.ts", files: ["src/domains/b.ts"] },
    ]);
  });

  test("one entry per directory when grouped", async () => {
    const repo = await fixtureRepo("per-directory");
    await mkdir(join(repo, "src/domains/alpha"), { recursive: true });
    await mkdir(join(repo, "src/domains/beta"), { recursive: true });
    await writeFile(join(repo, "src/domains/alpha/one.ts"), "export {};\n");
    await writeFile(join(repo, "src/domains/alpha/two.ts"), "export {};\n");
    await writeFile(join(repo, "src/domains/beta/one.ts"), "export {};\n");

    const entries = partitionByGlob(repo, "src/domains/**/*.ts", "directory");
    expect(entries).toEqual([
      {
        scope: "src/domains/alpha",
        files: ["src/domains/alpha/one.ts", "src/domains/alpha/two.ts"],
      },
      { scope: "src/domains/beta", files: ["src/domains/beta/one.ts"] },
    ]);
  });

  test("refuses a glob that matches nothing on disk rather than emitting zero tasks silently", async () => {
    const repo = await fixtureRepo("empty");
    expect(() => partitionByGlob(repo, "src/nowhere/*.ts", "file")).toThrow(
      "matched no files under",
    );
  });
});

describe("slugifyScope", () => {
  test("replaces non-alphanumeric runs with a single hyphen and trims the ends", () => {
    expect(slugifyScope("src/domains/linear-algebra.ts")).toBe("src-domains-linear-algebra-ts");
  });

  test("refuses a scope with no alphanumeric characters rather than emitting a blank task id", () => {
    expect(() => slugifyScope("...")).toThrow("has no usable characters for a task id");
    expect(() => slugifyScope("///")).toThrow("has no usable characters for a task id");
  });
});
