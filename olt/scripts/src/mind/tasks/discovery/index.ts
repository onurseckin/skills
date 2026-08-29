export type {
  DiscoveryCategory,
  DiscoverySeverity,
  CodeQualityIssueType,
  CodeQualityFinding,
  CodeQualityScanOptions,
  CodeQualityScanResult,
  TestCoverageIssueType,
  TestCoverageFinding,
  TestCoverageScanOptions,
  TestCoverageScanResult,
  CognitiveIssueType,
  CognitiveGapFinding,
  CognitiveGapScanOptions,
  CognitiveGapScanResult,
  DormantCriteriaFinding,
  DormantCriteriaScanOptions,
  DormantCriteriaScanResult,
  ArchitecturalHealthIssueType,
  ArchitecturalHealthFinding,
  ArchitecturalHealthScanOptions,
  ArchitecturalHealthScanResult,
} from "./types.ts";

export type {
  CandidateEvolutionProposal,
  DiscoveryItem,
  DiscoveredTaskPlan,
  TaskDiscoveryOptions,
  TaskDiscoveryResult,
} from "./types.ts";

export { DEFAULT_EXCLUDE_PATTERNS, DEFAULT_SOURCE_EXTENSIONS } from "./types.ts";

export {
  sanitizeSlug,
  resolveDiscoveryCharterPath,
  collectFilesRecursively,
  scanCodeQuality,
} from "./scanners/index.ts";

export { scanTestCoverage } from "./scanners/index.ts";

export { scanCognitiveGaps, scanDormantCriteria } from "./scanners/index.ts";

export {
  scanArchitecturalHealth,
  mapPriority,
  mapFeedbackPriorityToTaskPriority,
  proposeCandidateEvolutions,
  scanDefectRemediations,
  mapDefectToDiscoveryItem,
  mapDefectSeverityToPriority,
  mapDefectSeverityToDiscoverySeverity,
  mapCategoryToIssueType,
  filterOpenDefects,
  isDefectEntry,
} from "./scanners/index.ts";

export type {
  DefectRemediationFinding,
  DefectRemediationIssueType,
  DefectRemediationScanOptions,
  DefectRemediationScanResult,
} from "./scanners/index.ts";

export {
  performDiscoveryScans,
  transformFindingsToDiscoveries,
  synthesizeTaskFromDiscovery,
  formatTaskDiscoveryBrief,
  discoverTasks,
  type DiscoveryScanOutputs,
} from "./slices/index.ts";

export { MindAutonomousDiscoveryEngine, type DiscoveryProposal } from "./discovery-engine.ts";
