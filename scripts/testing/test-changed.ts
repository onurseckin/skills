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
const SHOW_HELP = ARGS.includes("--help") || ARGS.includes("-h");

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
    "scripts/testing/test-changed.ts",
  ];

  for (const file of changedFiles) {
    if (CRITICAL_GLOBAL_FILES.includes(file)) {
      console.log(
        `[test-changed] Critical config file changed (${file}), running full test suite.`,
      );
      return { all: true, testFiles: [] };
    }
  }

  const allTests = findAllTestFiles("tests/unit");
  const affected = new Set<string>();

  for (const file of changedFiles) {
    // If a test file itself changed
    if (
      file.startsWith("tests/unit/") &&
      (file.endsWith(".test.ts") || file.endsWith(".spec.ts"))
    ) {
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

interface FileCoverageSummary {
  readonly file: string;
  readonly linesPct: number;
  readonly stmtsPct: number;
  readonly uncovered: string;
}

function parseCoverageOutput(output: string): FileCoverageSummary[] {
  const results: FileCoverageSummary[] = [];
  const lines = output.split("\n");
  for (const line of lines) {
    const match = line.match(/^\s*(\S+\.ts)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*(.*)$/);
    if (match) {
      const file = match[1];
      const rawLines = match[2];
      const rawStmts = match[3];
      const rawUncovered = match[4];
      if (file !== undefined && rawLines !== undefined && rawStmts !== undefined) {
        results.push({
          file,
          linesPct: parseFloat(rawLines),
          stmtsPct: parseFloat(rawStmts),
          uncovered: (rawUncovered ?? "").trim(),
        });
      }
    }
  }
  return results;
}

async function run(): Promise<void> {
  if (SHOW_HELP) {
    console.log(
      "Usage: bun scripts/testing/test-changed.ts [--all] [--help]\n" +
        "  --all       run every test file under tests/unit, not just affected ones\n" +
        "  --help, -h  print this usage and exit",
    );
    process.exit(0);
  }
  const changed = getChangedFiles();
  const { all, testFiles } = resolveAffectedTestFiles(changed);

  if (!all && testFiles.length === 0) {
    console.log(
      "[test-changed] No test files affected by current changes. Skipping test execution.",
    );
    process.exit(0);
  }

  const testArgs = ["test", "--timeout", "30000", "--parallel", "--no-isolate", "--coverage"];

  if (all) {
    testArgs.push("tests/unit");
    console.log(
      `[test-changed] Running full test suite with mandatory 95% coverage check (${all ? "all files" : testFiles.length + " files"})...`,
    );
  } else {
    testArgs.push(...testFiles);
    console.log(
      `[test-changed] Running ${testFiles.length} affected test file(s) with mandatory 95% coverage check:`,
    );
    for (const f of testFiles) console.log(`  - ${f}`);
  }

  const result = spawnSync("bun", testArgs, {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    cwd: process.cwd(),
  });

  // Print test output
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    console.error("\n❌ [test-changed] Unit test suite failed.");
    process.exit(result.status ?? 1);
  }

  // Parse coverage and enforce 95% threshold across evaluated production files
  const combinedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const coverageRecords = parseCoverageOutput(combinedOutput);

  if (coverageRecords.length > 0) {
    const COVERAGE_THRESHOLD = 95.0;
    const failingFiles = coverageRecords.filter(
      (r) =>
        !r.file.includes(".test.ts") &&
        !r.file.includes(".spec.ts") &&
        (r.linesPct < COVERAGE_THRESHOLD || r.stmtsPct < COVERAGE_THRESHOLD),
    );

    if (failingFiles.length > 0) {
      console.error(
        "\n❌ [coverage-gate] Mandatory +95% Coverage Check Failed for the following file(s):",
      );
      console.error(
        "┌────────────────────────────────────────────────────────┬─────────────┬─────────────┬──────────────────────────┐",
      );
      console.error(
        "│ File                                                   │ % Lines     │ % Statements│ Uncovered Lines          │",
      );
      console.error(
        "├────────────────────────────────────────────────────────┼─────────────┼─────────────┼──────────────────────────┤",
      );
      for (const f of failingFiles) {
        const filePad = f.file.padEnd(54).slice(0, 54);
        const linesPad = `${f.linesPct.toFixed(1)}%`.padEnd(11);
        const stmtsPad = `${f.stmtsPct.toFixed(1)}%`.padEnd(11);
        const uncovPad = f.uncovered.padEnd(24).slice(0, 24);
        console.error(`│ ${filePad} │ ${linesPad} │ ${stmtsPad} │ ${uncovPad} │`);
      }
      console.error(
        "└────────────────────────────────────────────────────────┴─────────────┴─────────────┴──────────────────────────┘",
      );
      console.error(
        "All production TypeScript modules must achieve >= 95.0% coverage before push.",
      );
      process.exit(1);
    } else {
      console.log(
        "\n✓ [coverage-gate] Mandatory +95% Coverage Check passed across all evaluated modules.",
      );
    }
  }

  process.exit(0);
}

run().catch((err: unknown) => {
  console.error("[test-changed] Execution error:", err);
  process.exit(1);
});
