export type ToolParameterType = "string" | "number" | "boolean" | "object" | "array" | "integer";

export type SanitizationPolicyType =
  | "none"
  | "strict-alphanumeric"
  | "path"
  | "shell-arg"
  | "sql-param"
  | "html-escape"
  | "json-safe";

export interface ParameterSchemaConstraint {
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
  readonly minimum?: number | undefined;
  readonly maximum?: number | undefined;
  readonly multipleOf?: number | undefined;
  readonly pattern?: string | undefined;
  readonly items?: ToolParameterSchema | undefined;
  readonly properties?: Record<string, ToolParameterSchema> | undefined;
  readonly requiredProperties?: readonly string[] | undefined;
  readonly additionalProperties?: boolean | undefined;
  readonly sanitizationPolicy?: SanitizationPolicyType | undefined;
}

export interface ToolParameterSchema {
  name: string;
  type: ToolParameterType;
  description?: string | undefined;
  required?: boolean | undefined;
  enumValues?: readonly (string | number | boolean)[] | undefined;
  defaultValue?: unknown;
  itemType?: string | ToolParameterSchema | undefined;
  properties?: Record<string, ToolParameterSchema> | readonly ToolParameterSchema[] | undefined;
  integer?: boolean | undefined;
  constraints?: ParameterSchemaConstraint | undefined;
  pattern?: string | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
  minimum?: number | undefined;
  maximum?: number | undefined;
  multipleOf?: number | undefined;
  items?: ToolParameterSchema | undefined;
  requiredProperties?: readonly string[] | undefined;
  additionalProperties?: boolean | undefined;
  sanitizationPolicy?: SanitizationPolicyType | undefined;
}

export interface ToolParameter {
  readonly name: string;
  readonly type: ToolParameterType;
  readonly description?: string | undefined;
  readonly required?: boolean | undefined;
  readonly defaultValue?: unknown;
  readonly enumValues?: readonly (string | number | boolean)[] | undefined;
  readonly itemType?: string | ToolParameterSchema | undefined;
  readonly pattern?: string | undefined;
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
  readonly minimum?: number | undefined;
  readonly maximum?: number | undefined;
  readonly integer?: boolean | undefined;
  readonly properties?:
    | Record<string, ToolParameterSchema>
    | readonly ToolParameterSchema[]
    | readonly ToolParameter[]
    | undefined;
  readonly constraints?: ParameterSchemaConstraint | undefined;
}

export interface ToolSecurityPolicy {
  readonly allowShellMetacharacters?: boolean | undefined;
  readonly allowAbsolutePaths?: boolean | undefined;
  readonly allowParentDirectoryTraversal?: boolean | undefined;
  readonly sanitizeHtml?: boolean | undefined;
  readonly maxStringLength?: number | undefined;
  readonly blockPrototypePollution?: boolean | undefined;
  readonly strictParameterWhitelist?: readonly string[] | undefined;
  readonly maxDepth?: number | undefined;
  readonly maxArrayLength?: number | undefined;
  readonly preventPrototypePollution?: boolean | undefined;
  readonly allowShellExecution?: boolean | undefined;
  readonly stripUnsafeHtml?: boolean | undefined;
  readonly blockedPatterns?: readonly (string | RegExp)[] | undefined;
  readonly allowedPaths?: readonly string[] | undefined;
}

export interface ToolContext {
  readonly agentId?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly sessionDir?: string | undefined;
  readonly abortSignal?: AbortSignal | undefined;
  readonly environment?: Record<string, string> | undefined;
  readonly sandboxEnabled?: boolean | undefined;
  readonly securityPolicy?: ToolSecurityPolicy | undefined;
}

export interface ParameterValidationError {
  readonly path: string;
  readonly code: string;
  readonly message: string;
  readonly receivedValue?: unknown;
}

export interface InputValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ParameterValidationError[];
  readonly sanitizedArgs: Record<string, unknown>;
}

export interface ValidationOptions {
  readonly strictUnknownProperties?: boolean | undefined;
  readonly applyDefaults?: boolean | undefined;
  readonly allowTypeCoercion?: boolean | undefined;
  readonly deepSanitize?: boolean | undefined;
  readonly securityPolicy?: ToolSecurityPolicy | undefined;
}

export interface SecurityViolation {
  readonly parameterName?: string | undefined;
  readonly field?: string | undefined;
  readonly violationType?:
    | "command-injection"
    | "path-traversal"
    | "prototype-pollution"
    | "unsafe-characters"
    | "policy-violation"
    | undefined;
  readonly threatType?:
    | "COMMAND_INJECTION"
    | "PATH_TRAVERSAL"
    | "PROTOTYPE_POLLUTION"
    | "XSS_OR_SCRIPT_INJECTION"
    | "PAYLOAD_TOO_LARGE"
    | "FORBIDDEN_PATTERN"
    | "NULL_BYTE_INJECTION"
    | undefined;
  readonly details?: string | undefined;
  readonly message?: string | undefined;
  readonly rawValue?: unknown;
}

