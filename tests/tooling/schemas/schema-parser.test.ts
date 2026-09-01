import { describe, expect, it } from "bun:test";
import {
  buildJsonSchemaFromTool,
  parseParameterConstraint,
  parseParameterSchema,
  validateParameterType,
  validateParameterValue,
  validateToolArguments,
  type ToolDefinition,
  type ToolParameterSchema,
} from "../../../olt/scripts/src/tooling/index.ts";

describe("Tool Schemas & Security Validation Unit Test Suite", () => {
  describe("Dynamic Tool Schema Parsing", () => {
    it("parses valid tool parameter schemas with constraints", () => {
      const rawParam = {
        name: "port",
        type: "number",
        description: "Server listening port",
        required: true,
        defaultValue: 8080,
        constraints: {
          minimum: 1,
          maximum: 65535,
          multipleOf: 1,
        },
      };

      const result = parseParameterSchema(rawParam);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.schema?.name).toBe("port");
      expect(result.schema?.type).toBe("number");
      expect(result.schema?.required).toBe(true);
      expect(result.schema?.defaultValue).toBe(8080);
      expect(result.schema?.constraints?.minimum).toBe(1);
      expect(result.schema?.constraints?.maximum).toBe(65535);
    });

    it("parses nested object and array parameter schemas", () => {
      const rawObjParam = {
        name: "config",
        type: "object",
        description: "Configuration object",
        constraints: {
          properties: {
            host: { name: "host", type: "string", description: "Host", required: true },
            port: { name: "port", type: "number", description: "Port" },
          },
          requiredProperties: ["host"],
          additionalProperties: false,
        },
      };

      const result = parseParameterSchema(rawObjParam);
      expect(result.valid).toBe(true);
      expect(result.schema?.constraints?.properties?.host?.type).toBe("string");
      expect(result.schema?.constraints?.requiredProperties).toEqual(["host"]);
      expect(result.schema?.constraints?.additionalProperties).toBe(false);
    });

    it("rejects invalid constraints such as minLength > maxLength or invalid regex", () => {
      const invalidConstraint1 = parseParameterConstraint({
        minLength: 10,
        maxLength: 5,
      });
      expect(invalidConstraint1.errors.length).toBeGreaterThan(0);
      expect(invalidConstraint1.errors[0]).toContain("cannot exceed maxLength");

      const invalidConstraint2 = parseParameterConstraint({
        minimum: 100,
        maximum: 50,
      });
      expect(invalidConstraint2.errors.length).toBeGreaterThan(0);
      expect(invalidConstraint2.errors[0]).toContain("cannot exceed maximum");

      const invalidConstraint3 = parseParameterConstraint({
        pattern: "[a-z",
      });
      expect(invalidConstraint3.errors.length).toBeGreaterThan(0);
      expect(invalidConstraint3.errors[0]).toContain("invalid regular expression");
    });

    it("builds valid JSON Schema draft-07 from ToolDefinition", () => {
      const def: ToolDefinition = {
        name: "file_writer",
        description: "Writes content to path",
        category: "fs",
        parameters: [
          {
            name: "path",
            type: "string",
            description: "Target file path",
            required: true,
            constraints: { minLength: 1, maxLength: 256 },
          },
          {
            name: "encoding",
            type: "string",
            description: "File encoding",
            defaultValue: "utf-8",
            enumValues: ["utf-8", "ascii", "base64"],
          },
        ],
      };

      const jsonSchema = buildJsonSchemaFromTool(def);
      expect(jsonSchema.$schema).toBe("http://json-schema.org/draft-07/schema#");
      expect(jsonSchema.type).toBe("object");
      expect(jsonSchema.title).toBe("file_writer");
      expect(jsonSchema.required).toEqual(["path"]);
      expect((jsonSchema.properties as Record<string, unknown>).path).toBeDefined();
    });
  });

  describe("Input Validation Engine", () => {
    it("validates primitive parameter types and values", () => {
      expect(validateParameterType("string", "hello")).toBe(true);
      expect(validateParameterType("string", 123)).toBe(false);
      expect(validateParameterType("number", 42)).toBe(true);
      expect(validateParameterType("number", NaN)).toBe(false);
      expect(validateParameterType("boolean", true)).toBe(true);
      expect(validateParameterType("boolean", "true")).toBe(false);
      expect(validateParameterType("object", { a: 1 })).toBe(true);
      expect(validateParameterType("object", [1, 2])).toBe(false);
      expect(validateParameterType("array", [1, 2])).toBe(true);
      expect(validateParameterType("array", { length: 2 })).toBe(false);
    });

    it("enforces string constraints (minLength, maxLength, pattern)", () => {
      const schema: ToolParameterSchema = {
        name: "username",
        type: "string",
        description: "User handle",
        constraints: {
          minLength: 3,
          maxLength: 10,
          pattern: "^[a-z0-9_]+$",
        },
      };

      expect(validateParameterValue(schema, "ab").length).toBe(1);
      expect(validateParameterValue(schema, "valid_user").length).toBe(0);
      expect(validateParameterValue(schema, "toolongusername123").length).toBe(1);
      expect(validateParameterValue(schema, "INVALID!").length).toBe(1);
    });

    it("enforces numeric constraints (minimum, maximum, multipleOf)", () => {
      const schema: ToolParameterSchema = {
        name: "step",
        type: "number",
        description: "Step count",
        constraints: {
          minimum: 10,
          maximum: 50,
          multipleOf: 5,
        },
      };

      expect(validateParameterValue(schema, 5).length).toBe(1);
      expect(validateParameterValue(schema, 55).length).toBe(1);
      expect(validateParameterValue(schema, 22).length).toBe(1);
      expect(validateParameterValue(schema, 25).length).toBe(0);
    });

    it("validates nested object properties and rejects forbidden additional properties", () => {
      const schema: ToolParameterSchema = {
        name: "options",
        type: "object",
        description: "Options object",
        constraints: {
          properties: {
            retries: { name: "retries", type: "number", description: "Retry count" },
          },
          requiredProperties: ["retries"],
          additionalProperties: false,
        },
      };

      expect(validateParameterValue(schema, {}).length).toBe(1);
      expect(validateParameterValue(schema, { retries: 3 }).length).toBe(0);
      expect(validateParameterValue(schema, { retries: 3, extra: true }).length).toBe(1);
    });

    it("validates full tool argument map and handles strict unknown properties", () => {
      const params: readonly ToolParameterSchema[] = [
        { name: "id", type: "string", description: "ID", required: true },
        { name: "timeout", type: "number", description: "Timeout", defaultValue: 5000 },
      ];

      const res1 = validateToolArguments(params, { id: "item-1" });
      expect(res1.valid).toBe(true);
      expect(res1.sanitizedArgs.timeout).toBe(5000);

      const res2 = validateToolArguments(
        params,
        { id: "item-1", extraneous: "bad" },
        { strictUnknownProperties: true },
      );
      expect(res2.valid).toBe(false);
      expect(res2.errors[0].code).toBe("UNKNOWN_PARAMETER");
    });
  });
});
