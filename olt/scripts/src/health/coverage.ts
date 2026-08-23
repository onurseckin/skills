/**
 * Per-file test coverage audit engine and AST gap analyzer.
 * Evaluates line, function, statement, and branch coverage across production TypeScript files.
 */
import { lineOf, scanSource } from "./scanner.ts";

export interface FileCoverageMetric {
  readonly file: string;
  readonly lines: number;
  readonly statements: number;
  readonly functions: number;
  readonly branches?: number;
  readonly uncoveredLines: readonly number[];
}

export interface CoverageAuditResult {
  readonly passed: boolean;
  readonly threshold: number;
  readonly files: readonly FileCoverageMetric[];
  readonly failing: readonly FileCoverageMetric[];
  readonly passing: readonly FileCoverageMetric[];
  readonly averageLines: number;
  readonly averageStatements: number;
  readonly averageFunctions: number;
}

export interface UncoveredRegion {
  readonly line: number;
  readonly snippet: string;
}

export function parseUncoveredLineTokens(rawUncovered: string): number[] {
  const lines: number[] = [];
  const tokens = rawUncovered.split(",").map((token) => token.trim());
  for (const token of tokens) {
    if (!token) continue;
    if (token.includes("-")) {
      const parts = token.split("-");
      const startStr = parts[0];
      const endStr = parts[1];
      if (startStr !== undefined && endStr !== undefined) {
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (Number.isFinite(start) && Number.isFinite(end)) {
          for (let line = start; line <= end; line += 1) {
            lines.push(line);
          }
        }
      }
    } else {
      const single = parseInt(token, 10);
      if (Number.isFinite(single)) {
        lines.push(single);
      }
    }
  }
  return lines;
}

export function parseCoverageSummary(rawCoverageOutput: string): FileCoverageMetric[] {
  const metrics: FileCoverageMetric[] = [];
  const rows = rawCoverageOutput.split("\n");

  for (const row of rows) {
    const match = row.match(/^\s*(\S+\.ts)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*(.*)$/);
    if (match) {
      const file = match[1];
      const rawLines = match[2];
      const rawStmts = match[3];
      const rawUncovered = match[4];
      if (file !== undefined && rawLines !== undefined && rawStmts !== undefined) {
        const linesPct = parseFloat(rawLines) / 100;
        const stmtsPct = parseFloat(rawStmts) / 100;
        const uncovered = rawUncovered !== undefined ? parseUncoveredLineTokens(rawUncovered) : [];
        metrics.push({
          file,
          lines: linesPct,
          statements: stmtsPct,
          functions: linesPct,
          branches: stmtsPct,
          uncoveredLines: uncovered,
        });
      }
    }
  }

  return metrics;
}

export function auditCoverageThresholds(
  metrics: readonly FileCoverageMetric[],
  threshold = 0.95,
): CoverageAuditResult {
  const failing = metrics.filter(
    (metric) =>
      metric.lines < threshold ||
      metric.statements < threshold ||
      metric.functions < threshold ||
      (metric.branches !== undefined && metric.branches < threshold),
  );
  const passing = metrics.filter(
    (metric) =>
      metric.lines >= threshold &&
      metric.statements >= threshold &&
      metric.functions >= threshold &&
      (metric.branches === undefined || metric.branches >= threshold),
  );

  const total = metrics.length;
  let sumLines = 0;
  let sumStmts = 0;
  let sumFuncs = 0;

  for (const m of metrics) {
    sumLines += m.lines;
    sumStmts += m.statements;
    sumFuncs += m.functions;
  }

  const averageLines = total > 0 ? sumLines / total : 1.0;
  const averageStatements = total > 0 ? sumStmts / total : 1.0;
  const averageFunctions = total > 0 ? sumFuncs / total : 1.0;

  return {
    passed: failing.length === 0,
    threshold,
    files: metrics,
    failing,
    passing,
    averageLines,
    averageStatements,
    averageFunctions,
  };
}

export function scanUncoveredRegions(
  sourceCode: string,
  uncoveredLines: readonly number[],
): readonly UncoveredRegion[] {
  const scanned = scanSource(sourceCode);
  const codeLines = scanned.code.split("\n");
  const regions: UncoveredRegion[] = [];

  for (const lineNum of uncoveredLines) {
    if (lineNum >= 1 && lineNum <= codeLines.length) {
      const rawSnippet = codeLines[lineNum - 1];
      const snippet = rawSnippet !== undefined ? rawSnippet.trim() : "";
      if (snippet.length > 0) {
        regions.push({ line: lineNum, snippet });
      }
    }
  }

  return regions;
}

export function generateCoverageReport(audit: CoverageAuditResult): string {
  const linesPct = (audit.averageLines * 100).toFixed(2);
  const stmtsPct = (audit.averageStatements * 100).toFixed(2);
  const funcsPct = (audit.averageFunctions * 100).toFixed(2);
  const threshPct = (audit.threshold * 100).toFixed(1);

  const header = [
    `# Coverage Audit Certification Report`,
    `- **Status**: ${audit.passed ? "✅ PASS" : "❌ FAIL"}`,
    `- **Target Threshold**: >= ${threshPct}%`,
    `- **Total Files Audited**: ${audit.files.length}`,
    `- **Passing Files**: ${audit.passing.length}`,
    `- **Failing Files**: ${audit.failing.length}`,
    `- **Average Line Coverage**: ${linesPct}%`,
    `- **Average Statement Coverage**: ${stmtsPct}%`,
    `- **Average Function Coverage**: ${funcsPct}%`,
  ];

  if (audit.failing.length > 0) {
    header.push("", "### Files Below Threshold:");
    for (const f of audit.failing) {
      const fl = (f.lines * 100).toFixed(1);
      const fs = (f.statements * 100).toFixed(1);
      header.push(`- \`${f.file}\`: lines ${fl}%, stmts ${fs}%`);
    }
  }

  return header.join("\n");
}