export interface ToolValidationError {
  field?: string | undefined;
  message: string;
  code: string;
  received?: unknown;
  expected?: string | undefined;
}

export interface ToolExecutionResult {
  readonly success: boolean;
  readonly output: unknown;
  readonly error?: string | undefined;
  readonly durationMs: number;
  readonly toolName: string;
  readonly validationErrors?: readonly ToolValidationError[] | undefined;
  readonly securityViolations?: readonly SecurityViolation[] | undefined;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context?: ToolContext | undefined,
) => Promise<unknown> | unknown;

export interface ToolMetadata {
  readonly version?: string | undefined;
  readonly author?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly deprecated?: boolean | undefined;
  readonly deprecationReason?: string | undefined;
  readonly sandboxRequired?: boolean | undefined;
  readonly isolationLevel?: ("none" | "strict" | "permissive" | "read_only") | undefined;
  readonly securityPolicy?: ToolSecurityPolicy | undefined;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly parameters: readonly (ToolParameter | ToolParameterSchema)[];
  readonly handler?: ToolHandler | undefined;
  readonly aliases?: readonly string[] | undefined;
  readonly metadata?: ToolMetadata | undefined;
  readonly enabled?: boolean | undefined;
  readonly securityPolicy?: ToolSecurityPolicy | undefined;
}

export interface ToolFilter {
  readonly category?: string | undefined;
  readonly tag?: string | undefined;
  readonly enabledOnly?: boolean | undefined;
  readonly includeDeprecated?: boolean | undefined;
  readonly search?: string | undefined;
}

export interface ToolRegistryStats {
  readonly totalTools: number;
  readonly enabledTools: number;
  readonly totalInvocations: number;
  readonly categoryCounts: Record<string, number>;
}

export interface ToolCatalogExport {
  readonly exportedAt: string;
  readonly totalTools: number;
  readonly tools: readonly ToolDefinition[];
}

export interface CodegenOptions {
  target?: "typescript" | "json-schema" | undefined;
  exportType?: ("interface" | "type") | undefined;
  includeHandlerSignature?: boolean | undefined;
  strictNullChecks?: boolean | undefined;
}

export interface DiscoveredTool {
  name?: string | undefined;
  path?: string | undefined;
  valid?: boolean | undefined;
  errors?: readonly string[] | undefined;
  definition?: ToolDefinition | undefined;
  sourcePath?: string | undefined;
  loadedAt?: string | undefined;
}

export interface DiscoveryOptions {
  directory?: string | undefined;
  extensions?: readonly string[] | undefined;
  recursive?: boolean | undefined;
  defaultCategory?: string | undefined;
  ignorePatterns?: readonly string[] | undefined;
  autoRegister?: boolean | undefined;
}

export interface DiscoveryReport {
  total?: number | undefined;
  valid?: number | undefined;
  invalid?: number | undefined;
  discoveredCount?: number | undefined;
  registeredCount?: number | undefined;
  errors?:
    | readonly string[]
    | readonly { readonly path: string; readonly error: string }[]
    | undefined;
  tools: readonly DiscoveredTool[];
}

export interface JsonSchemaProperty {
  type: string | readonly string[];
  description?: string | undefined;
  enum?: readonly (string | number | boolean)[] | undefined;
  default?: unknown;
  items?: JsonSchemaProperty | undefined;
  properties?: Record<string, JsonSchemaProperty> | undefined;
  required?: readonly string[] | undefined;
  pattern?: string | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
  minimum?: number | undefined;
  maximum?: number | undefined;
}

export interface JsonSchemaDocument {
  $schema?: string | undefined;
  type: string;
  title?: string | undefined;
  description?: string | undefined;
  properties: Record<string, JsonSchemaProperty>;
  required?: readonly string[] | undefined;
  additionalProperties?: boolean | undefined;
}

export interface SanitizationOptions {
  strict?: boolean | undefined;
  maxDepth?: number | undefined;
  allowExtraFields?: boolean | undefined;
  coerceTypes?: boolean | undefined;
  stripUnknownProperties?: boolean | undefined;
  rejectUnknownProperties?: boolean | undefined;
  applyDefaults?: boolean | undefined;
}

export interface SanitizationResult {
  valid: boolean;
  safe: boolean;
  errors: readonly (string | ToolValidationError)[];
  sanitizedPayload?: Record<string, unknown> | undefined;
  sanitized: Record<string, unknown>;
  violations?: readonly SecurityViolation[] | undefined;
}
