/**
 * Universal Coverage Types and Data Contracts
 * Defines standardized coverage summary interfaces, file metrics, and artifact result models.
 * Focuses on the 3 core coverage categories: Lines, Statements, and Functions.
 */

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
  readonly uncoveredLines: readonly number[];
  readonly lineHits: ReadonlyMap<number, number>;
}

export interface CoverageSummaryItem {
  readonly lines: MetricItem;
  readonly statements: MetricItem;
  readonly functions: MetricItem;
}

export type CoverageSummary = Readonly<Record<string, CoverageSummaryItem>>;

export interface SourceLineDetail {
  readonly no: number;
  readonly code: string;
  readonly hits?: number | undefined;
  readonly isExecutable: boolean;
}

export interface FileDetailData {
  readonly path: string;
  readonly linesPct: number;
  readonly statementsPct: number;
  readonly funcsPct: number;
  readonly linesCovered: number;
  readonly linesTotal: number;
  readonly statementsCovered: number;
  readonly statementsTotal: number;
  readonly funcsCovered: number;
  readonly funcsTotal: number;
  readonly uncoveredLines: readonly number[];
  readonly sourceLines?: readonly SourceLineDetail[] | undefined;
}

export interface CoverageArtifactResult {
  readonly lcovExists: boolean;
  readonly filesCount: number;
  readonly totalPct: number;
  readonly summaryPath?: string | undefined;
  readonly reportPath?: string | undefined;
  readonly htmlPath?: string | undefined;
}

export function calculatePct(covered: number, total: number): number {
  if (total <= 0) return 100;
  const pct = (covered / total) * 100;
  return Math.round(pct * 100) / 100;
}

export function createMetricItem(covered: number, total: number): MetricItem {
  return {
    total,
    covered,
    skipped: 0,
    pct: calculatePct(covered, total),
  };
}
