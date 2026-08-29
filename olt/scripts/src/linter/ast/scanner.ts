import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import {
  ALL_AST_LINT_RULES,
  createEmptyRuleSummary,
  DEFAULT_EXTENSIONS,
  matchesExcludePattern,
  type AstLintOptions,
  type AstLintResult,
  type DirectoryLintResult,
} from "./index.ts";
import { lintFile } from "./runner.ts";

export function collectSourceFiles(
  dirPath: string,
  extensions: readonly string[],
  excludePatterns: readonly string[],
  maxDepth: number,
  currentDepth: number,
): readonly string[] {
  if (currentDepth > maxDepth) {
    return [];
  }
  if (!existsSync(dirPath)) {
    return [];
  }

  const results: string[] = [];
  const entries = readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    let isExcluded = false;
    for (const pattern of excludePatterns) {
      if (matchesExcludePattern(entry.name, fullPath, pattern)) {
        isExcluded = true;
        break;
      }
    }
    if (isExcluded) {
      continue;
    }

    if (entry.isDirectory()) {
      const nestedFiles = collectSourceFiles(
        fullPath,
        extensions,
        excludePatterns,
        maxDepth,
        currentDepth + 1,
      );
      for (const nested of nestedFiles) {
        results.push(nested);
      }
    } else if (entry.isFile()) {
      let matchesExtension = false;
      for (const ext of extensions) {
        if (entry.name.endsWith(ext)) {
          matchesExtension = true;
          break;
        }
      }
      if (matchesExtension) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

export function lintDirectory(dirPath: string, options?: AstLintOptions): DirectoryLintResult {
  if (!existsSync(dirPath)) {
    throw new HarnessError("PATH_SAFETY", `Target directory does not exist: ${dirPath}`, [
      { dirPath },
    ]);
  }

  const stat = statSync(dirPath);
  if (!stat.isDirectory()) {
    throw new HarnessError("PATH_SAFETY", `Target path is not a directory: ${dirPath}`, [
      { dirPath },
    ]);
  }

  let extensions: readonly string[] = DEFAULT_EXTENSIONS;
  if (options !== undefined && options !== null) {
    if (options.includeExtensions !== undefined && options.includeExtensions !== null) {
      extensions = options.includeExtensions;
    }
  }

  let excludePatterns: readonly string[] = ["node_modules", ".git", ".capsules", "dist", "build"];
  if (options !== undefined && options !== null) {
    if (options.excludePatterns !== undefined && options.excludePatterns !== null) {
      excludePatterns = options.excludePatterns;
    }
  }

  let maxDepth = 20;
  if (options !== undefined && options !== null) {
    if (typeof options.maxDepth === "number" && options.maxDepth >= 0) {
      maxDepth = options.maxDepth;
    }
  }

  const files = collectSourceFiles(dirPath, extensions, excludePatterns, maxDepth, 0);

  const fileResults: AstLintResult[] = [];
  let totalViolations = 0;
  let cleanFiles = 0;
  let failedFiles = 0;
  const aggregatedSummary = createEmptyRuleSummary();

  for (const file of files) {
    const result = lintFile(file, options);
    fileResults.push(result);
    totalViolations = totalViolations + result.totalViolations;

    if (result.valid) {
      cleanFiles = cleanFiles + 1;
    } else {
      failedFiles = failedFiles + 1;
    }

    for (const rule of ALL_AST_LINT_RULES) {
      const count = result.summaryByRule[rule];
      const prevTotal = aggregatedSummary[rule];
      aggregatedSummary[rule] = prevTotal + count;
    }
  }

  const passed = totalViolations === 0;

  return {
    valid: passed,
    passed,
    directoryPath: dirPath,
    totalFiles: files.length,
    cleanFiles,
    failedFiles,
    totalViolations,
    fileResults,
    summaryByRule: aggregatedSummary,
  };
}
