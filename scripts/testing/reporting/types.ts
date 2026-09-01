/**
 * Universal Coverage Types and Data Contracts
 */

export {
  calculatePct,
  createMetricItem,
  type MetricItem,
  type FileCoverageMetric,
} from "./metrics/index.ts";

import type { MetricItem, FileCoverageMetric } from "./metrics/index.ts";

export interface CoverageSummaryItem {
  readonly lines: MetricItem;
  readonly statements: MetricItem;
  readonly functions: MetricItem;
}

export interface TestFileRuntime {
  readonly file: string;
  readonly durationMs: number;
  readonly percentage: number;
  readonly passed?: boolean | undefined;
  readonly testCount?: number | undefined;
}

export interface ParetoThreshold {
  readonly percentage: number;
  readonly fileCount: number;
  readonly cumulativeDurationMs: number;
  readonly files: readonly TestFileRuntime[];
}

export interface TestRuntimeSummary {
  readonly startTime: string;
  readonly endTime: string;
  readonly totalDurationMs: number;
  readonly totalFiles: number;
  readonly avgDurationMs: number;
  readonly medianDurationMs: number;
  readonly slowestFile?: TestFileRuntime | undefined;
  readonly files: readonly TestFileRuntime[];
  readonly pareto50: ParetoThreshold;
  readonly pareto90: ParetoThreshold;
}

export type CoverageSummary = Readonly<Record<string, CoverageSummaryItem>> & {
  readonly runtime?: TestRuntimeSummary | undefined;
};

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
  readonly testFile?: string | undefined;
  readonly testDurationMs?: number | undefined;
  readonly testPassed?: boolean | undefined;
  readonly testCount?: number | undefined;
  readonly paretoClass?: "p50" | "p90" | "normal" | undefined;
}

export interface UnifiedHierarchyNode {
  readonly name: string;
  readonly path: string;
  readonly type: "file" | "dir";
  readonly lines: MetricItem;
  readonly statements: MetricItem;
  readonly functions: MetricItem;
  readonly uncoveredLines: readonly number[];
  readonly testDurationMs?: number | undefined;
  readonly testPassed?: boolean | undefined;
  readonly testCount?: number | undefined;
  readonly testFile?: string | undefined;
  readonly paretoClass?: "p50" | "p90" | "normal" | undefined;
  readonly children?: readonly UnifiedHierarchyNode[] | undefined;
}

export interface CoverageArtifactResult {
  readonly lcovExists: boolean;
  readonly filesCount: number;
  readonly totalPct: number;
  readonly summaryPath?: string | undefined;
  readonly reportPath?: string | undefined;
  readonly htmlPath?: string | undefined;
  readonly summary?: CoverageSummary | undefined;
  readonly runtime?: TestRuntimeSummary | undefined;
}

export interface ProcessCoverageOptions {
  readonly writeToDisk?: boolean | undefined;
  readonly lcovContent?: string | undefined;
  readonly skipIfUnchanged?: boolean | undefined;
  readonly runtime?: TestRuntimeSummary | undefined;
  readonly testOutput?: string | undefined;
  readonly totalDurationMs?: number | undefined;
  readonly startTime?: string | undefined;
  readonly endTime?: string | undefined;
}

export interface WriteCoverageOptions {
  readonly writeToDisk?: boolean | undefined;
  readonly skipIfUnchanged?: boolean | undefined;
  readonly runtime?: TestRuntimeSummary | undefined;
}

export type {
  DeficitCategory,
  DeficitCategoryBreakdown,
  DeficitCluster,
  DeficitRoadmap,
  DeficitClusteringOptions,
} from "./deficits/index.ts";
