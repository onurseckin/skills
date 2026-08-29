export type {
  AsciiBranch,
  AsciiGraphInput,
  AsciiSubTask,
  AsciiTask,
  AsciiWave,
} from "./markdown-ascii-graph.ts";
export { renderTaskGraphAscii } from "./markdown-ascii-graph.ts";

export { renderChecklistCoverage } from "./markdown-checklist-coverage.ts";

export {
  renderGates,
  renderProbesAndPushbacks,
  renderScripts,
  renderTools,
} from "./markdown-evidence-sections.ts";

export {
  renderAgents,
  renderBranches,
  renderFilesChanged,
  renderPhases,
  renderTaskTrajectory,
} from "./markdown-execution-sections.ts";

export type { AttributedFileRef } from "./markdown-file-provenance.ts";
export { fileProvenanceDetails, fileProvenanceTable } from "./markdown-file-provenance.ts";

export type { MarkdownFormatterInput } from "./markdown-formatter.ts";
export { formatSummaryMarkdown } from "./markdown-formatter.ts";

export {
  renderEnhancedPlan,
  renderOriginalPrompt,
  renderRequirements,
  renderRunIdentity,
  renderTaskGraphSection,
  renderTopology,
} from "./markdown-plan-sections.ts";

export {
  UNKNOWN,
  cell,
  code,
  evidenceLabel,
  evidencedText,
  fence,
  formatDuration,
  joinOrNone,
  joinOrUnknown,
  note,
  numberOrUnknown,
  section,
  table,
  textOrUnknown,
  toolRefText,
} from "./markdown-primitives.ts";

export type { ReportContext, ReportContextInput } from "./markdown-report-context.ts";
export { buildReportContext } from "./markdown-report-context.ts";

export { renderCritic, renderTelemetry, renderTimeline } from "./markdown-run-sections.ts";

export type {
  AdjacentFindingView,
  ChecklistCoverageItemView,
  CommandView,
  CriticReportView,
  DispositionView,
  EnhancedPlanView,
  GateView,
  PlanEntryView,
  RequirementView,
  TaskChecklistCoverageView,
} from "./markdown-sources.ts";
export {
  readBranches,
  readCommands,
  readCriticReport,
  readDispositions,
  readEnhancedPlan,
  readGates,
  readGraphRevision,
  readRequirements,
  readTaskChecklistCoverage,
  readTopologyRecord,
} from "./markdown-sources.ts";

export { renderActionProvenance } from "./markdown-step-provenance.ts";

export type { LogRead, TaskCommandPartition } from "./node-evidence.ts";
export {
  LOG_READ_CEILING_BYTES,
  buildNodeScripts,
  buildStateTransitions,
  isCriticCommand,
  partitionTaskCommands,
  readLog,
  readLogText,
} from "./node-evidence.ts";
