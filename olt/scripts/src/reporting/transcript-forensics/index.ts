export type {
  ClusteredForensicDefect,
  ForensicFindingOccurrence,
  ForensicHeuristicCategory,
  ForensicRawFinding,
  ForensicScanOptions,
  ForensicScanSummary,
} from "./types.ts";

export type { StepToolCall, TranscriptStepRecord } from "./patterns.ts";

export { extractConversationId, locateTranscripts, parseTranscriptFile } from "./locator.ts";

export { clusterForensicFindings } from "./clustering.ts";
export { scanTranscriptForensics, scanTranscriptSteps, recordClusteredDefects } from "./scanner.ts";
