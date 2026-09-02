// @ts-nocheck
/**
 * Markdown Coverage and Runtime Report Builder and Writer
 * Generates human-readable REPORT.md files focusing on Lines, Statements, Functions, and Test Runtimes.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { formatDeficitRoadmapMarkdown, generateDeficitRoadmap } from "./deficits/index.ts";
import type { CoverageSummary, FileCoverageMetric, TestRuntimeSummary } from "./types.ts";

export function formatRuntimeMarkdown(runtime: TestRuntimeSummary): string[] {
  const lines: string[] = [
    "## ⚡ Test Runtime Performance & Telemetry",
    "",
    "| Runtime Metric | Value | Detail |",
    "| :--- | :--- | :--- |",
    `| **Total Duration** | **${runtime.totalDurationMs}ms** | Across ${runtime.totalFiles} test files |`,
    `| **Average Duration** | **${runtime.avgDurationMs}ms** | Mean file execution time |`,
    `| **Median Duration** | **${runtime.medianDurationMs}ms** | 50th percentile file execution time |`,
  ];

  const p50Pct =
    runtime.totalFiles > 0
      ? Math.round((runtime.pareto50.fileCount / runtime.totalFiles) * 1000) / 10
      : 0;
  const p90Pct =
    runtime.totalFiles > 0
      ? Math.round((runtime.pareto90.fileCount / runtime.totalFiles) * 1000) / 10
      : 0;

  lines.push(
    `| **🎯 Top 50% Concentration** | **${runtime.pareto50.fileCount} files** (${p50Pct}%) | Account for 50% of total run time |`,
  );
  lines.push(
    `| **📈 Top 90% Concentration** | **${runtime.pareto90.fileCount} files** (${p90Pct}%) | Account for 90% of total run time |`,
  );

  if (runtime.slowestFile) {
    lines.push(
      `| **Slowest Test File** | \`${runtime.slowestFile.file}\` | ${runtime.slowestFile.durationMs}ms (${runtime.slowestFile.percentage}%) |`,
    );
  }

  lines.push("");
  lines.push("### 🐢 Top 10 Slowest Test Files");
  lines.push("");
  lines.push("| Rank | Test File | Duration (ms) | Time Share | Result |");
  lines.push("| :--- | :--- | :--- | :--- | :--- |");

  const top10 = runtime.files.slice(0, 10);
  top10.forEach((f, idx) => {
    const statusBadge = f.passed === false ? "🔴 FAIL" : "🟢 PASS";
    lines.push(
      `| ${idx + 1} | \`${f.file}\` | **${f.durationMs}ms** | ${f.percentage}% | ${statusBadge} |`,
    );
  });

  lines.push("");
  return lines;
}

export function buildMarkdownReport(
  fileMap: Map<string, FileCoverageMetric>,
  summary: CoverageSummary,
  runtime?: TestRuntimeSummary,
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
    "## Executive Summary",
    "",
    "| Metric | Total | Covered | Coverage (%) | Status |",
    "| :--- | :--- | :--- | :--- | :--- |",
    `| **Lines** | ${total.lines.total} | ${total.lines.covered} | **${total.lines.pct}%** | ${total.lines.pct >= 100 ? "PASS" : "NEEDS WORK"} |`,
    `| **Statements** | ${total.statements.total} | ${total.statements.covered} | **${total.statements.pct}%** | ${total.statements.pct >= 100 ? "PASS" : "NEEDS WORK"} |`,
    `| **Functions** | ${total.functions.total} | ${total.functions.covered} | **${total.functions.pct}%** | ${total.functions.pct >= 100 ? "PASS" : "NEEDS WORK"} |`,
    "",
  ];

  const activeRuntime = runtime ?? summary.runtime;
  if (activeRuntime && activeRuntime.files.length > 0) {
    lines.push(...formatRuntimeMarkdown(activeRuntime));
  }

  lines.push("## Detailed File Breakdown");
  lines.push("");
  lines.push(
    "| Source File | Line Coverage | Statement Coverage | Function Coverage | Uncovered Lines |",
  );
  lines.push("| :--- | :--- | :--- | :--- | :--- |");

  const sortedFiles = Array.from(fileMap.values()).sort((a, b) => a.file.localeCompare(b.file));

  for (const f of sortedFiles) {
    const uncoveredStr =
      f.uncoveredLines.length > 0
        ? f.uncoveredLines.slice(0, 10).join(", ") +
          (f.uncoveredLines.length > 10 ? ` (+${f.uncoveredLines.length - 10} more)` : "")
        : "_None (100%)_";

    lines.push(
      `| \`${f.file}\` | ${f.lines.pct}% (${f.lines.covered}/${f.lines.total}) | ${f.statements.pct}% (${f.statements.covered}/${f.statements.total}) | ${f.functions.pct}% (${f.functions.covered}/${f.functions.total}) | ${uncoveredStr} |`,
    );
  }

  const roadmap = generateDeficitRoadmap(fileMap);
  if (roadmap.clusters.length > 0) {
    lines.push(formatDeficitRoadmapMarkdown(roadmap, 10));
  }

  lines.push("---");
  lines.push("_Report generated automatically by `@onurseckin/skills` test reporting pipeline._");
  lines.push("");

  return lines.join("\n");
}

export function writeMarkdownReport(
  fileMap: Map<string, FileCoverageMetric>,
  summary: CoverageSummary,
  repoRoot: string = process.cwd(),
  coverageDirName: string = "coverage",
  runtime?: TestRuntimeSummary,
): string {
  const root = resolve(repoRoot);
  const coverageDir = join(root, coverageDirName);
  if (!existsSync(coverageDir)) {
    mkdirSync(coverageDir, { recursive: true });
  }
  const reportPath = join(coverageDir, "REPORT.md");
  const markdown = buildMarkdownReport(fileMap, summary, runtime);
  writeFileSync(reportPath, markdown, "utf-8");
  return reportPath;
}
