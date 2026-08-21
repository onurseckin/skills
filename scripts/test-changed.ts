/**
 * Fast Affected / Changed Unit Test Runner with Caching
 * Runs only test files affected by changes since origin/main or HEAD~1.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const ARGS = process.argv.slice(2);
const RUN_ALL = ARGS.includes("--all");
const WITH_COVERAGE = ARGS.includes("--coverage");

function gitOutput(args: string[]): string {
  try {
    const res = spawnSync("git", args, { encoding: "utf-8" });
    return (res.stdout ?? "").trim();
  } catch {
    return "";
  }
}

function getChangedFiles(): string[] {
  const files = new Set<string>();

  // 1. Uncommitted working tree & staged changes
  const uncommitted = gitOutput(["diff", "--name-only"]);
  const staged = gitOutput(["diff", "--cached", "--name-only"]);
  for (const line of `${uncommitted}\n${staged}`.split("\n")) {
    if (line.trim()) files.add(line.trim());
  }

  // 2. Committed changes against upstream or previous commit
  let diffBase = "";
  const mergeBase = gitOutput(["merge-base", "origin/main", "HEAD"]);
  if (mergeBase) {
    diffBase = `${mergeBase}...HEAD`;
  } else {
    diffBase = "HEAD~1";
  }

  const branchDiff = gitOutput(["diff", "--name-only", diffBase]);
  for (const line of branchDiff.split("\n")) {
    if (line.trim()) files.add(line.trim());
  }

  return Array.from(files);
}

function findAllTestFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...findAllTestFiles(full));
    } else if (entry.endsWith(".test.ts") || entry.endsWith(".spec.ts")) {
      results.push(full);
    }
  }
  return results;
}

function resolveAffectedTestFiles(changedFiles: string[]): { all: boolean; testFiles: string[] } {
  if (RUN_ALL) return { all: true, testFiles: [] };

  const CRITICAL_GLOBAL_FILES = [
    "package.json",
    "bunfig.toml",
    "tsconfig.json",
    "lefthook.yml",
    "scripts/test-changed.ts",
  ];

  for (const file of changedFiles) {
    if (CRITICAL_GLOBAL_FILES.includes(file)) {
      console.log(`[test-changed] Critical config file changed (${file}), running full test suite.`);
      return { all: true, testFiles: [] };
    }
  }

  const allTests = findAllTestFiles("tests/unit");
  const affected = new Set<string>();

  for (const file of changedFiles) {
    // If a test file itself changed
    if (file.startsWith("tests/unit/") && (file.endsWith(".test.ts") || file.endsWith(".spec.ts"))) {
      if (existsSync(file)) affected.add(file);
      continue;
    }

    // If a TypeScript source file changed
    if (file.endsWith(".ts") || file.endsWith(".tsx")) {
      const stem = basename(file, extname(file));
      // Look for directly matching test file names
      for (const testFile of allTests) {
        const testStem = basename(testFile);
        if (testStem.includes(stem)) {
          affected.add(testFile);
        }
      }
    }
  }

  return { all: false, testFiles: Array.from(affected) };
}

async function run(): Promise<void> {
  const changed = getChangedFiles();
  const { all, testFiles } = resolveAffectedTestFiles(changed);

  if (!all && testFiles.length === 0) {
    console.log("[test-changed] No test files affected by current changes. Skipping test execution.");
    process.exit(0);
  }

  const testArgs = [
    "test",
    "--timeout",
    "30000",
    "--parallel",
    "--no-isolate",
    ...(WITH_COVERAGE ? ["--coverage"] : []),
  ];

  if (all) {
    testArgs.push("tests/unit");
    console.log(`[test-changed] Running full test suite (${all ? "all files" : testFiles.length + " files"})...`);
  } else {
    testArgs.push(...testFiles);
    console.log(`[test-changed] Running ${testFiles.length} affected test file(s):`);
    for (const f of testFiles) console.log(`  - ${f}`);
  }

  const result = spawnSync("bun", testArgs, {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  process.exit(result.status ?? (result.error ? 1 : 0));
}

run().catch((err: unknown) => {
  console.error("[test-changed] Execution error:", err);
  process.exit(1);
});
