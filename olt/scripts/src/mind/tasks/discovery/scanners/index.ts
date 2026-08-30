export {
  scanCodeQuality,
  resolveDiscoveryCharterPath,
  collectFilesRecursively,
} from "./quality-scanner.ts";

export { scanTestCoverage } from "./coverage-scanner.ts";

export { scanCognitiveGaps, scanDormantCriteria } from "./gap-scanner.ts";

export {
  scanArchitecturalHealth,
  proposeCandidateEvolutions,
  mapPriority,
  mapFeedbackPriorityToTaskPriority,
  sanitizeSlug,
} from "./health-scanner.ts";

export {
  scanDefectRemediations,
  extractDefectRemediation,
  mapDefectToDiscoveryItem,
  mapDefectSeverityToPriority,
  mapDefectSeverityToDiscoverySeverity,
  mapCategoryToIssueType,
  filterOpenDefects,
  isDefectEntry,
} from "./remediation-scanner.ts";

export type {
  DefectRemediationFinding,
  DefectRemediationIssueType,
  DefectRemediationScanOptions,
  DefectRemediationScanResult,
} from "./remediation-scanner.ts";
