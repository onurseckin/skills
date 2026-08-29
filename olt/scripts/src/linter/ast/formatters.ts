import {
  ALL_AST_LINT_RULES,
  isDirectoryLintResult,
  type AstLintResult,
  type AstLintRule,
  type AstLintViolation,
  type DirectoryLintResult,
} from "./types.ts";

export function formatAstLintReport(result: DirectoryLintResult | AstLintResult): string {
  const lines: string[] = [];

  if (isDirectoryLintResult(result)) {
    lines.push("================================================================================");
    lines.push(`AST LINT DIRECTORY REPORT: ${result.directoryPath}`);
    let statusText = `FAILED (${result.totalViolations} violations)`;
    if (result.valid) {
      statusText = "PASSED (0 violations)";
    }
    lines.push(`Status: ${statusText}`);
    lines.push(
      `Files scanned: ${result.totalFiles} (Clean: ${result.cleanFiles}, Failed: ${result.failedFiles})`,
    );
    lines.push("--------------------------------------------------------------------------------");
    lines.push("Summary by rule:");
    for (const rule of ALL_AST_LINT_RULES) {
      lines.push(`  - ${rule}: ${result.summaryByRule[rule]}`);
    }

    if (!result.valid) {
      lines.push(
        "--------------------------------------------------------------------------------",
      );
      lines.push("Violations by file:");
      for (const fileRes of result.fileResults) {
        if (!fileRes.valid) {
          lines.push(`\nFile: ${fileRes.filePath} (${fileRes.totalViolations} violations)`);
          for (const v of fileRes.violations) {
            lines.push(`  Line ${v.line}:${v.column} [${v.rule}] ${v.message}`);
            lines.push(`    Snippet: ${v.snippet}`);
          }
        }
      }
    }
    lines.push("================================================================================");
  } else {
    lines.push("================================================================================");
    lines.push(`AST LINT FILE REPORT: ${result.filePath}`);
    let statusText = `FAILED (${result.totalViolations} violations)`;
    if (result.valid) {
      statusText = "PASSED (0 violations)";
    }
    lines.push(`Status: ${statusText}`);
    lines.push("--------------------------------------------------------------------------------");
    lines.push("Summary by rule:");
    for (const rule of ALL_AST_LINT_RULES) {
      lines.push(`  - ${rule}: ${result.summaryByRule[rule]}`);
    }

    if (!result.valid) {
      lines.push(
        "--------------------------------------------------------------------------------",
      );
      lines.push("Violations:");
      for (const v of result.violations) {
        lines.push(`  Line ${v.line}:${v.column} [${v.rule}] ${v.message}`);
        lines.push(`    Snippet: ${v.snippet}`);
      }
    }
    lines.push("================================================================================");
  }

  return lines.join("\n");
}

export function formatViolationMarkdown(violation: AstLintViolation): string {
  const parts: string[] = [];
  parts.push(
    `- **[${violation.rule}]** \`${violation.file}:${violation.line}:${violation.column}\``,
  );
  parts.push(`  ${violation.message}`);
  parts.push(`  \`\`\`ts\n  ${violation.snippet}\n  \`\`\``);
  return parts.join("\n");
}

export function formatSummaryTable(summaryByRule: Readonly<Record<AstLintRule, number>>): string {
  const rows: string[] = ["| Rule | Violations |", "| :--- | :--- |"];
  for (const rule of ALL_AST_LINT_RULES) {
    rows.push(`| \`${rule}\` | ${summaryByRule[rule]} |`);
  }
  return rows.join("\n");
}
