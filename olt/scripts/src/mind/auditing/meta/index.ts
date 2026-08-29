export type {
  RootCauseCategory,
  ForensicsCategory,
  ForensicsSeverity,
  ForensicsIncident,
  ForensicsEfficiencyMetrics,
  ForensicsMetrics,
  ForensicsSummary,
  PlanInjectionProposal,
  ForensicsAnalysisResult,
  ForensicsAnalysisReport,
  AnalyzeRunForensicsOptions,
  MetaAuditAnalysisOptions,
  FeedbackInjectionOptions,
  ForensicsInjectionResult,
  FeedbackInjectionResult,
  ExtractedToolCall,
} from "./types.ts";

export {
  isJsonObject,
  ROOT_CAUSE_CATEGORIES,
  FORENSICS_SEVERITIES,
  READ_TOOLS,
  WRITE_TOOLS,
  POLL_TOOLS,
  safeParseJson,
  generateIncidentId,
  generateProposalId,
  isReadTool,
  isWriteTool,
  isPollTool,
  parseEventsFile,
} from "./types.ts";

export {
  parseStateFile,
  parseManifestFile,
  extractToolCallsFromTranscripts,
  extractToolCallsFromEvents,
  calculateEfficiencyScore,
} from "./timeline.ts";

export {
  formatForensicsReport,
  renderForensicsAsciiTable,
  synthesizeRemediationPlan,
} from "./forensics.ts";

export type { TaskOrderEntry } from "./classifier.ts";

export { injectRemediationToFeedbackQueue } from "./classifier.ts";

export { analyzeRunForensics } from "./evaluator.ts";
