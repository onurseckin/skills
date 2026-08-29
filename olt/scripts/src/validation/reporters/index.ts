export {
  UNIFIED_BROWSER_RUNS_DIRECTORY,
  UNIFIED_EVIDENCE_DIRECTORY,
  UNIFIED_MANIFESTS_DIRECTORY,
  UNIFIED_SCREENSHOTS_DIRECTORY,
  assertUnifiedEvidencePath,
  formatUnifiedEvidencePath,
  isUnifiedEvidencePath,
  isUnifiedEvidenceRelativePath,
  type EvidenceCategory,
} from "./evidence-paths.ts";

export {
  adaptIngestedVisualReport,
  adaptScreenshotRecords,
} from "./report-adapter.ts";
