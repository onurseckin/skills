/**
 * Roles Domain Test & Logic Facades.
 * Explicit named exports - zero wildcard export *.
 */
export {
  loadRoleContract,
  resolveRoleContractPath,
  verifyMindRoleStrategicInvariants,
} from "./contracts/index.ts";

export { loadAgentManifest, loadUnifiedAgentModel } from "./ecosystem/index.ts";

export {
  isExecutionCommand,
  isExecutionToolCategory,
  isProhibitedCognitiveTool,
  assertRoleMayInvoke,
  isAgentRole,
} from "./personas/index.ts";

export {
  resolveProfile,
  resolveAgentProfile,
  roleToProfile,
  formatUniversalCheatSheet,
  generateRoleCheatSheet,
  buildCommandCheatSheet,
  formatCommandSyntax,
} from "./profiles/index.ts";

export {
  setupVirtualRolesFS,
  cleanupVirtualRolesFS,
  getVirtualRolesFS,
  scratchRoot,
} from "./fixture.ts";
