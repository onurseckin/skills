/**
 * Fast Affected / Changed Unit Test Runner with Caching
 * Runs only test files affected by changes since origin/main or HEAD~1.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

export function gitOutput(args: string[]): string {
  try {
    const res = spawnSync("git", args, { encoding: "utf-8" });
    return (res.stdout ?? "").trim();
  } catch {
    return "";
  }
}

export function parseDiffOutput(diffText: string): string[] {
  const lines = diffText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return Array.from(new Set(lines));
}

export function parseGitStatusPorcelain(statusText: string): string[] {
  const files = new Set<string>();
  for (const rawLine of statusText.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^[MADRCU?!]{1,2}\s+(.+)$/);
    if (match?.[1]) {
      const raw = match[1];
      const target = (raw.includes(" -> ") ? raw.split(" -> ")[1] : raw)?.trim();
      if (target) files.add(target);
    }
  }
  return Array.from(files);
}

export function parseUnifiedDiffHeaders(rawDiff: string): string[] {
  const files = new Set<string>();
  for (const line of rawDiff.split("\n")) {
    const gitMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitMatch?.[2]) {
      files.add(gitMatch[2].trim());
      continue;
    }
    const plusMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (plusMatch?.[1] && plusMatch[1] !== "/dev/null") files.add(plusMatch[1].trim());
  }
  return Array.from(files);
}

export function getChangedFiles(customGitOutput?: (args: string[]) => string): string[] {
  const gitFn = customGitOutput ?? gitOutput;
  const uncommitted = gitFn(["diff", "--name-only"]);
  const staged = gitFn(["diff", "--cached", "--name-only"]);
  const mergeBase = gitFn(["merge-base", "origin/main", "HEAD"]);
  const diffBase = mergeBase ? `${mergeBase}...HEAD` : "HEAD~1";
  const branchDiff = gitFn(["diff", "--name-only", diffBase]);
  return parseDiffOutput(`${uncommitted}\n${staged}\n${branchDiff}`);
}

export function findAllTestFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) results.push(...findAllTestFiles(full));
    else if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) results.push(full);
  }
  return results;
}

export function buildTestIndex(testFiles: readonly string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const testPath of testFiles) {
    const stem = basename(testPath)
      .replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, "")
      .toLowerCase();
    const existing = index.get(stem);
    if (existing) existing.push(testPath);
    else index.set(stem, [testPath]);
  }
  return index;
}

const CRITICAL_GLOBAL_FILES = new Set(["package.json", "bunfig.toml", "tsconfig.json"]);

export function resolveAffectedTestFiles(
  changedFiles: readonly string[],
  runAll = false,
  unitTestDir = "tests",
  allTestsOverride?: readonly string[],
): { all: boolean; testFiles: string[] } {
  const allTests = allTestsOverride ? Array.from(allTestsOverride) : findAllTestFiles(unitTestDir);
  if (runAll) return { all: true, testFiles: allTests };

  for (const file of changedFiles) {
    if (CRITICAL_GLOBAL_FILES.has(file)) {
      console.log(
        `[test-changed] Critical config file changed (${file}), running full test suite.`,
      );
      return { all: true, testFiles: allTests };
    }
  }

  const testIndex = buildTestIndex(allTests);
  const affected = new Set<string>();

  for (const file of changedFiles) {
    if (
      (file.startsWith("tests/") || file.startsWith(unitTestDir)) &&
      /\.(test|spec)\.(ts|tsx)$/.test(file)
    ) {
      if (allTestsOverride ? allTests.includes(file) : existsSync(file)) {
        affected.add(file);
      }
      continue;
    }

    if (/\.(ts|tsx|js|jsx)$/.test(file)) {
      const stem = basename(file, extname(file)).toLowerCase();
      const directMatches = testIndex.get(stem);
      if (directMatches) {
        for (const m of directMatches) affected.add(m);
      }
      for (const testFile of allTests) {
        if (basename(testFile).toLowerCase().includes(stem)) {
          affected.add(testFile);
        }
      }
    }
  }

  return { all: false, testFiles: Array.from(affected) };
}

export interface FileCoverageSummary {
  readonly file: string;
  readonly linesPct: number;
  readonly stmtsPct: number;
  readonly uncovered: string;
}

export function parseCoverageOutput(output: string): FileCoverageSummary[] {
  const results: FileCoverageSummary[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*(\S+\.ts)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*(.*)$/);
    if (match?.[1] && match[2] && match[3]) {
      results.push({
        file: match[1],
        linesPct: parseFloat(match[2]),
        stmtsPct: parseFloat(match[3]),
        uncovered: (match[4] ?? "").trim(),
      });
    }
  }
  return results;
}

export async function run(argvArgs: string[] = process.argv.slice(2)): Promise<number> {
  const showHelp = argvArgs.includes("--help") || argvArgs.includes("-h");
  const runAll = argvArgs.includes("--all");

  if (showHelp) {
    console.log(
      "Usage: bun scripts/testing/test-changed.ts [--all] [--help]\n" +
        "  --all       run every test file under tests, not just affected ones\n" +
        "  --help, -h  print this usage and exit",
    );
    return 0;
  }
  const changed = getChangedFiles();
  const { all, testFiles } = resolveAffectedTestFiles(changed, runAll);

  if (!all && testFiles.length === 0) {
    console.log(
      "[test-changed] No test files affected by current changes. Skipping test execution.",
    );
    return 0;
  }

  const isCoverage = argvArgs.includes("--coverage");
  const testArgs = ["test", "--timeout", "30000"];
  if (isCoverage) testArgs.push("--coverage");
  const defaultDir = "tests";
  const targetFiles = testFiles.length > 0 ? testFiles : findAllTestFiles(defaultDir);

  if (targetFiles.length === 0) {
    console.log("[test-changed] No test files found. Skipping test execution.");
    return 0;
  }

  let combinedStdout = "";
  let combinedStderr = "";
  const BATCH_SIZE = 20;

  for (let i = 0; i < targetFiles.length; i += BATCH_SIZE) {
    const batch = targetFiles.slice(i, i + BATCH_SIZE);
    const batchArgs = [...testArgs, ...batch];
    const result = spawnSync("bun", batchArgs, {
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      cwd: process.cwd(),
      env: { ...process.env, OLT_VIRTUAL_FS: "1", BUN_ENV: "test" },
    });

    if (result.stdout) {
      process.stdout.write(result.stdout);
      combinedStdout += result.stdout;
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
      combinedStderr += result.stderr;
    }

    if (result.status !== 0) {
      console.error("\n❌ [test-changed] Unit test batch failed.");
      return result.status ?? 1;
    }
  }

  const coverageRecords = parseCoverageOutput(`${combinedStdout}\n${combinedStderr}`);
  if (coverageRecords.length > 0) {
    const COVERAGE_THRESHOLD = 95.0;
    const failingFiles = coverageRecords.filter(
      (r) =>
        !r.file.includes(".test.ts") &&
        !r.file.includes(".spec.ts") &&
        (r.linesPct < COVERAGE_THRESHOLD || r.stmtsPct < COVERAGE_THRESHOLD),
    );

    if (failingFiles.length > 0) {
      console.error("\n❌ [coverage-gate] Mandatory +95% Coverage Check Failed for file(s):");
      for (const f of failingFiles) {
        console.error(
          `  - ${f.file}: Lines ${f.linesPct}%, Stmts ${f.stmtsPct}% (Uncovered: ${f.uncovered})`,
        );
      }
      return 1;
    }
    console.log(
      "\n✓ [coverage-gate] Mandatory +95% Coverage Check passed across all evaluated modules.",
    );
  }

  return 0;
}

export function computeIsMain(
  mainVal: boolean = import.meta.main,
  entryArg: string | undefined = process.argv[1],
): boolean {
  if (mainVal) return true;
  if (!entryArg) return false;
  return (
    entryArg.endsWith("scripts/testing/test-changed.ts") ||
    entryArg.endsWith("scripts/testing/test-changed")
  );
}

export async function main(argvArgs: string[] = process.argv.slice(2)): Promise<number> {
  try {
    return await run(argvArgs);
  } catch (err) {
    console.error("[test-changed] Execution error:", err);
    return 1;
  }
}

if (computeIsMain()) {
  const code = await main();
  process.exit(code);
}
