/**
 * Tool Schemas, Validation & Security Sanitizer Facade.
 */
export {
  parseToolParameterSchema,
  buildToolJsonSchema,
  validateToolArgument,
  validateToolInput,
  type ToolParameterSchema,
  type ToolSchemaValidationResult,
} from "../../../olt/scripts/src/tooling/schema.ts";

export {
  escapeShellArgument,
  detectShellInjection,
  detectPathTraversal,
  detectPrototypePollution,
  sanitizeDangerousHtml,
  sanitizeToolPayload,
  type SecurityPolicy,
  type PayloadSanitizationResult,
} from "../../../olt/scripts/src/tooling/payload-sanitizer.ts";
