import type { ToolParameterType } from "../types/index.ts";

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
      return typeof value === "boolean" ? (value ? 1 : 0) : value;
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
