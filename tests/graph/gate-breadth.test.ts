import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverGatePaths,
  gateBreadthWarning,
  looksWholeSuite,
  namesATarget,
  scopeIsNarrow,
} from "../../olt/scripts/src/graph/gate-breadth.ts";

/** A throwaway repository tree so discovery hits real, verifiable files rather than an assumption. */
function fixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "gate-breadth-fixture-"));
  roots.push(root);
  return root;
}
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

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

  // A6: measured against 29 real task gates from six live capsule runs, the old verb allowlist
  // (test/check/spec/vitest/jest/pytest/cargo) caught 4 of 29 and missed the four commands that
  // actually gated those runs — `bun run typecheck` alone gated 19 of the 29. None of the four is a
  // "test" by name; all four are target-free, whole-repository commands and must be caught by the
  // same principle that catches a bare `vitest`, not by adding four more words to a list that will
  // always be one tool behind.
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

  // namesATarget is exported for graph/plan-audit.ts's A3-gate-discrimination structural gate
  // comparison (executable, subcommand, targets) — a flag must never count as a target.
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
