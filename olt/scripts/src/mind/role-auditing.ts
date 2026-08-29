export {
  computePersonaSignature,
  calculatePersonaSimilarity,
  findSimilarPersonas,
  type PersonaSignature,
  type PersonaSimilarityMetrics,
  type NonDuplicateRoleSynthesisResult,
  type SynthesizeNonDuplicateRoleOptions,
  type RoleAuditOptions,
  type RoleAuditSummary,
  type RoleAuditReport,
} from "./auditing/slices/group0/slice_13.ts";

export {
  synthesizeNonDuplicatePersona,
} from "./auditing/slices/group0/slice_14.ts";

export {
  auditSingleRole,
} from "./auditing/slices/group0/slice_15.ts";

export {
  auditDynamicRoles,
  runAutonomousMindRoleAudit,
  formatRoleAuditMarkdown,
  renderRoleAuditAsciiTable,
  formatNonDuplicatePersonaSummary,
  isMindRole,
  CODE_EDIT_TOOLS,
  GRAPH_MUTATION_COMMANDS,
  VALIDATION_COMMANDS,
} from "./auditing/slices/group0/slice_16.ts";

export {
  isOrchestratorRole,
  isCoordinatorRole,
  isImplementerRole,
  isValidatorRole,
  isMechanicValidatorRole,
  isCognitiveValidatorRole,
  isFullTestSuiteCommand,
  roleToTier,
  PROHIBITED_COGNITIVE_TOOLS,
  PROHIBITED_COGNITIVE_TOOL_CATEGORIES,
  type RoleBoundaryAction,
  type RoleBoundaryViolation,
  type RoleBoundaryAuditResult,
  type RoleBoundaryWatchdogOptions,
} from "./auditing/slices/group0/slice_17.ts";

export {
  RoleBoundaryWatchdog,
} from "./auditing/slices/group0/slice_18.ts";

export {
  createRoleBoundaryWatchdog,
  verifyRoleBoundaryAction,
  auditRoleBoundaryActions,
  validateParentChildSupervision,
  assertParentChildBoundary,
  type ParentChildSupervisionResult,
} from "./auditing/slices/group0/slice_19.ts";
