import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { auditSourceCode } from "./ast-checker.ts";
import { allowanceAppliesTo, EMPTY_PURITY_ALLOWANCE, readPurityAllowance } from "./allowance.ts";
import { buildAuditResult } from "./reporter.ts";
import type {
  PurityAllowance,
  PurityAuditOptions,
  PurityAuditRequest,
  PurityAuditResult,
  PurityAuditScope,
  PurityViolation,
} from "./types.ts";

export interface ExtendedPurityAuditOptions extends PurityAuditOptions {
  readonly reportOnly?: boolean | undefined;
  readonly scope?: PurityAuditScope | undefined;
  readonly rootDir?: string | undefined;
}

export function getStagedTestFiles(reportOnly = false): string[] {
  try {
    const res = spawnSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf-8" });
    const pattern = reportOnly ? /\.(ts|tsx)$/ : /\.(test|spec)\.(ts|tsx)$/;
    return (res.stdout ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((file) => pattern.test(file) && existsSync(file));
  } catch {
    return [];
  }
}

const IGNORED_DISCOVERY_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  "scratch",
  "artifacts",
  "capsules",
  "runtime",
]);

export function findTestDirectories(dir = "."): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read directory '${dir}': ${message}`);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || IGNORED_DISCOVERY_DIRS.has(entry.name)) {
      continue;
    }
    const full = dir === "." ? entry.name : join(dir, entry.name);
    if (entry.name === "tests" || entry.name === "test") {
      results.push(full);
    } else {
      results.push(...findTestDirectories(full));
    }
  }
  return results.sort();
}

export function getAllTestFiles(dir?: string, reportOnly = false): string[] {
  if (dir !== undefined) {
    if (!existsSync(dir)) return [];
    const results: string[] = [];
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read directory '${dir}': ${message}`);
    }
    const pattern = reportOnly ? /\.(ts|tsx)$/ : /\.(test|spec)\.(ts|tsx)$/;
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...getAllTestFiles(full, reportOnly));
      } else if (pattern.test(entry.name)) {
        results.push(full);
      }
    }
    return results;
  }
  const testDirs = findTestDirectories();
  const allFiles: string[] = [];
  for (const testDir of testDirs) {
    allFiles.push(...getAllTestFiles(testDir, reportOnly));
  }
  return allFiles;
}

export function resolveAuditRequest(
  optionsOrFiles?: ExtendedPurityAuditOptions | string[],
): PurityAuditRequest {
  if (Array.isArray(optionsOrFiles)) {
    return { scope: "explicit", files: [...optionsOrFiles] };
  }
  if (optionsOrFiles?.files !== undefined) {
    return { scope: "explicit", files: [...optionsOrFiles.files] };
  }
  const reportOnly = Boolean(optionsOrFiles?.reportOnly);
  if (optionsOrFiles?.stagedOnly === true || optionsOrFiles?.scope === "staged") {
    return { scope: "staged", files: getStagedTestFiles(reportOnly) };
  }
  const targetDir = optionsOrFiles?.rootDir;
  return { scope: "repository", files: getAllTestFiles(targetDir, reportOnly) };
}

export function resolveAllowance(
  request: PurityAuditRequest,
  optionsOrFiles?: ExtendedPurityAuditOptions | string[],
): PurityAllowance {
  const options = Array.isArray(optionsOrFiles) ? undefined : optionsOrFiles;
  const strict = options?.strict === true;
  if (!allowanceAppliesTo(request.scope, strict)) return EMPTY_PURITY_ALLOWANCE;
  if (options?.allowance !== undefined) return options.allowance;
  return readPurityAllowance();
}

export function auditTestPuritySync(
  optionsOrFiles?: ExtendedPurityAuditOptions | string[],
): PurityAuditResult {
  const request = resolveAuditRequest(optionsOrFiles);
  const allowance = resolveAllowance(request, optionsOrFiles);

  const allViolations: PurityViolation[] = [];
  let scannedCount = 0;

  for (const filePath of request.files) {
    if (!existsSync(filePath)) continue;
    try {
      const code = readFileSync(filePath, "utf-8");
      allViolations.push(...auditSourceCode(code, filePath));
      scannedCount++;
    } catch (err) {
      console.error(`[purity-guard] Failed to parse ${filePath}:`, err);
    }
  }

  return buildAuditResult(
    scannedCount,
    allViolations,
    request.scope,
    request.files.length,
    allowance,
  );
}

export async function auditTestPurity(
  optionsOrFiles?: ExtendedPurityAuditOptions | string[],
): Promise<PurityAuditResult> {
  return auditTestPuritySync(optionsOrFiles);
}

export function computeIsMain(
  mainVal: boolean = import.meta.main,
  entryArg: string | undefined = process.argv[1],
): boolean {
  if (mainVal) return true;
  if (!entryArg) return false;
  return (
    entryArg.endsWith("guardrails/purity-guard.ts") || entryArg.endsWith("guardrails/purity-guard")
  );
}

export async function main(argvArgs: string[] = process.argv.slice(2)): Promise<number> {
  const isStaged = argvArgs.includes("--staged");
  const isAll = argvArgs.includes("--all");
  const isStrict = argvArgs.includes("--strict");
  const isReportOnly = argvArgs.includes("--report-only");
  const specificFiles = argvArgs.filter((arg) => !arg.startsWith("-"));

  const options: ExtendedPurityAuditOptions = {
    stagedOnly: isStaged,
    all: isAll,
    strict: isStrict,
    reportOnly: isReportOnly,
    files: specificFiles.length > 0 ? specificFiles : undefined,
  };

  const result = await auditTestPurity(options);
  console.log(result.terminalReport);
  return result.passed ? 0 : 1;
}

if (computeIsMain()) {
  const exitCode = await main();
  process.exit(exitCode);
}
