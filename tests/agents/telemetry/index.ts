/**
 * Agent Telemetry Facade.
 */
export {
  mergeObservedCount,
  mergeObservedExtras,
  mergeObservedTools,
  transcriptAuditContext,
  checkParentAgentConflict,
  appendTelemetryConflicts,
  refreshAgentDerivedTelemetry,
} from "../../../olt/scripts/src/workflow/agents/telemetry-merge.ts";

export {
  extractTranscriptTelemetry,
  readAgentTranscriptTelemetry,
} from "../../../olt/scripts/src/workflow/agents/transcript-telemetry.ts";

export {
  assistantLine,
  toolResultLine,
  writeDirectTranscript,
  mktemp,
  cleanupTranscriptRoots,
} from "./transcript-fixture.ts";
