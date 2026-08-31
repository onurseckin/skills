/**
 * Agents Domain Test & Logic Facades.
 * Explicit named exports - zero wildcard export *.
 */
export {
  releaseGrantInLedger,
  releaseAllActiveGrants,
  executeAgentReset,
  formatAgentResetBrief,
} from "./lifecycle/index.ts";

export {
  AGENT_NAMING_STANDARDS,
  parseStandardAgentId,
  recommendAgentId,
  validateAgentNamingStandard,
  roleToTier,
  agentIdToTier,
  detectHostApp,
  buildCapabilitiesProfile,
  parseTier,
  roleToExecutionTier,
  agentIdToRoleAndTier,
  whoamiCommand,
} from "./identity/index.ts";

export {
  AGENT_LEDGER_KEY,
  readAgentLedger,
  writeAgentLedger,
  findGrant,
  requireGrant,
  replaceGrant,
  knownTaskIds,
  assertAgentBudget,
  ancestorChain,
  childrenOf,
  taskLineage,
  resolveAttribution,
  resolveAttributionInLedger,
  describeAttribution,
  assertAttribution,
} from "./ledger/index.ts";

export {
  registerAgentGrant,
  releaseAgentGrant,
  recordAgentReport,
  seededRun,
  ledgerOf,
  eventKinds,
  lastPayload,
  registerCoordinator,
  type RegisterAgentGrantInput,
  type ReleaseAgentGrantInput,
  type RecordAgentReportInput,
} from "./grants/index.ts";

export {
  mergeObservedCount,
  mergeObservedExtras,
  mergeObservedTools,
  transcriptAuditContext,
  checkParentAgentConflict,
  appendTelemetryConflicts,
  refreshAgentDerivedTelemetry,
  writeAgentModelTelemetry,
  readAgentModelTelemetry,
  buildTranscriptFixture,
  type TranscriptFixtureOptions,
} from "./telemetry/index.ts";

export {
  parseUnifiedAgentManifest,
  validateUnifiedAgentManifest,
  type UnifiedAgentManifest,
} from "./governance/index.ts";
