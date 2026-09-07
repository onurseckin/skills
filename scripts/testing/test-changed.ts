import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { DEFAULT_COVERAGE_THRESHOLD } from "./reporting/index.ts";
import { auditTestPurity } from "./guardrails/index.ts";
import type { PurityAuditOptions, PurityAuditResult } from "./guardrails/index.ts";
import { detectSuiteLoadFailures, formatSuiteLoadFailureReport } from "./runner/index.ts";
import {
  buildDataReferenceIndex,
  isDataFile,
  selectTestsForDataFile,
  type DataReferenceIndex,
} from "./selection/index.ts";
import { inspectRepoPolicy, isTestingEnabled } from "../../olt/scripts/src/policy/index.ts";

export function gitOutput(args: string[]): string {
  try {
    return (spawnSync("git", args, { encoding: "utf-8" }).stdout ?? "").trim();
  } catch {
    return "";
  }
}

export function parseDiffOutput(diffText: string): string[] {
  return [
    ...new Set(
      diffText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    ),
  ];
}

export function parseGitStatusPorcelain(statusText: string): string[] {
  const files = new Set<string>();
  for (const raw of statusText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    const match = raw.match(/^[MADRCU?!]{1,2}\s+(.+)$/);
    if (match?.[1]) {
      const target = (match[1].includes(" -> ") ? match[1].split(" -> ")[1] : match[1])?.trim();
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
  const base = gitFn(["merge-base", "origin/main", "HEAD"]);
  return parseDiffOutput(
    `${uncommitted}\n${staged}\n${gitFn(["diff", "--name-only", base ? `${base}...HEAD` : "HEAD~1"])}`,
  );
}

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".olt",
  "capsules",
  ".capsules",
  "dist",
  "coverage",
  "scratch",
  "artifacts",
]);

export function findAllTestFiles(dir: string = "."): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const full = dir === "." || dir === "" ? entry.name : join(dir, entry.name);
      if (entry.isDirectory()) results.push(...findAllTestFiles(full));
      else if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) results.push(full);
    }
  } catch {}
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

const CRITICAL_GLOBAL_FILES = new Set("package.json,bunfig.toml,tsconfig.json".split(","));
const GENERIC_STEMS = new Set(
  "validator,index,types,schema,config,runner,manager,client,common,utils".split(","),
);

export function resolveAffectedTestFiles(
  changedFiles: readonly string[],
  runAll = false,
  unitTestDir = ".",
  allTestsOverride?: readonly string[],
  dataReferenceIndex?: DataReferenceIndex,
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
    if (/\.(test|spec)\.(ts|tsx)$/.test(file)) {
      if (allTestsOverride ? allTests.includes(file) : existsSync(file)) {
        affected.add(file);
      }
      continue;
    }

    if (/\.(ts|tsx|js|jsx)$/.test(file)) {
      const stem = basename(file, extname(file)).toLowerCase();
      const isGen = GENERIC_STEMS.has(stem);
      const matchSeg = (p: string) =>
        file
          .split("/")
          .some((s) => s.length > 2 && s !== "src" && s !== "scripts" && p.includes(s));

      for (const m of testIndex.get(stem) ?? []) {
        if (!isGen || matchSeg(m)) affected.add(m);
      }
      for (const t of allTests) {
        if (basename(t).toLowerCase().includes(stem) && (!isGen || matchSeg(t))) affected.add(t);
      }
    }
  }

  const changedDataFiles = changedFiles.filter(isDataFile);
  if (changedDataFiles.length > 0) {
    const dataIndex = dataReferenceIndex ?? buildDataReferenceIndex(allTests);
    for (const file of changedDataFiles) {
      for (const test of selectTestsForDataFile(file, dataIndex)) affected.add(test);
    }
  }

  return { all: false, testFiles: Array.from(affected) };
}

