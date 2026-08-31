/**
 * Markdown Coverage Report Builder and Writer
 * Generates human-readable REPORT.md files focusing on Lines, Statements, and Functions.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CoverageSummary, FileCoverageMetric } from "./types.ts";

export function buildMarkdownReport(
  fileMap: Map<string, FileCoverageMetric>,
  summary: CoverageSummary,
): string {
  const total =
    typeof summary.total !== "undefined" && summary.total !== null
      ? summary.total
      : {
          lines: { total: 0, covered: 0, skipped: 0, pct: 100 },
          statements: { total: 0, covered: 0, skipped: 0, pct: 100 },
          functions: { total: 0, covered: 0, skipped: 0, pct: 100 },
        };

  const lines: string[] = [
    "# Repository Unit Test Coverage Report",
    "",
    `_Generated: ${new Date().toISOString()}_`,
    "",
    "## 📊 Executive Summary",
    "",
    "| Metric | Total | Covered | Coverage (%) | Status |",
    "| :--- | :--- | :--- | :--- | :--- |",
    `| **Lines** | ${total.lines.total} | ${total.lines.covered} | **${total.lines.pct}%** | ${total.lines.pct >= 100 ? "🟢 PASS" : "⚠️ NEEDS WORK"} |`,
    `| **Statements** | ${total.statements.total} | ${total.statements.covered} | **${total.statements.pct}%** | ${total.statements.pct >= 100 ? "🟢 PASS" : "⚠️ NEEDS WORK"} |`,
    `| **Functions** | ${total.functions.total} | ${total.functions.covered} | **${total.functions.pct}%** | ${total.functions.pct >= 100 ? "🟢 PASS" : "⚠️ NEEDS WORK"} |`,
    "",
    "## 📁 Detailed File Breakdown",
    "",
    "| Source File | Line Coverage | Statement Coverage | Function Coverage | Uncovered Lines |",
    "| :--- | :--- | :--- | :--- | :--- |",
  ];

  const sortedFiles = Array.from(fileMap.values()).sort((a, b) => a.file.localeCompare(b.file));

  for (const f of sortedFiles) {
    const lineGlyph = f.lines.pct >= 100 ? "🟢" : f.lines.pct >= 80 ? "🟡" : "🔴";
    const stmtGlyph = f.statements.pct >= 100 ? "🟢" : f.statements.pct >= 80 ? "🟡" : "🔴";
    const fnGlyph = f.functions.pct >= 100 ? "🟢" : f.functions.pct >= 80 ? "🟡" : "🔴";

    const uncoveredStr =
      f.uncoveredLines.length > 0
        ? f.uncoveredLines.slice(0, 10).join(", ") +
          (f.uncoveredLines.length > 10 ? ` (+${f.uncoveredLines.length - 10} more)` : "")
        : "_None (100%)_";

    lines.push(
      `| \`${f.file}\` | ${lineGlyph} ${f.lines.pct}% (${f.lines.covered}/${f.lines.total}) | ${stmtGlyph} ${f.statements.pct}% (${f.statements.covered}/${f.statements.total}) | ${fnGlyph} ${f.functions.pct}% (${f.functions.covered}/${f.functions.total}) | ${uncoveredStr} |`,
    );
  }

  lines.push("");
  lines.push("---");
  lines.push("_Report generated automatically by `@onurseckin/skills` test coverage pipeline._");
  lines.push("");

  return lines.join("\n");
}

export function writeMarkdownReport(
  fileMap: Map<string, FileCoverageMetric>,
  summary: CoverageSummary,
  repoRoot: string = process.cwd(),
  coverageDirName: string = "coverage",
): string {
  const root = resolve(repoRoot);
  const coverageDir = join(root, coverageDirName);
  if (!existsSync(coverageDir)) {
    mkdirSync(coverageDir, { recursive: true });
  }
  const reportPath = join(coverageDir, "REPORT.md");
  const markdown = buildMarkdownReport(fileMap, summary);
  writeFileSync(reportPath, markdown, "utf-8");
  return reportPath;
}
