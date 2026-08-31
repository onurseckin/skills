/**
 * Tooling Domain Test & Logic Facades.
 * Explicit named exports - zero wildcard export *.
 */
export {
  discoverTools,
  parseToolSpec,
  validateToolSpec,
  generateToolTypeScriptTypes,
  generateToolSchemaJson,
  generateToolModuleDeclaration,
  type DiscoveredTool,
  type ToolDiscoveryOptions,
} from "./discovery/index.ts";

export {
  DynamicToolRegistry,
  getGlobalToolRegistry,
  resetGlobalToolRegistry,
  DynamicRoleRegistry,
  getGlobalRoleRegistry,
  resetGlobalRoleRegistry,
  type ToolDefinition,
  type ToolHandler,
  type ToolExecutionContext,
  type ToolExecutionResult,
  type RoleDefinition,
  type RoleCheatSheetEntry,
} from "./registry/index.ts";

export {
  parseToolParameterSchema,
  buildToolJsonSchema,
  validateToolArgument,
  validateToolInput,
  escapeShellArgument,
  detectShellInjection,
  detectPathTraversal,
  detectPrototypePollution,
  sanitizeDangerousHtml,
  sanitizeToolPayload,
  type ToolParameterSchema,
  type ToolSchemaValidationResult,
  type SecurityPolicy,
  type PayloadSanitizationResult,
} from "./schemas/index.ts";

export {
  SandboxedToolExecutor,
  ResourceGovernor,
  TimeoutWatcher,
  createDefaultSandboxPolicy,
  createCustomSandboxPolicy,
  createDefaultResourcePolicy,
  mergeQuotas,
  resolveIsolationPolicy,
  validateSandboxPolicy,
  BALANCED_QUOTA,
  STRICT_QUOTA,
  PERMISSIVE_QUOTA,
  UNCONSTRAINED_QUOTA,
  type ResourceQuota,
  type SandboxPolicy,
  type IsolationLevel,
  type QuotaViolation,
  type IsolationConfig,
  type SandboxExecutionOptions,
  type SandboxExecutionResult,
  type SystemMetricsProvider,
  type MetricSample,
  type TimeoutWatcherOptions,
  type TimeoutWatcherState,
} from "./sandbox/index.ts";
