import type {
  SanitizationOptions,
  SanitizationResult,
  ToolParameter,
  ToolParameterType,
  ToolValidationError,
} from "./types.ts";

export function validateTypeOnly(type: ToolParameterType, value: unknown): boolean {
  if (value === null || value === undefined) return false;
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number" && !Number.isNaN(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    default:
      return false;
  }
}

export function coerceValue(value: unknown, targetType: ToolParameterType): unknown {
  if (value === null || value === undefined) return value;
  switch (targetType) {
    case "string":
      return typeof value === "string" ? value : String(value);
    case "number":
    case "integer": {
      if (typeof value === "number") return value;
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed === "") return value;
        const num = Number(trimmed);
        return Number.isNaN(num) ? value : num;
      }
      if (typeof value === "boolean") return value ? 1 : 0;
      return value;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      if (value === "true" || value === 1 || value === "1") return true;
      if (value === "false" || value === 0 || value === "0") return false;
      return value;
    }
    case "object": {
      if (typeof value === "object" && !Array.isArray(value)) return value;
      if (typeof value === "string") {
        try {
          const parsed = JSON.parse(value);
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
            return parsed;
        } catch {}
      }
      return value;
    }
    case "array": {
      if (Array.isArray(value)) return value;
      if (typeof value === "string") {
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) return parsed;
        } catch {}
      }
      return value;
    }
    default:
      return value;
  }
}

