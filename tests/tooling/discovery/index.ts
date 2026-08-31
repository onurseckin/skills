/**
 * Tool Discovery & Codegen Facade.
 */
export {
  discoverTools,
  parseToolSpec,
  validateToolSpec,
  type DiscoveredTool,
  type ToolDiscoveryOptions,
} from "../../../olt/scripts/src/tooling/discovery.ts";

export {
  generateToolTypeScriptTypes,
  generateToolSchemaJson,
  generateToolModuleDeclaration,
} from "../../../olt/scripts/src/tooling/schema-codegen.ts";
