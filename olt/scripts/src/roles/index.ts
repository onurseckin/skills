export { renderAsciiRoleTable } from "./ascii-table.ts";
export { FORBIDDEN_VALIDATOR_COMMANDS, validateRoleAuthorityInvariants } from "./authority.ts";
export {
  formatUniversalCheatSheet,
  generateRoleCheatSheet,
  listAvailableRoles,
  parseRoleContract,
} from "./cheat-sheets.ts";
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
  ProfileBinding,
  ProfileBindings,
  ResolvedProfile,
  RoleCheatSheet,
  RoleCheatSheetOptions,
  RoleCommandCheatSheet,
  RoleSummary,
  UniversalRoleSpec,
} from "./types.ts";
