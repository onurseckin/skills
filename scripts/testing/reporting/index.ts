export {
  calculatePct,
  createMetricItem,
  type MetricItem,
  type FileCoverageMetric,
} from "./metrics/index.ts";

export type {
  CoverageSummaryItem,
  TestFileRuntime,
  ParetoThreshold,
  TestRuntimeSummary,
  CoverageSummary,
  SourceLineDetail,
  FileDetailData,
  UnifiedHierarchyNode,
  CoverageArtifactResult,
  ProcessCoverageOptions,
  WriteCoverageOptions,
  DeficitCategory,
  DeficitCategoryBreakdown,
  DeficitCluster,
  DeficitRoadmap,
  DeficitClusteringOptions,
} from "./types.ts";

export {
  classifyDeficitCategory,
  getCategoryBadge,
  groupContiguousLines,
  generateDeficitRoadmap,
  formatDeficitRoadmapMarkdown,
  type DeficitCategoryClassification,
  type ContiguousLineSegment,
} from "./deficits/index.ts";

export {
  generateInteractiveHtml,
  writeInteractiveHtmlReport,
  writeInteractiveHtml,
} from "./html/index.ts";

export {
  buildCoverageSummary,
  processCoverageArtifacts,
  parseLcovContent,
  writeSummaryJson,
  evaluateCoverageGate,
  formatCoverageGateMessage,
} from "./coverage-service.ts";

export {
  formatMarkdownCoverageReport,
  formatRuntimeMarkdown,
  writeMarkdownCoverageReport,
} from "./markdown-reporter.ts";
