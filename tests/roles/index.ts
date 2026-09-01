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
  resolveAbstractProfile,
  formatRoleCheatSheet,
  formatCommandCheatSheet,
  buildRoleCheatSheetData,
  buildAllRolesCheatSheetData,
  type RoleResolutionInput,
  type RoleResolutionResult,
} from "./profiles/index.ts";
