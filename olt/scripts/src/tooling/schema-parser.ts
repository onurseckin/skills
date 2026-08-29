import type {
  ParameterSchemaConstraint,
  SanitizationPolicyType,
  ToolDefinition,
  ToolParameterSchema,
  ToolParameterType,
} from "./types.ts";

const VALID_PARAM_TYPES = new Set<ToolParameterType>(["string", "number", "boolean", "object", "array"]);
const VALID_SAN_POLICIES = new Set<SanitizationPolicyType>([
  "none", "strict-alphanumeric", "path", "shell-arg", "sql-param", "html-escape", "json-safe",
]);

export interface ParameterSchemaParseResult {
  readonly valid: boolean;
  readonly schema?: ToolParameterSchema;
  readonly errors: readonly string[];
}

export interface ToolSchemaParseResult {
  readonly valid: boolean;
  readonly definition?: ToolDefinition;
  readonly errors: readonly string[];
}

export function parseParameterConstraint(raw: unknown, path = ""): {
  readonly constraint?: ParameterSchemaConstraint;
  readonly errors: readonly string[];
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { errors: [] };
  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];

  const getNum = (k: string, nonNegInt = false): number | undefined => {
    const v = obj[k];
    if (v === undefined) return undefined;
    if (typeof v !== "number" || Number.isNaN(v) || (nonNegInt && (v < 0 || !Number.isInteger(v)))) {
      errors.push(`${path}.${k} must be a ${nonNegInt ? "non-negative integer" : "valid number"}`);
      return undefined;
    }
    return v;
  };

  const minLength = getNum("minLength", true);
  const maxLength = getNum("maxLength", true);
  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    errors.push(`${path}.minLength cannot exceed maxLength`);
  }

  const minimum = getNum("minimum");
  const maximum = getNum("maximum");
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    errors.push(`${path}.minimum cannot exceed maximum`);
  }

  let multipleOf: number | undefined;
  if (obj.multipleOf !== undefined) {
    if (typeof obj.multipleOf !== "number" || obj.multipleOf <= 0) {
      errors.push(`${path}.multipleOf must be a positive number`);
    } else multipleOf = obj.multipleOf;
  }

  let pattern: string | undefined;
  if (obj.pattern !== undefined) {
    if (typeof obj.pattern !== "string") errors.push(`${path}.pattern must be a regex string`);
    else {
      try { new RegExp(obj.pattern); pattern = obj.pattern; }
      catch { errors.push(`${path}.pattern is an invalid regular expression`); }
    }
  }

  let sanitizationPolicy: SanitizationPolicyType | undefined;
  if (obj.sanitizationPolicy !== undefined) {
    if (typeof obj.sanitizationPolicy !== "string" || !VALID_SAN_POLICIES.has(obj.sanitizationPolicy as SanitizationPolicyType)) {
      errors.push(`${path}.sanitizationPolicy is not recognized`);
    } else sanitizationPolicy = obj.sanitizationPolicy as SanitizationPolicyType;
  }

  let items: ToolParameterSchema | undefined;
  if (obj.items !== undefined) {
    const itemResult = parseParameterSchema(obj.items, `${path}.items`);
    if (!itemResult.valid || !itemResult.schema) errors.push(...itemResult.errors);
    else items = itemResult.schema;
  }

  let properties: Record<string, ToolParameterSchema> | undefined;
  if (obj.properties !== undefined) {
    if (typeof obj.properties !== "object" || Array.isArray(obj.properties) || obj.properties === null) {
      errors.push(`${path}.properties must be a record object`);
    } else {
      const propsRecord: Record<string, ToolParameterSchema> = {};
      for (const [key, propVal] of Object.entries(obj.properties)) {
        const propResult = parseParameterSchema(propVal, `${path}.properties.${key}`);
        if (!propResult.valid || !propResult.schema) errors.push(...propResult.errors);
        else propsRecord[key] = propResult.schema;
      }
      properties = propsRecord;
    }
  }

  const requiredProperties = Array.isArray(obj.requiredProperties) ? obj.requiredProperties.map(String) : undefined;
  if (obj.requiredProperties !== undefined && !Array.isArray(obj.requiredProperties)) {
    errors.push(`${path}.requiredProperties must be an array of strings`);
  }

  const constraint: ParameterSchemaConstraint = {
    ...(minLength !== undefined ? { minLength } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
    ...(minimum !== undefined ? { minimum } : {}),
    ...(maximum !== undefined ? { maximum } : {}),
    ...(multipleOf !== undefined ? { multipleOf } : {}),
    ...(pattern !== undefined ? { pattern } : {}),
    ...(items ? { items } : {}),
    ...(properties ? { properties } : {}),
    ...(requiredProperties ? { requiredProperties } : {}),
    ...(obj.additionalProperties !== undefined ? { additionalProperties: Boolean(obj.additionalProperties) } : {}),
    ...(sanitizationPolicy ? { sanitizationPolicy } : {}),
  };

  return { constraint, errors };
}

