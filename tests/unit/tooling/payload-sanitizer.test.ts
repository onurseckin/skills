import { describe, expect, it } from "bun:test";
import {
  coerceValue,
  sanitizeAndValidatePayload,
  validateParameter,
  validateTypeOnly,
  type ToolParameter,
} from "../../../olt/scripts/src/tooling/index.ts";

describe("Runtime Payload Sanitizer & Type Validator Suite", () => {
  describe("validateTypeOnly primitive checking", () => {
    it("validates strings correctly", () => {
      expect(validateTypeOnly("string", "hello")).toBe(true);
      expect(validateTypeOnly("string", "")).toBe(true);
      expect(validateTypeOnly("string", 123)).toBe(false);
      expect(validateTypeOnly("string", null)).toBe(false);
    });

    it("validates numbers correctly", () => {
      expect(validateTypeOnly("number", 42)).toBe(true);
      expect(validateTypeOnly("number", 0)).toBe(true);
      expect(validateTypeOnly("number", -3.14)).toBe(true);
      expect(validateTypeOnly("number", Number.NaN)).toBe(false);
      expect(validateTypeOnly("number", "42")).toBe(false);
    });

    it("validates booleans correctly", () => {
      expect(validateTypeOnly("boolean", true)).toBe(true);
      expect(validateTypeOnly("boolean", false)).toBe(true);
      expect(validateTypeOnly("boolean", 1)).toBe(false);
      expect(validateTypeOnly("boolean", "true")).toBe(false);
    });

    it("validates objects and arrays correctly", () => {
      expect(validateTypeOnly("object", { foo: "bar" })).toBe(true);
      expect(validateTypeOnly("object", {})).toBe(true);
      expect(validateTypeOnly("object", [1, 2, 3])).toBe(false);
      expect(validateTypeOnly("array", [1, 2, 3])).toBe(true);
      expect(validateTypeOnly("array", {})).toBe(false);
    });
  });

  describe("coerceValue coercion engine", () => {
    it("coerces strings from various types", () => {
      expect(coerceValue(123, "string")).toBe("123");
      expect(coerceValue(true, "string")).toBe("true");
    });

    it("coerces numbers from valid string representations", () => {
      expect(coerceValue("42", "number")).toBe(42);
      expect(coerceValue("  -12.5  ", "number")).toBe(-12.5);
      expect(coerceValue(true, "number")).toBe(1);
      expect(coerceValue("not-a-number", "number")).toBe("not-a-number");
    });

    it("coerces booleans from truthy and falsy strings/numbers", () => {
      expect(coerceValue("true", "boolean")).toBe(true);
      expect(coerceValue("1", "boolean")).toBe(true);
      expect(coerceValue(1, "boolean")).toBe(true);
      expect(coerceValue("false", "boolean")).toBe(false);
      expect(coerceValue("0", "boolean")).toBe(false);
      expect(coerceValue(0, "boolean")).toBe(false);
    });

    it("coerces JSON strings into objects and arrays", () => {
      expect(coerceValue('{"key": "value"}', "object")).toEqual({ key: "value" });
      expect(coerceValue('[1, 2, 3]', "array")).toEqual([1, 2, 3]);
    });
  });

  describe("validateParameter comprehensive constraints", () => {
    it("detects missing required fields", () => {
      const param: ToolParameter = {
        name: "apiKey",
        type: "string",
        description: "API Key",
        required: true,
      };

      const result = validateParameter(param, undefined);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe("REQUIRED");
    });

    it("applies default values for missing optional fields", () => {
      const param: ToolParameter = {
        name: "retries",
        type: "number",
        description: "Retry count",
        defaultValue: 3,
      };

      const result = validateParameter(param, undefined, { applyDefaults: true });
      expect(result.valid).toBe(true);
      expect(result.value).toBe(3);
    });

    it("enforces string constraints (minLength, maxLength, pattern)", () => {
      const param: ToolParameter = {
        name: "username",
        type: "string",
        description: "User name",
        minLength: 3,
        maxLength: 10,
        pattern: "^[a-z0-9_]+$",
      };

      const shortRes = validateParameter(param, "ab");
      expect(shortRes.valid).toBe(false);
      expect(shortRes.errors.some((e) => e.code === "MIN_LENGTH")).toBe(true);

      const longRes = validateParameter(param, "thisusernameiswaytoolong");
      expect(longRes.valid).toBe(false);
      expect(longRes.errors.some((e) => e.code === "MAX_LENGTH")).toBe(true);

      const patternRes = validateParameter(param, "Invalid#Chars");
      expect(patternRes.valid).toBe(false);
      expect(patternRes.errors.some((e) => e.code === "PATTERN_MISMATCH")).toBe(true);

      const validRes = validateParameter(param, "valid_usr1");
      expect(validRes.valid).toBe(true);
    });

    it("enforces numeric constraints (minimum, maximum, integer)", () => {
      const param: ToolParameter = {
        name: "count",
        type: "number",
        description: "Count",
        minimum: 1,
        maximum: 100,
        integer: true,
      };

      const underflow = validateParameter(param, 0);
      expect(underflow.valid).toBe(false);
      expect(underflow.errors.some((e) => e.code === "MIN_VALUE")).toBe(true);

      const overflow = validateParameter(param, 150);
      expect(overflow.valid).toBe(false);
      expect(overflow.errors.some((e) => e.code === "MAX_VALUE")).toBe(true);

      const nonInt = validateParameter(param, 5.5);
      expect(nonInt.valid).toBe(false);
      expect(nonInt.errors.some((e) => e.code === "NOT_INTEGER")).toBe(true);

      const valid = validateParameter(param, 50);
      expect(valid.valid).toBe(true);
    });

    it("enforces enum constraints", () => {
      const param: ToolParameter = {
        name: "mode",
        type: "string",
        description: "Operation mode",
        enumValues: ["fast", "balanced", "thorough"],
      };

      const invalid = validateParameter(param, "hyper");
      expect(invalid.valid).toBe(false);
      expect(invalid.errors[0]?.code).toBe("INVALID_ENUM");

      const valid = validateParameter(param, "fast");
      expect(valid.valid).toBe(true);
    });
  });

  describe("sanitizeAndValidatePayload multi-parameter validation", () => {
    const params: readonly ToolParameter[] = [
      { name: "id", type: "number", description: "Item ID", required: true, integer: true },
      { name: "name", type: "string", description: "Item name", required: true },
      { name: "active", type: "boolean", description: "Is active", defaultValue: true },
    ];

    it("validates and sanitizes a complete payload with type coercion", () => {
      const payload = {
        id: "42",
        name: "Widget",
        active: "true",
      };

      const res = sanitizeAndValidatePayload(params, payload, {
        coerceTypes: true,
        applyDefaults: true,
      });

      expect(res.valid).toBe(true);
      expect(res.sanitized).toEqual({
        id: 42,
        name: "Widget",
        active: true,
      });
    });

    it("strips unknown properties when stripUnknownProperties is true", () => {
      const payload = {
        id: 1,
        name: "Item",
        unauthorizedKey: "malicious_payload",
      };

      const res = sanitizeAndValidatePayload(params, payload, {
        stripUnknownProperties: true,
      });

      expect(res.valid).toBe(true);
      expect(res.sanitized.unauthorizedKey).toBeUndefined();
    });

    it("rejects unknown properties when rejectUnknownProperties is true", () => {
      const payload = {
        id: 1,
        name: "Item",
        extraKey: 123,
      };

      const res = sanitizeAndValidatePayload(params, payload, {
        rejectUnknownProperties: true,
      });

      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.code === "UNKNOWN_PROPERTY")).toBe(true);
    });
  });
});
