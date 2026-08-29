import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  isTestEnvironment,
  resolveDefectsPath,
  resolveScratchDir,
} from "../../../olt/scripts/src/core/shared/paths.ts";
import {
  appendDefectLogEntry,
  parseDefectLog,
  resolveCanonicalDefectLogPath,
  resolveDefectLogPath,
  type DefectEntry,
} from "../../../olt/scripts/src/mind/defects/index.ts";

// Fixtures live under the limo scratch tree, never under skills' own .olt/,
// so a bug in the resolvers under test can never touch the live 252-row ledger.
const FIXTURE_ROOT = "/Users/onurseckinsenoglu/repos/limo/.tmp/harness-defects";

const createdDirs: string[] = [];

function fixtureDir(prefix: string): string {
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_ROOT, prefix));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup only
    }
  }
});

// Runs `fn` with process.cwd() pointed at `dir`, always restoring the real
// cwd afterwards so the drift never leaks into later tests or gate steps.
function withCwd<T>(dir: string, fn: () => T): T {
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(originalCwd);
  }
}

describe("defect ledger write/read path unification", () => {
  test("writer and reader resolvers converge on the same path from a cwd that differs from the repo root", () => {
    // bun:test forces isTestEnvironment() true for the whole process (argv
    // contains "test"), so resolveDefectsPath() always redirects to scratch
    // here -- that's the coincidence a naive gate could ride to a false
    // pass. resolveCanonicalDefectLogPath() at HEAD ignores that guard
    // entirely and joins process.cwd() directly, so pointing cwd at a
    // fixture that is neither the repo root nor the scratch dir proves the
    // divergence is real: HEAD yields two different concrete paths for the
    // one logical ledger, and the fix makes them the same call.
    const driftedCwd = fixtureDir("drifted-cwd-");

    const { writerPath, readerPath } = withCwd(driftedCwd, () => ({
      writerPath: resolveCanonicalDefectLogPath(),
      readerPath: resolveDefectsPath(),
    }));

    expect(writerPath).toBe(readerPath);
  });

  test("a defect appended from a drifted cwd is visible through the normal defects reader", () => {
    const driftedCwd = fixtureDir("drifted-cwd-write-");
    const entry: DefectEntry = {
      id: `defect-path-unification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "path_unification_probe",
      severity: "info",
      timestamp: new Date().toISOString(),
      category: "code_defect",
      status: "open",
      observation: "probe entry for defect ledger split-brain path regression",
      remediation: "n/a",
    };

    withCwd(driftedCwd, () => {
      // Mirrors what a capsule-root-less caller of resolveCanonicalDefectLogPath
      // would produce: at HEAD this lands under the drifted cwd, invisible to
      // the reader; after the fix it lands wherever resolveDefectsPath() says.
      appendDefectLogEntry(entry, { customPath: resolveCanonicalDefectLogPath() });
    });

    const readerPath = resolveDefectsPath();
    expect(existsSync(readerPath)).toBe(true);

    const parsed = parseDefectLog(readFileSync(readerPath, "utf8"));
    expect(parsed.some((d) => d.id === entry.id)).toBe(true);
  });

  test("resolveCanonicalDefectLogPath still honours an explicit customRoot exactly like resolveDefectsPath honours repoRoot", () => {
    const explicitRoot = fixtureDir("explicit-root-");

    expect(resolveCanonicalDefectLogPath(explicitRoot)).toBe(resolveDefectsPath(explicitRoot));
    expect(resolveCanonicalDefectLogPath(explicitRoot)).toBe(
      join(explicitRoot, ".olt", "defects.jsonl"),
    );
  });

  test("resolveDefectLogPath still honours an explicit customPath as a literal path override", () => {
    const explicitFile = join(fixtureDir("explicit-path-"), "custom-defects.jsonl");

    expect(resolveDefectLogPath(explicitFile)).toBe(resolve(explicitFile));
    expect(resolveDefectLogPath(explicitFile)).toBe(resolveDefectsPath(undefined, explicitFile));
  });

  test("resolveDefectLogPath still resolves into the scratch dir under isTestEnvironment() with no arguments", () => {
    expect(isTestEnvironment()).toBe(true);
    expect(resolveDefectLogPath()).toBe(join(resolveScratchDir(), ".olt", "defects.jsonl"));
  });
});