export function resolveChangedTestFiles(
  changedFiles: readonly string[],
  candidateTestFiles: readonly string[],
): string[] {
  const changed = new Set(changedFiles);
  return candidateTestFiles.filter((candidate) => changed.has(candidate));
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

export interface TestChangedPorts {
  readonly auditTestPurity?: (options: PurityAuditOptions) => Promise<PurityAuditResult>;
}

export async function run(
  argvArgs: string[] = process.argv.slice(2),
  ports: TestChangedPorts = {},
): Promise<number> {
  const showHelp = argvArgs.includes("--help") || argvArgs.includes("-h");
  const runAll = argvArgs.includes("--all");

  if (showHelp) {
    console.log(
      "Usage: bun scripts/testing/test-changed.ts [--all] [--help]\n  --all       run every test\n  --help, -h  print usage",
    );
    return 0;
  }
  try {
    const inspection = inspectRepoPolicy();
    if (!isTestingEnabled(inspection.policy)) {
      console.log("[test] Unit testing disabled in repo policy; skipping.");
      return 0;
    }
  } catch {}
  const changed = getChangedFiles();
  const { all, testFiles } = resolveAffectedTestFiles(changed, runAll);

  if (!all && testFiles.length === 0) {
    console.log("[test-changed] No test files affected by changes. Skipping test execution.");
    return 0;
  }

  const testArgs = argvArgs.includes("--coverage")
    ? ["test", "--timeout", "30000", "--coverage"]
    : ["test", "--timeout", "30000"];
  const targetFiles = testFiles.length > 0 ? testFiles : findAllTestFiles();

  if (targetFiles.length === 0) {
    console.log("[test-changed] No test files found. Skipping test execution.");
    return 0;
  }

  const purityTargets = resolveChangedTestFiles(changed, targetFiles);
  if (purityTargets.length > 0) {
    const auditPurity = ports.auditTestPurity ?? auditTestPurity;
    const purityResult = await auditPurity({ files: purityTargets });
    console.log(purityResult.terminalReport);
    if (!purityResult.passed) {
      console.error("\n❌ [purity-guard] Test purity audit failed.");
      return 1;
    }
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

    const loadFailures = detectSuiteLoadFailures(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    if (loadFailures.length > 0) {
      console.error(formatSuiteLoadFailureReport(loadFailures));
      console.error("\n❌ [test-changed] Test file(s) failed to load; run aborted.");
      return 1;
    }

    if (result.status !== 0) {
      console.error("\n❌ [test-changed] Unit test batch failed.");
      return result.status ?? 1;
    }
  }

  const coverageRecords = parseCoverageOutput(`${combinedStdout}\n${combinedStderr}`);
  if (coverageRecords.length > 0) {
    const COVERAGE_THRESHOLD = DEFAULT_COVERAGE_THRESHOLD;
    const failingFiles = coverageRecords.filter(
      (r) =>
        !r.file.includes(".test.ts") &&
        !r.file.includes(".spec.ts") &&
        (r.linesPct < COVERAGE_THRESHOLD || r.stmtsPct < COVERAGE_THRESHOLD),
    );

    if (failingFiles.length > 0) {
      console.error(
        `\n❌ [coverage-gate] Mandatory +${COVERAGE_THRESHOLD}% Coverage Check Failed for file(s):`,
      );
      for (const f of failingFiles) {
        console.error(`  - ${f.file}: Lines ${f.linesPct}%, Stmts ${f.stmtsPct}% (${f.uncovered})`);
      }
      return 1;
    }
    console.log(
      `\n✓ [coverage-gate] Mandatory +${COVERAGE_THRESHOLD}% Coverage Check passed across all evaluated modules.`,
    );
  }

  return 0;
}

export function computeIsMain(
  mainVal: boolean = import.meta.main,
  entryArg: string | undefined = process.argv[1],
): boolean {
  if (mainVal) return true;
  return Boolean(
    entryArg &&
    (entryArg.endsWith("scripts/testing/test-changed.ts") ||
      entryArg.endsWith("scripts/testing/test-changed")),
  );
}

export async function main(
  argvArgs: string[] = process.argv.slice(2),
  ports: TestChangedPorts = {},
): Promise<number> {
  try {
    return await run(argvArgs, ports);
  } catch (err) {
    console.error("[test-changed] Execution error:", err);
    return 1;
  }
}

if (computeIsMain()) {
  const code = await main();
  process.exit(code);
}