export function parseParameterSchema(raw: unknown, path = "parameter"): ParameterSchemaParseResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { valid: false, errors: [`${path} must be an object`] };
  const obj = raw as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  if (!name && !path.includes(".items")) errors.push(`${path}.name is required and must be non-empty`);

  const rawType = typeof obj.type === "string" ? obj.type : "string";
  const typeStr = rawType.toLowerCase() as ToolParameterType;
  if (!VALID_PARAM_TYPES.has(typeStr)) {
    errors.push(`Invalid parameter type '${rawType}' for ${path}.type (must be one of: ${Array.from(VALID_PARAM_TYPES).join(", ")})`);
  }

  let enumValues: readonly (string | number | boolean)[] | undefined;
  if (obj.enumValues !== undefined) {
    if (!Array.isArray(obj.enumValues)) errors.push(`${path}.enumValues must be an array`);
    else enumValues = obj.enumValues.filter((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean");
  }

  const constraintResult = parseParameterConstraint(obj.constraints ?? obj, path);
  if (constraintResult.errors.length > 0) errors.push(...constraintResult.errors);
  if (errors.length > 0) return { valid: false, errors };

  const schema: ToolParameterSchema = {
    name: name || "item",
    type: typeStr,
    description: typeof obj.description === "string" ? obj.description : "",
    ...(obj.required ? { required: true } : {}),
    ...(obj.defaultValue !== undefined ? { defaultValue: obj.defaultValue } : {}),
    ...(enumValues ? { enumValues } : {}),
    ...(constraintResult.constraint && Object.keys(constraintResult.constraint).length > 0
      ? { constraints: constraintResult.constraint }
      : {}),
  };

  return { valid: true, schema, errors: [] };
}

export function parseToolSchema(raw: unknown): ToolSchemaParseResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { valid: false, errors: ["Tool specification must be an object"] };
  const obj = raw as Record<string, unknown>;

  if (typeof obj.name !== "string" || !obj.name.trim()) errors.push("Tool definition requires a non-empty 'name' string");
  if (typeof obj.description !== "string") errors.push("Tool definition requires a 'description' string");

  const parameters: ToolParameterSchema[] = [];
  if (obj.parameters !== undefined) {
    if (!Array.isArray(obj.parameters)) errors.push("'parameters' must be an array");
    else {
      for (let i = 0; i < obj.parameters.length; i++) {
        const paramResult = parseParameterSchema(obj.parameters[i], `parameters[${i}]`);
        if (!paramResult.valid || !paramResult.schema) errors.push(...paramResult.errors);
        else parameters.push(paramResult.schema);
      }
    }
  }

  const meta = obj.metadata && typeof obj.metadata === "object" ? (obj.metadata as Record<string, unknown>) : undefined;
  if (errors.length > 0) return { valid: false, errors };

  const definition: ToolDefinition = {
    name: typeof obj.name === "string" ? obj.name.trim() : "",
    description: typeof obj.description === "string" ? obj.description : "",
    category: typeof obj.category === "string" && obj.category.trim() ? obj.category.trim() : "general",
    parameters,
    enabled: obj.enabled === undefined ? true : Boolean(obj.enabled),
    ...(Array.isArray(obj.aliases) ? { aliases: obj.aliases.map(String) } : {}),
    ...(meta
      ? {
          metadata: {
            ...(typeof meta.version === "string" ? { version: meta.version } : {}),
            ...(typeof meta.author === "string" ? { author: meta.author } : {}),
            ...(Array.isArray(meta.tags) ? { tags: meta.tags.map(String) } : {}),
            deprecated: Boolean(meta.deprecated),
            ...(typeof meta.deprecationReason === "string" ? { deprecationReason: meta.deprecationReason } : {}),
          },
        }
      : {}),
  };

  return { valid: true, definition, errors: [] };
}

export function buildJsonSchemaFromTool(def: ToolDefinition): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const param of def.parameters) {
    const propSchema: Record<string, unknown> = {
      type: param.type,
      description: param.description,
    };
    if (param.enumValues) propSchema.enum = param.enumValues;
    if (param.defaultValue !== undefined) propSchema.default = param.defaultValue;
    if (param.constraints) {
      if (param.constraints.minLength !== undefined) propSchema.minLength = param.constraints.minLength;
      if (param.constraints.maxLength !== undefined) propSchema.maxLength = param.constraints.maxLength;
      if (param.constraints.minimum !== undefined) propSchema.minimum = param.constraints.minimum;
      if (param.constraints.maximum !== undefined) propSchema.maximum = param.constraints.maximum;
      if (param.constraints.pattern !== undefined) propSchema.pattern = param.constraints.pattern;
    }
    properties[param.name] = propSchema;
    if (param.required) required.push(param.name);
  }

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    title: def.name,
    description: def.description,
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}
