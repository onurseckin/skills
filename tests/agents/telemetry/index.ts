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
} from "../../../olt/scripts/src/workflow/agents/telemetry-derived.ts";

export {
  writeAgentModelTelemetry,
  readAgentModelTelemetry,
} from "../../../olt/scripts/src/workflow/agents/telemetry.ts";

export {
  buildTranscriptFixture,
  type TranscriptFixtureOptions,
} from "./transcript-fixture.ts";
