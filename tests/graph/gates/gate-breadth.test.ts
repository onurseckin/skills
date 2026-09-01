import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  discoverGatePaths,
  gateBreadthWarning,
  looksWholeSuite,
  namesATarget,
  scopeIsNarrow,
} from "../../../olt/scripts/src/graph/gate-breadth.ts";

const vfs = new Set<string>();
const vdirs = new Set<string>();
let rootCounter = 0;
const spies: Array<{ mockRestore: () => void }> = [];
const norm = (p: fs.PathLike) => resolve(String(p)).replace(/\/+$/, "");

beforeEach(() => {
  const oe = fs.existsSync.bind(fs),
    ostat = fs.statSync.bind(fs),
    oreaddir = fs.readdirSync.bind(fs);
  const om = fs.mkdirSync.bind(fs),
    ow = fs.writeFileSync.bind(fs);

  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = norm(p);
      return s.startsWith("/virtual/")
        ? vfs.has(s) ||
            vdirs.has(s) ||
            Array.from(vdirs).some((k) => k.startsWith(`${s}/`)) ||
            Array.from(vfs).some((k) => k.startsWith(`${s}/`))
        : oe(p);
    }),
    spyOn(fs, "statSync").mockImplementation((p: fs.PathLike): fs.Stats => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const isFile = vfs.has(s);
        const isDir =
          vdirs.has(s) ||
          Array.from(vdirs).some((k) => k.startsWith(`${s}/`)) ||
          Array.from(vfs).some((k) => k.startsWith(`${s}/`));
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
  );
});

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  vdirs.clear();
});

function fixtureRepo(): string {
  rootCounter += 1;
  const root = `/virtual/gate-breadth-fixture-${rootCounter}`;
  vdirs.add(root);
  return root;
}

describe("gate breadth", () => {
  test("a runner with no path argument discovers everything", () => {
    expect(looksWholeSuite("bun test")).toBe(true);
    expect(looksWholeSuite("bun run test:unit")).toBe(true);
    expect(looksWholeSuite("cargo test")).toBe(true);
    expect(looksWholeSuite("pytest")).toBe(true);
    expect(looksWholeSuite("vitest")).toBe(true);
    expect(looksWholeSuite("jest")).toBe(true);
  });

  test("a runner pointed at a target is scoped", () => {
    expect(looksWholeSuite("bun test tests/db.test.ts")).toBe(false);
    expect(looksWholeSuite("bun test tests/unit/cli")).toBe(false);
    expect(looksWholeSuite("pytest src/api/test_auth.py")).toBe(false);
  });

  test("flags alone do not make a gate scoped", () => {
    expect(looksWholeSuite("bun test --timeout 30000")).toBe(true);
  });

  test("a strong, target-free verification command is a whole-suite gate whatever verb it uses", () => {
    expect(looksWholeSuite("bun run typecheck")).toBe(true);
    expect(looksWholeSuite("bun run compose:check")).toBe(true);
    expect(looksWholeSuite("bun run audit:catalog")).toBe(true);
    expect(looksWholeSuite("bun run lint")).toBe(true);
  });

  test("a command that isn't a real check at all is not a whole-suite gate", () => {
    expect(looksWholeSuite("echo done")).toBe(false);
    expect(looksWholeSuite("true")).toBe(false);
    expect(looksWholeSuite("./deploy.sh")).toBe(false);
  });

  test("a scope naming concrete paths is narrow; the repository root is not", () => {
    expect(scopeIsNarrow(["src/db"])).toBe(true);
    expect(scopeIsNarrow(["src/db", "src/api"])).toBe(true);
    expect(scopeIsNarrow(["."])).toBe(false);
    expect(scopeIsNarrow(["**"])).toBe(false);
    expect(scopeIsNarrow([])).toBe(false);
  });

  test("warns only when a broad gate meets a narrow scope", () => {
    const warning = gateBreadthWarning("bun test", ["src/db"]);
    expect(warning).toContain("whole-suite");
    expect(warning).toContain("src/db");
    expect(warning).toContain("--completion-gate");
  });

  test("stays silent when the gate is already scoped", () => {
    expect(gateBreadthWarning("bun test tests/db.test.ts", ["src/db"])).toBeUndefined();
  });

  test("stays silent when the scope really is the whole repository", () => {
    expect(gateBreadthWarning("bun test", ["."])).toBeUndefined();
  });

  test("discovers a test file co-located beside the scope it covers", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/db"), { recursive: true });
    writeFileSync(join(repo, "src/db/index.ts"), "");
    writeFileSync(join(repo, "src/db/index.test.ts"), "");
    expect(discoverGatePaths(repo, ["src/db"])).toEqual(["src/db/index.test.ts"]);
  });

  test("discovers a co-located tests directory under any of its common names", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/api/__tests__"), { recursive: true });
    expect(discoverGatePaths(repo, ["src/api"])).toEqual(["src/api/__tests__"]);
  });

  test("discovers a mirrored directory that drops the scope's own src segment", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/graph"), { recursive: true });
    mkdirSync(join(repo, "tests/unit/graph"), { recursive: true });
    expect(discoverGatePaths(repo, ["src/graph"])).toEqual(["tests/unit/graph"]);
  });

  test("discovers a same-named test file beside the mirrored location", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/db"), { recursive: true });
    mkdirSync(join(repo, "tests"), { recursive: true });
    writeFileSync(join(repo, "tests/db.test.ts"), "");
    expect(discoverGatePaths(repo, ["src/db"])).toEqual(["tests/db.test.ts"]);
  });

  test("mirrors the scope's full path when it carries no src segment", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "packages/api"), { recursive: true });
    mkdirSync(join(repo, "tests/unit/packages/api"), { recursive: true });
    expect(discoverGatePaths(repo, ["packages/api"])).toEqual(["tests/unit/packages/api"]);
  });

  test("finds nothing for a scope with no test under any checked convention", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "src/lonely"), { recursive: true });
    expect(discoverGatePaths(repo, ["src/lonely"])).toEqual([]);
  });

  test("finds nothing for a scope that does not exist on disk, and never throws", () => {
    const repo = fixtureRepo();
    expect(discoverGatePaths(repo, ["src/never-created"])).toEqual([]);
  });

  test("skips the repository root instead of mirroring it onto every test root", () => {
    const repo = fixtureRepo();
    mkdirSync(join(repo, "tests"), { recursive: true });
    expect(discoverGatePaths(repo, ["."])).toEqual([]);
  });

  describe("namesATarget", () => {
    test("a path or glob token names a target", () => {
      expect(namesATarget("src/db")).toBe(true);
      expect(namesATarget("tests/db.test.ts")).toBe(true);
      expect(namesATarget("*.ts")).toBe(true);
    });

    test("a bare word or a flag does not name a target", () => {
      expect(namesATarget("typecheck")).toBe(false);
      expect(namesATarget("run")).toBe(false);
      expect(namesATarget("--scope=t1")).toBe(false);
      expect(namesATarget("--watch")).toBe(false);
    });
  });
});
