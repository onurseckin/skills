export {
  CANONICAL_ROLES,
  isCanonicalRole,
  type AgentRole,
  type DoctorAgentReport,
  type EvaluationContext,
  type PostActionInput,
  type PostActionResult,
  type PreActionInput,
  type PreActionResult,
  type RoleDiagnosticProfile,
  type RoutingJourney,
  type SentinelSeverity,
  type SentinelViolation,
  type StrikeRecord,
  type TurnEndInput,
  type TurnEndResult,
} from "./types.ts";

export {
  inspectAstPurity,
  inspectDirectoryFanout,
  inspectPhysicalLines,
  inspectSourceFile,
  type FileInspectionResult,
} from "./ast-inspector.ts";

export {
  clearInMemoryStrikes,
  determineStrikeAction,
  getStrikeRecord,
  recordStrike,
  renderMarkdownRemediationBrief,
  resetStrikes,
  setInMemoryStrikeMode,
} from "./strike-ladder.ts";

export {
  clearInMemoryDispatches,
  dispatchSentinelInterjection,
  generateRoutingJourney,
  getInMemoryDispatches,
  setInMemoryRouterMode,
  type MailboxDispatchResult,
  type MailboxInterjectionOptions,
} from "./mailbox-router.ts";

export { executePostActionHook, executePreActionHook, executeTurnEndHook } from "./hooks.ts";

export {
  formatDoctorAgentMarkdown,
  runDoctorAgent,
  runSentinelWatch,
  type DoctorAgentOptions,
  type SentinelWatchOptions,
  type SentinelWatchResult,
} from "./runner.ts";

export {
  ALL_PROFILES,
  completenessCriticProfile,
  coordinatorProfile,
  getProfileForRole,
  implementerProfile,
  mindAuditorProfile,
  mindProfile,
  orchestratorProfile,
  planValidatorProfile,
  plannerProfile,
  policyDiscoveryProfile,
  skillAuditorProfile,
  subImplementerProfile,
  subInvestigatorProfile,
  subValidatorProfile,
  uiHeadlessValidatorProfile,
  uiOpticalValidatorProfile,
  validatorProfile,
} from "./profiles/index.ts";
