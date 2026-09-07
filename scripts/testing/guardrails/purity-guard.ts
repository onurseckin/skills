/**
 * @file purity-guard.ts
 * Main entry point and CLI for test purity guardrail audits.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { auditSourceCode } from "./ast-checker.ts";
import { buildAuditResult } from "./reporter.ts";
import type {
  PurityAuditOptions,
  PurityAuditRequest,
  PurityAuditResult,
  PurityViolation,
} from "./types.ts";

export function getStagedTestFiles(): string[] {
  try {
    const res = spawnSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf-8" });
    return (res.stdout ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((file) => /\.(test|spec)\.(ts|tsx)$/.test(file) && existsSync(file));
  } catch {
    return [];
  }
}

export function getAllTestFiles(dir = "tests"): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...getAllTestFiles(full));
      } else if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
        results.push(full);
      }
    }
  } catch {}
  return results;
}

export function resolveAuditRequest(
  optionsOrFiles?: PurityAuditOptions | string[],
): PurityAuditRequest {
  if (Array.isArray(optionsOrFiles)) {
    return { scope: "explicit", files: [...optionsOrFiles] };
  }
  if (optionsOrFiles?.files !== undefined) {
    return { scope: "explicit", files: [...optionsOrFiles.files] };
  }
  if (optionsOrFiles?.stagedOnly === true) {
    return { scope: "staged", files: getStagedTestFiles() };
  }
  return { scope: "repository", files: getAllTestFiles("tests") };
}

export function auditTestPuritySync(
  optionsOrFiles?: PurityAuditOptions | string[],
): PurityAuditResult {
  const request = resolveAuditRequest(optionsOrFiles);

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

  return buildAuditResult(scannedCount, allViolations, request.scope, request.files.length);
}

export async function auditTestPurity(
  optionsOrFiles?: PurityAuditOptions | string[],
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
  const specificFiles = argvArgs.filter((arg) => !arg.startsWith("-"));

  const options: PurityAuditOptions = {
    stagedOnly: isStaged,
    all: isAll,
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
