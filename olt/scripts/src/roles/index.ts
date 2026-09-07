export {
  renderAsciiRoleTable,
  formatUniversalCheatSheet,
  generateRoleCheatSheet,
  listAvailableRoles,
  parseRoleContract,
  buildCommandCheatSheet,
  formatCommandSyntax,
} from "./presentation/index.ts";
export { FORBIDDEN_VALIDATOR_COMMANDS, validateRoleAuthorityInvariants } from "./authority.ts";
export { CANONICAL_ROLE_CAPABILITIES } from "./capability-matrix.ts";
export {
  evaluateWatchdogRoleBoundary,
  getRoleCapabilities,
  isCodeWritePermitted,
  isCommandPermitted,
  isSubagentSpawnPermitted,
} from "./role-boundary.ts";
export {
  assertValidManifest,
  validateAgentManifestSchema,
  validateRoleContractSchema,
} from "./manifest-schema.ts";
export {
  canonicalizePersonaInput,
  computePersonaSignatureHash,
  hashManifestSpec,
  hashRoleContract,
  verifyPersonaIntegrity,
} from "./persona-hash.ts";
export {
  ABSTRACT_PROFILES,
  ABSTRACT_PROFILE_SET,
  ROLE_PROFILE_MAP,
  formatHostDegradation,
  isAbstractProfile,
  isPerAgentModelSelectionSupported,
  resolveAgentProfile,
  resolveProfile,
  resolveRoleArchetype,
  roleToProfile,
} from "./profiles.ts";
export type {
  AbstractProfile,
  AgentProfileResolution,
  CommandSyntaxInfo,
  ManifestSchemaError,
  ManifestSchemaValidationResult,
  PersonaIntegrityReport,
  PersonaSignatureDigest,
  PersonaSignatureInput,
  ProfileBinding,
  ProfileBindings,
  ResolvedProfile,
  RoleActionType,
  RoleBoundaryViolation,
  RoleCapabilityEntry,
  RoleCapabilityMatrix,
  RoleCheatSheet,
  RoleCheatSheetOptions,
  RoleCommandCheatSheet,
  RoleExecutionTier,
  RoleSummary,
  UniversalRoleSpec,
} from "./types.ts";
