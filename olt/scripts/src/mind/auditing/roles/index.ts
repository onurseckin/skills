export type {
  PersonaSignature,
  PersonaSimilarityMetrics,
  NonDuplicateRoleSynthesisResult,
  SynthesizeNonDuplicateRoleOptions,
  RoleAuditFinding,
  ContractAuditReport,
  RoleAuditOptions,
  RoleAuditSummary,
  RoleAuditReport,
} from "./types.ts";

export {
  computePersonaSignature,
  calculatePersonaSimilarity,
  findSimilarPersonas,
} from "./similarity.ts";

export { synthesizeNonDuplicatePersona } from "./synthesizer.ts";

export { auditSingleRole } from "./contract-auditor.ts";

export {
  auditDynamicRoles,
  runAutonomousMindRoleAudit,
  formatRoleAuditMarkdown,
  renderRoleAuditAsciiTable,
  formatNonDuplicatePersonaSummary,
} from "./batch-auditor.ts";

export {
  CODE_EDIT_TOOLS,
  GRAPH_MUTATION_COMMANDS,
  VALIDATION_COMMANDS,
  isOrchestratorRole,
  isCoordinatorRole,
  isImplementerRole,
  isValidatorRole,
  isMechanicValidatorRole,
  isCognitiveValidatorRole,
  isMindRole,
  isFullTestSuiteCommand,
  roleToTier,
  PROHIBITED_COGNITIVE_TOOLS,
  PROHIBITED_COGNITIVE_TOOL_CATEGORIES,
  type RoleBoundaryAction,
  type RoleBoundaryViolation,
  type RoleBoundaryAuditResult,
  type RoleBoundaryWatchdogOptions,
  checkAntiBoundaryLeak,
  checkValidatorHardLock,
  checkSpawning,
  checkForbidden,
  checkCoordinator,
  checkOrchestrator,
  checkTestRunning,
} from "./rules/index.ts";

export { RoleBoundaryWatchdog } from "./reporter.ts";

export {
  createRoleBoundaryWatchdog,
  verifyRoleBoundaryAction,
  auditRoleBoundaryActions,
  validateParentChildSupervision,
  assertParentChildBoundary,
  type ParentChildSupervisionResult,
} from "./auditor.ts";
