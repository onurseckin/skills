export { renderAsciiRoleTable } from "./ascii-table.ts";
export { FORBIDDEN_VALIDATOR_COMMANDS, validateRoleAuthorityInvariants } from "./authority.ts";
export {
  CANONICAL_ROLE_CAPABILITIES,
  evaluateWatchdogRoleBoundary,
  getRoleCapabilities,
  isCodeWritePermitted,
  isCommandPermitted,
  isSubagentSpawnPermitted,
} from "./capability-matrix.ts";
export {
  formatUniversalCheatSheet,
  generateRoleCheatSheet,
  listAvailableRoles,
  parseRoleContract,
} from "./cheat-sheets.ts";
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
export { buildCommandCheatSheet, formatCommandSyntax } from "./syntax.ts";
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
