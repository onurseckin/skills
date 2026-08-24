/**
 * Universal Coverage Report and Summary Generator
 * Reads coverage/lcov.info from Bun test coverage, parses LCOV records,
 * and generates universal coverage-summary.json and human-readable REPORT.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export interface MetricItem {
  readonly total: number;
  readonly covered: number;
  readonly skipped: number;
  readonly pct: number;
}

export interface FileCoverageMetric {
  readonly file: string;
  readonly lines: MetricItem;
  readonly statements: MetricItem;
  readonly functions: MetricItem;
  readonly branches: MetricItem;
  readonly uncoveredLines: readonly number[];
}

export interface CoverageSummaryItem {
  readonly lines: MetricItem;
  readonly statements: MetricItem;
  readonly functions: MetricItem;
  readonly branches: MetricItem;
}

export type CoverageSummary = Readonly<Record<string, CoverageSummaryItem>>;

function calculatePct(covered: number, total: number): number {
  if (total <= 0) return 100;
  const pct = (covered / total) * 100;
  return Math.round(pct * 100) / 100;
}

function createMetricItem(covered: number, total: number): MetricItem {
  return {
    total,
    covered,
    skipped: 0,
    pct: calculatePct(covered, total),
  };
}

export function parseLcov(lcovContent: string, repoRoot?: string): Map<string, FileCoverageMetric> {
  const root = repoRoot ? resolve(repoRoot) : process.cwd();
  const fileMap = new Map<string, FileCoverageMetric>();

  const lines = lcovContent.split(/\r?\n/);
  let currentFile: string | null = null;
  let fnFound = 0;
  let fnHit = 0;
  let brFound = 0;
  let brHit = 0;
  let lineFound = 0;
  let lineHit = 0;
  const uncoveredLines: number[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("SF:")) {
      currentFile = trimmed.slice(3).trim();
      fnFound = 0;
      fnHit = 0;
      brFound = 0;
      brHit = 0;
      lineFound = 0;
      lineHit = 0;
      uncoveredLines.length = 0;
    } else if (trimmed.startsWith("FNF:")) {
      fnFound = parseInt(trimmed.slice(4), 10) || 0;
    } else if (trimmed.startsWith("FNH:")) {
      fnHit = parseInt(trimmed.slice(4), 10) || 0;
    } else if (trimmed.startsWith("BRF:")) {
      brFound = parseInt(trimmed.slice(4), 10) || 0;
    } else if (trimmed.startsWith("BRH:")) {
      brHit = parseInt(trimmed.slice(4), 10) || 0;
    } else if (trimmed.startsWith("LF:")) {
      lineFound = parseInt(trimmed.slice(3), 10) || 0;
    } else if (trimmed.startsWith("LH:")) {
      lineHit = parseInt(trimmed.slice(3), 10) || 0;
    } else if (trimmed.startsWith("DA:")) {
      const parts = trimmed.slice(3).split(",");
      const lineNo = parseInt(parts[0] ?? "0", 10);
      const hitCount = parseInt(parts[1] ?? "0", 10);
      if (hitCount === 0 && lineNo > 0) {
        uncoveredLines.push(lineNo);
      }
    } else if (trimmed === "end_of_record" && currentFile) {
      const relPath = relative(root, resolve(root, currentFile));
      const lineMetric = createMetricItem(lineHit, lineFound);
      const fnMetric = createMetricItem(fnHit, fnFound);
      const brMetric = createMetricItem(brHit, brFound);

      fileMap.set(relPath, {
        file: relPath,
        lines: lineMetric,
        statements: lineMetric,
        functions: fnMetric,
        branches: brMetric,
        uncoveredLines: [...uncoveredLines],
      });
      currentFile = null;
    }
  }

  return fileMap;
}

export function buildCoverageSummary(fileMap: Map<string, FileCoverageMetric>): CoverageSummary {
  let totalLinesFound = 0;
  let totalLinesHit = 0;
  let totalFnFound = 0;
  let totalFnHit = 0;
  let totalBrFound = 0;
  let totalBrHit = 0;

  const result: Record<string, CoverageSummaryItem> = {};

  for (const [filePath, metric] of fileMap.entries()) {
    totalLinesFound += metric.lines.total;
    totalLinesHit += metric.lines.covered;
    totalFnFound += metric.functions.total;
    totalFnHit += metric.functions.covered;
    totalBrFound += metric.branches.total;
    totalBrHit += metric.branches.covered;

    result[filePath] = {
      lines: metric.lines,
      statements: metric.statements,
      functions: metric.functions,
      branches: metric.branches,
    };
  }

  result.total = {
    lines: createMetricItem(totalLinesHit, totalLinesFound),
    statements: createMetricItem(totalLinesHit, totalLinesFound),
    functions: createMetricItem(totalFnHit, totalFnFound),
    branches: createMetricItem(totalBrHit, totalBrFound),
  };

  return result;
}

export function buildMarkdownReport(
  fileMap: Map<string, FileCoverageMetric>,
  summary: CoverageSummary,
): string {
  const total = summary.total ?? {
    lines: { total: 0, covered: 0, skipped: 0, pct: 100 },
    statements: { total: 0, covered: 0, skipped: 0, pct: 100 },
    functions: { total: 0, covered: 0, skipped: 0, pct: 100 },
    branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
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
    `| **Statements / Lines** | ${total.lines.total} | ${total.lines.covered} | **${total.lines.pct}%** | ${total.lines.pct >= 100 ? "🟢 PASS" : "⚠️ NEEDS WORK"} |`,
    `| **Functions** | ${total.functions.total} | ${total.functions.covered} | **${total.functions.pct}%** | ${total.functions.pct >= 100 ? "🟢 PASS" : "⚠️ NEEDS WORK"} |`,
    `| **Branches** | ${total.branches.total} | ${total.branches.covered} | **${total.branches.pct}%** | ${total.branches.pct >= 100 ? "🟢 PASS" : "⚠️ NEEDS WORK"} |`,
    "",
    "## 📁 Detailed File Breakdown",
    "",
    "| Source File | Line Coverage | Function Coverage | Branch Coverage | Uncovered Lines |",
    "| :--- | :--- | :--- | :--- | :--- |",
  ];

  const sortedFiles = Array.from(fileMap.values()).sort((a, b) => a.file.localeCompare(b.file));

  for (const f of sortedFiles) {
    const lineGlyph = f.lines.pct >= 100 ? "🟢" : f.lines.pct >= 80 ? "🟡" : "🔴";
    const fnGlyph = f.functions.pct >= 100 ? "🟢" : f.functions.pct >= 80 ? "🟡" : "🔴";
    const brGlyph = f.branches.pct >= 100 ? "🟢" : f.branches.pct >= 80 ? "🟡" : "🔴";

    const uncoveredStr =
      f.uncoveredLines.length > 0
        ? f.uncoveredLines.slice(0, 10).join(", ") +
          (f.uncoveredLines.length > 10 ? ` (+${f.uncoveredLines.length - 10} more)` : "")
        : "_None (100%)_";

    lines.push(
      `| \`${f.file}\` | ${lineGlyph} ${f.lines.pct}% (${f.lines.covered}/${f.lines.total}) | ${fnGlyph} ${f.functions.pct}% (${f.functions.covered}/${f.functions.total}) | ${brGlyph} ${f.branches.pct}% (${f.branches.covered}/${f.branches.total}) | ${uncoveredStr} |`,
    );
  }

  lines.push("");
  lines.push("---");
  lines.push("_Report generated automatically by `@onurseckin/skills` test coverage pipeline._");
  lines.push("");

  return lines.join("\n");
}

import { writeInteractiveHtml } from "./coverage-html.ts";

export function processCoverageArtifacts(
  repoRoot?: string,
  coverageDirName: string = "coverage",
): { lcovExists: boolean; filesCount: number; totalPct: number } {
  const root = repoRoot ? resolve(repoRoot) : process.cwd();
  const coverageDir = join(root, coverageDirName);
  const lcovPath = join(coverageDir, "lcov.info");

  if (!existsSync(lcovPath)) {
    return { lcovExists: false, filesCount: 0, totalPct: 0 };
  }

  const lcovContent = readFileSync(lcovPath, "utf-8");
  const fileMap = parseLcov(lcovContent, root);
  const summary = buildCoverageSummary(fileMap);
  const markdown = buildMarkdownReport(fileMap, summary);

  if (!existsSync(coverageDir)) {
    mkdirSync(coverageDir, { recursive: true });
  }

  // 1. Write standard Istanbul/NYC coverage-summary.json
  const summaryPath = join(coverageDir, "coverage-summary.json");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");

  // 2. Write human-readable REPORT.md
  const reportPath = join(coverageDir, "REPORT.md");
  writeFileSync(reportPath, markdown, "utf-8");

  // 3. Write modern interactive HTML dashboard index.html
  writeInteractiveHtml(fileMap, summary, root, coverageDirName);

  const totalPct = summary.total?.lines.pct ?? 0;

  return {
    lcovExists: true,
    filesCount: fileMap.size,
    totalPct,
  };
}

// Auto-execute if invoked as CLI script
if (import.meta.main) {
  const res = processCoverageArtifacts();
  if (res.lcovExists) {
    console.log(
      `[coverage] Generated coverage/lcov.info, coverage/coverage-summary.json, coverage/REPORT.md, and coverage/index.html across ${res.filesCount} files (${res.totalPct}% line coverage).`,
    );
  } else {
    console.log("[coverage] No coverage/lcov.info found to process.");
  }
}
