/**
 * Authority Manifest Subdomain Test Facade.
 * Explicit named exports for manifest schemas, parsers, and role contract loaders.
 */

export {
  parseYaml,
  parseMarkdownFrontmatter,
  parseRoleContract,
  parseAgentManifest,
  loadRoleContract,
  loadAgentManifest,
  loadUnifiedAgentModel,
  listAvailableRoles,
  listAvailableManifests,
  clearManifestCache,
  findSkillRoot,
  normalizeRoleName,
  type AgentManifest,
  type RoleContract,
  type UnifiedAgentModel,
} from "../../../olt/scripts/src/authority/manifest/index.ts";

export {
  parseUnifiedAgentManifest,
  validateUnifiedAgentManifest,
  type UnifiedAgentManifest,
} from "../../../olt/scripts/src/authority/manifest-schema.ts";
