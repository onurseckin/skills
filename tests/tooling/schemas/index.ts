/**
 * Tool Schemas, Validation & Security Sanitizer Facade.
 */
export {
  buildJsonSchemaFromTool,
  parseParameterConstraint,
  parseParameterSchema,
  parseToolSchema,
  type ParameterSchemaParseResult,
  type ToolSchemaParseResult,
} from "../../../olt/scripts/src/tooling/schema-parser.ts";

export {
  validateConstraints,
  validateParameterType,
  validateParameterValue,
  validateToolArguments,
} from "../../../olt/scripts/src/tooling/input-validator.ts";

export {
  detectCommandInjection,
  detectPrototypePollution,
  isSafeExecutionPayload,
  sanitizeHtmlContent,
  sanitizePathTraversal,
  sanitizeShellArgument,
  sanitizeToolInput,
  sanitizeValueByPolicy,
} from "../../../olt/scripts/src/tooling/security-sanitizer.ts";
