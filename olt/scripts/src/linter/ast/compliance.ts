import { existsSync, statSync } from "node:fs";
import { HarnessError } from "../../core/errors/index.ts";
import type { AstLintOptions, AstLintResult } from "../core/index.ts";
import { formatAstLintReport } from "./formatters.ts";
import { lintFile, lintSourceCode } from "./runner.ts";
import { lintDirectory } from "./scanner.ts";

export function assertZeroFallbackCompliance(
  filePathOrSource: string,
  options?: AstLintOptions,
): void {
  let result: AstLintResult;

  if (typeof filePathOrSource === "string" && existsSync(filePathOrSource)) {
    const stat = statSync(filePathOrSource);
    if (stat.isDirectory()) {
      const dirResult = lintDirectory(filePathOrSource, options);
      if (!dirResult.valid) {
        const report = formatAstLintReport(dirResult);
        throw new HarnessError(
          "INTEGRITY",
          `Zero-fallback compliance check failed for directory '${filePathOrSource}' with ${dirResult.totalViolations} violations:\n${report}`,
          [{ directory: filePathOrSource, totalViolations: dirResult.totalViolations }],
        );
      }
      return;
    }
    result = lintFile(filePathOrSource, options);
  } else {
    result = lintSourceCode(filePathOrSource, "anonymous.ts", options);
  }

  if (!result.valid) {
    const report = formatAstLintReport(result);
    throw new HarnessError(
      "INTEGRITY",
      `Zero-fallback compliance check failed for '${result.filePath}' with ${result.totalViolations} violations:\n${report}`,
      [{ file: result.filePath, totalViolations: result.totalViolations }],
    );
  }
}
