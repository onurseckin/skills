import type {
  InputValidationResult,
  ParameterSchemaConstraint,
  ParameterValidationError,
  ToolParameterSchema,
  ValidationOptions,
} from "./types.ts";

export function validateParameterType(
  type: string,
  value: unknown,
): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    default:
      return false;
  }
}

export function validateConstraints(
  constraints: ParameterSchemaConstraint,
  value: unknown,
  path: string,
): ParameterValidationError[] {
  const errors: ParameterValidationError[] = [];

  if (typeof value === "string") {
    if (constraints.minLength !== undefined && value.length < constraints.minLength) {
      errors.push({
        path,
        code: "MIN_LENGTH_VIOLATION",
        message: `String length ${value.length} is less than minimum ${constraints.minLength}`,
        receivedValue: value,
      });
    }
    if (constraints.maxLength !== undefined && value.length > constraints.maxLength) {
      errors.push({
        path,
        code: "MAX_LENGTH_VIOLATION",
        message: `String length ${value.length} exceeds maximum ${constraints.maxLength}`,
        receivedValue: value,
      });
    }
    if (constraints.pattern) {
      try {
        const regex = new RegExp(constraints.pattern);
        if (!regex.test(value)) {
          errors.push({
            path,
            code: "PATTERN_MISMATCH",
            message: `Value does not match required pattern ${constraints.pattern}`,
            receivedValue: value,
          });
        }
      } catch {}
    }
  }

  if (typeof value === "number" && !Number.isNaN(value)) {
    if (constraints.minimum !== undefined && value < constraints.minimum) {
      errors.push({
        path,
        code: "MINIMUM_VIOLATION",
        message: `Value ${value} is less than minimum ${constraints.minimum}`,
        receivedValue: value,
      });
    }
    if (constraints.maximum !== undefined && value > constraints.maximum) {
      errors.push({
        path,
        code: "MAXIMUM_VIOLATION",
        message: `Value ${value} exceeds maximum ${constraints.maximum}`,
        receivedValue: value,
      });
    }
    if (constraints.multipleOf !== undefined && constraints.multipleOf > 0) {
      const remainder = Math.abs(value % constraints.multipleOf);
      if (remainder > 1e-9 && Math.abs(remainder - constraints.multipleOf) > 1e-9) {
        errors.push({
          path,
          code: "MULTIPLE_OF_VIOLATION",
          message: `Value ${value} is not a multiple of ${constraints.multipleOf}`,
          receivedValue: value,
        });
      }
    }
  }

  if (Array.isArray(value)) {
    if (constraints.minLength !== undefined && value.length < constraints.minLength) {
      errors.push({
        path,
        code: "MIN_ITEMS_VIOLATION",
        message: `Array length ${value.length} is less than minimum items ${constraints.minLength}`,
        receivedValue: value,
      });
    }
    if (constraints.maxLength !== undefined && value.length > constraints.maxLength) {
      errors.push({
        path,
        code: "MAX_ITEMS_VIOLATION",
        message: `Array length ${value.length} exceeds maximum items ${constraints.maxLength}`,
        receivedValue: value,
      });
    }
    if (constraints.items) {
      for (let i = 0; i < value.length; i++) {
        const itemErrors = validateParameterValue(constraints.items, value[i], `${path}[${i}]`);
        errors.push(...itemErrors);
      }
    }
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (constraints.requiredProperties) {
      for (const reqProp of constraints.requiredProperties) {
        if (obj[reqProp] === undefined) {
          errors.push({
            path: `${path}.${reqProp}`,
            code: "REQUIRED_PROPERTY_MISSING",
            message: `Missing required property '${reqProp}'`,
          });
        }
      }
    }
    if (constraints.properties) {
      for (const [propKey, propSchema] of Object.entries(constraints.properties)) {
        if (obj[propKey] !== undefined) {
          const propErrors = validateParameterValue(propSchema, obj[propKey], `${path}.${propKey}`);
          errors.push(...propErrors);
        }
      }
    }
    if (constraints.additionalProperties === false && constraints.properties) {
      const allowedKeys = new Set(Object.keys(constraints.properties));
      for (const key of Object.keys(obj)) {
        if (!allowedKeys.has(key)) {
          errors.push({
            path: `${path}.${key}`,
            code: "ADDITIONAL_PROPERTIES_FORBIDDEN",
            message: `Property '${key}' is not allowed`,
            receivedValue: obj[key],
          });
        }
      }
    }
  }

  return errors;
}

export function validateParameterValue(
  param: ToolParameterSchema,
  value: unknown,
  path = param.name,
): ParameterValidationError[] {
  const errors: ParameterValidationError[] = [];

  if (value === undefined || value === null) {
    if (param.required) {
      errors.push({
        path,
        code: "REQUIRED_PARAMETER_MISSING",
        message: `Missing required parameter '${param.name}'`,
      });
    }
    return errors;
  }

  if (!validateParameterType(param.type, value)) {
    errors.push({
      path,
      code: "TYPE_MISMATCH",
      message: `Invalid type for '${param.name}': expected ${param.type}, received ${typeof value}`,
      receivedValue: value,
    });
    return errors;
  }

  if (param.enumValues && param.enumValues.length > 0) {
    if (!param.enumValues.includes(value as string | number | boolean)) {
      errors.push({
        path,
        code: "INVALID_ENUM_VALUE",
        message: `Value for '${param.name}' must be one of: ${param.enumValues.join(", ")}`,
        receivedValue: value,
      });
    }
  }

  if (param.constraints) {
    errors.push(...validateConstraints(param.constraints, value, path));
  }

  return errors;
}

export function validateToolArguments(
  parameters: readonly ToolParameterSchema[],
  args: Record<string, unknown>,
  options: ValidationOptions = {},
): InputValidationResult {
  const errors: ParameterValidationError[] = [];
  const sanitizedArgs: Record<string, unknown> = {};
  const recognizedParams = new Map<string, ToolParameterSchema>();

  for (const param of parameters) {
    recognizedParams.set(param.name, param);
  }

  if (options.strictUnknownProperties) {
    for (const key of Object.keys(args)) {
      if (!recognizedParams.has(key)) {
        errors.push({
          path: key,
          code: "UNKNOWN_PARAMETER",
          message: `Unknown argument '${key}' provided to tool`,
          receivedValue: args[key],
        });
      }
    }
  }

  for (const param of parameters) {
    let value = args[param.name];
    if (value === undefined && options.applyDefaults !== false && param.defaultValue !== undefined) {
      value = param.defaultValue;
    }

    if (value !== undefined) {
      sanitizedArgs[param.name] = value;
    }

    const paramErrors = validateParameterValue(param, value, param.name);
    errors.push(...paramErrors);
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitizedArgs,
  };
}
