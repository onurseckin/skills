export type {
  DynamicRoleSpec,
  DynamicRoleContract,
  DynamicRoleValidationResult,
  DynamicRoleSynthesisPlan,
  SynthesizeRoleOptions,
  RoleArchetype,
  WriteScopePolicy,
  RoleCheatSheet,
  RoleCheatSheetOptions,
  RoleSpecializationDomain,
  RoleLineageEntry,
  TaskRoleSynthesisParams,
  DefectRoleSynthesisParams,
  RoleMutationFeedback,
  DynamicRoleCatalogExport,
  DynamicRoleFilter,
} from "./types.ts";

export {
  ARCHETYPE_TIER_MAP,
  ARCHETYPE_DEFAULT_COMMANDS,
  ARCHETYPE_DEFAULT_SPAWNS,
  ARCHETYPE_DEFAULT_WRITE_POLICY,
  FORBIDDEN_COMMANDS,
  ROLE_NAME_PATTERN,
} from "./types.ts";

export {
  validateDynamicRoleSpec,
  assertValidDynamicRoleSpec,
  formatDynamicRoleFrontmatter,
  formatDynamicRoleBody,
  formatDynamicRoleMarkdown,
} from "./validation.ts";

export { synthesizeDynamicRole } from "./synthesizer.ts";

export {
  parseDynamicRoleContract,
  parseDynamicRoleContract as parseDynamicRoleContractFromMarkdown,
} from "./parser.ts";

export {
  synthesizeRoleFromTaskRequirements,
  synthesizeRoleFromDefectRemediation,
  synthesizeRoleFromDefectRemediation as synthesizeRoleFromDefect,
  mutateRoleWithFeedback,
  mutateRoleWithFeedback as mutateRoleFromSupervisionFeedback,
} from "./mutator.ts";

export { generateDynamicRoleCheatSheet } from "./cheatsheet.ts";

export {
  DynamicRoleRegistry,
  renderDynamicRolesAsciiTable,
  getGlobalRoleRegistry,
  resetGlobalRoleRegistry,
} from "./registry.ts";
