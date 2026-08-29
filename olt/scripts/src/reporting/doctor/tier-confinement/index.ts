/**
 * Tier Confinement Doctor Rules & Boundary Auditing Facade
 */
export {
  type TierViolationType,
  type TierViolationSeverity,
  type TierConfinementFinding,
  type TierConfinementSummary,
  type GitDiffRecord,
} from "./types.ts";
export {
  DOCTOR_SUPERVISOR_CODE_CONTAMINATION,
  CODE_EDIT_TOOLS,
  GRAPH_MUTATION_COMMANDS,
  VALIDATION_COMMANDS,
  TERMINAL_PULSE_OUTCOMES,
  isMindRole,
  isCoordinatorRole,
  isOrchestratorRole,
  isImplementerRole,
  isValidatorRole,
  isTier3Role,
  isFullTestSuiteCommand,
  isSourceCodeFile,
  inferRole,
  deduplicateFindings,
} from "./constants.ts";
export {
  auditCrossTierSpawning,
  auditCoordinatorConfinement,
  auditSupervisorCodeContamination,
} from "./audit-supervisor.ts";
export { auditOrchestratorConfinement } from "./audit-orchestrator.ts";
export { auditImplementerConfinement } from "./audit-implementer.ts";
export { auditPulseTerminationConfinement } from "./audit-pulse.ts";
export {
  auditTierConfinement,
  summarizeTierConfinement,
  assertSupervisorRoleConfinement,
} from "./auditor.ts";