export function validateParameter(
  param: ToolParameter,
  rawValue: unknown,
  options: SanitizationOptions = {},
  pathPrefix = "",
): {
  readonly valid: boolean;
  readonly value: unknown;
  readonly errors: readonly ToolValidationError[];
} {
  const errors: ToolValidationError[] = [];
  const fieldName = pathPrefix ? `${pathPrefix}.${param.name}` : param.name;
  let value = rawValue;

  if (
    (value === undefined || value === null) &&
    options.applyDefaults !== false &&
    param.defaultValue !== undefined
  ) {
    value = param.defaultValue;
  }

  if (value === undefined || value === null) {
    if (param.required) {
      errors.push({
        field: fieldName,
        code: "REQUIRED",
        message: `Missing required parameter '${fieldName}'`,
        expected: param.type,
      });
    }
    return { valid: errors.length === 0, value, errors };
  }

  if (options.coerceTypes) value = coerceValue(value, param.type);

  if (!validateTypeOnly(param.type, value)) {
    errors.push({
      field: fieldName,
      code: "INVALID_TYPE",
      message: `Parameter '${fieldName}' must be of type ${param.type}`,
      received: typeof value,
      expected: param.type,
    });
    return { valid: false, value, errors };
  }

  if (param.integer && typeof value === "number" && !Number.isInteger(value)) {
    errors.push({
      field: fieldName,
      code: "NOT_INTEGER",
      message: `Parameter '${fieldName}' must be an integer`,
      received: value,
      expected: "integer",
    });
  }

  if (param.enumValues && param.enumValues.length > 0) {
    const matched = param.enumValues.some((allowed) => allowed === value);
    if (!matched) {
      errors.push({
        field: fieldName,
        code: "INVALID_ENUM",
        message: `Parameter '${fieldName}' must be one of: ${param.enumValues.join(", ")}`,
        received: value,
        expected: param.enumValues.join(" | "),
      });
    }
  }

  if (param.type === "string" && typeof value === "string") {
    if (param.minLength !== undefined && value.length < param.minLength) {
      errors.push({
        field: fieldName,
        code: "MIN_LENGTH",
        message: `String '${fieldName}' must have at least ${param.minLength} characters`,
        received: value.length,
        expected: `>= ${param.minLength}`,
      });
    }
    if (param.maxLength !== undefined && value.length > param.maxLength) {
      errors.push({
        field: fieldName,
        code: "MAX_LENGTH",
        message: `String '${fieldName}' must have at most ${param.maxLength} characters`,
        received: value.length,
        expected: `<= ${param.maxLength}`,
      });
    }
    if (param.pattern) {
      try {
        if (!new RegExp(param.pattern).test(value)) {
          errors.push({
            field: fieldName,
            code: "PATTERN_MISMATCH",
            message: `String '${fieldName}' does not match pattern /${param.pattern}/`,
            received: value,
            expected: param.pattern,
          });
        }
      } catch {}
    }
  }

  if ((param.type === "number" || param.type === "integer") && typeof value === "number") {
    if (param.minimum !== undefined && value < param.minimum) {
      errors.push({
        field: fieldName,
        code: "MIN_VALUE",
        message: `Number '${fieldName}' must be at least ${param.minimum}`,
        received: value,
        expected: `>= ${param.minimum}`,
      });
    }
    if (param.maximum !== undefined && value > param.maximum) {
      errors.push({
        field: fieldName,
        code: "MAX_VALUE",
        message: `Number '${fieldName}' must be at most ${param.maximum}`,
        received: value,
        expected: `<= ${param.maximum}`,
      });
    }
  }

  if (param.type === "array" && Array.isArray(value) && param.itemType) {
    const itemTypeStr: ToolParameterType =
      typeof param.itemType === "string"
        ? (param.itemType as ToolParameterType)
        : (param.itemType.type as ToolParameterType);
    const itemErrors: ToolValidationError[] = [];
    const sanitizedItems: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      let itemVal = value[i];
      if (options.coerceTypes) itemVal = coerceValue(itemVal, itemTypeStr);
      if (!validateTypeOnly(itemTypeStr, itemVal)) {
        itemErrors.push({
          field: `${fieldName}[${i}]`,
          code: "INVALID_ITEM",
          message: `Array item at index ${i} for '${fieldName}' must be ${itemTypeStr}`,
          received: typeof itemVal,
          expected: itemTypeStr,
        });
      }
      sanitizedItems.push(itemVal);
    }
    if (itemErrors.length > 0) errors.push(...itemErrors);
    else value = sanitizedItems;
  }

  if (
    param.type === "object" &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    param.properties
  ) {
    const propsList: readonly ToolParameter[] = Array.isArray(param.properties)
      ? (param.properties as readonly ToolParameter[])
      : Object.entries(param.properties).map(([pName, p]) => ({
          name: pName,
          type: p.type as ToolParameterType,
          description: p.description ?? "",
          required: p.required,
          defaultValue: p.defaultValue,
          enumValues: p.enumValues,
        }));
    const nestedRes = sanitizeAndValidatePayload(
      propsList,
      value as Record<string, unknown>,
      options,
    );
    if (!nestedRes.valid && nestedRes.errors) {
      for (const nestedErr of nestedRes.errors) {
        if (typeof nestedErr === "object" && nestedErr !== null) {
          errors.push({ ...nestedErr, field: `${fieldName}.${nestedErr.field ?? ""}` });
        }
      }
    } else if (nestedRes.sanitized) {
      value = nestedRes.sanitized;
    }
  }

  return { valid: errors.length === 0, value, errors };
}

export function sanitizeAndValidatePayload(
  parameters: readonly ToolParameter[],
  payload: Record<string, unknown>,
  options: SanitizationOptions = {},
): SanitizationResult {
  const errors: ToolValidationError[] = [];
  const sanitized: Record<string, unknown> = {};
  const knownParamNames = new Set(parameters.map((p) => p.name));

  for (const [key, val] of Object.entries(payload)) {
    if (!knownParamNames.has(key)) {
      if (options.rejectUnknownProperties) {
        errors.push({
          field: key,
          code: "UNKNOWN_PROPERTY",
          message: `Unknown property '${key}' is not allowed`,
          received: key,
        });
      } else if (!options.stripUnknownProperties) {
        sanitized[key] = val;
      }
    }
  }

  for (const param of parameters) {
    const rawVal = payload[param.name];
    const validation = validateParameter(param, rawVal, options);
    if (!validation.valid) {
      errors.push(...validation.errors);
    } else if (validation.value !== undefined) {
      sanitized[param.name] = validation.value;
    }
  }

  return {
    valid: errors.length === 0,
    safe: errors.length === 0,
    errors,
    sanitized,
    sanitizedPayload: sanitized,
  };
}
