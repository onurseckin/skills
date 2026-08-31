/**
 * Dynamic Tool & Role Registry Facade.
 */
export {
  DynamicToolRegistry,
  getGlobalToolRegistry,
  resetGlobalToolRegistry,
  type ToolDefinition,
  type ToolHandler,
  type ToolExecutionContext,
  type ToolExecutionResult,
} from "../../../olt/scripts/src/tooling/registry.ts";

export {
  DynamicRoleRegistry,
  getGlobalRoleRegistry,
  resetGlobalRoleRegistry,
  type RoleDefinition,
  type RoleCheatSheetEntry,
} from "../../../olt/scripts/src/tooling/role-registry.ts";
