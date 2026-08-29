import { describe, expect, it } from "bun:test";
import {
  DynamicToolRegistry,
  buildJsonSchemaFromTool,
  detectCommandInjection,
  detectPrototypePollution,
  isSafeExecutionPayload,
  parseParameterConstraint,
  parseParameterSchema,
  parseToolSchema,
  sanitizeHtmlContent,
  sanitizePathTraversal,
  sanitizeShellArgument,
  sanitizeToolInput,
  sanitizeValueByPolicy,
  validateConstraints,
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

      const res2 = validateToolArguments(params, { id: "item-1", extraneous: "bad" }, { strictUnknownProperties: true });
      expect(res2.valid).toBe(false);
      expect(res2.errors[0].code).toBe("UNKNOWN_PARAMETER");
    });
  });

  describe("Security Sanitization & Threat Protection", () => {
    it("escapes shell arguments safely against command injection", () => {
      expect(sanitizeShellArgument("hello")).toBe("'hello'");
      expect(sanitizeShellArgument("foo'bar")).toBe("'foo'\\''bar'");
      expect(sanitizeShellArgument("")).toBe("''");
    });

    it("detects shell injection metacharacters", () => {
      expect(detectCommandInjection("normal_arg")).toBeNull();
      expect(detectCommandInjection("foo; rm -rf /")?.threatType).toBe("COMMAND_INJECTION");
      expect(detectCommandInjection("foo | cat /etc/passwd")?.threatType).toBe("COMMAND_INJECTION");
      expect(detectCommandInjection("foo && whoami")?.threatType).toBe("COMMAND_INJECTION");
      expect(detectCommandInjection("foo `id`")?.threatType).toBe("COMMAND_INJECTION");
      expect(detectCommandInjection("foo $(cat secret)")?.threatType).toBe("COMMAND_INJECTION");
      expect(detectCommandInjection("foo > /dev/null")?.threatType).toBe("COMMAND_INJECTION");
    });

    it("blocks path traversal attacks and null byte injections", () => {
      const res1 = sanitizePathTraversal("../etc/passwd");
      expect(res1.safePath).toBeNull();
      expect(res1.violation?.threatType).toBe("PATH_TRAVERSAL");

      const res2 = sanitizePathTraversal("/safe/path\0/evil");
      expect(res2.safePath).toBeNull();
      expect(res2.violation?.threatType).toBe("NULL_BYTE_INJECTION");

      const res3 = sanitizePathTraversal("/allowed/workspace/sub/file.txt", ["/allowed/workspace"]);
      expect(res3.safePath).not.toBeNull();

      const res4 = sanitizePathTraversal("/unauthorized/file.txt", ["/allowed/workspace"]);
      expect(res4.safePath).toBeNull();
      expect(res4.violation?.threatType).toBe("PATH_TRAVERSAL");
    });

    it("detects prototype pollution attacks in deep objects", () => {
      const maliciousObj = JSON.parse('{"__proto__": {"polluted": true}}');
      const violation = detectPrototypePollution(maliciousObj);
      expect(violation).not.toBeNull();
      expect(violation?.threatType).toBe("PROTOTYPE_POLLUTION");

      const nestedMalicious = {
        data: {
          items: [
            { constructor: { name: "Fake" } },
          ],
        },
      };
      const nestedViolation = detectPrototypePollution(nestedMalicious);
      expect(nestedViolation).not.toBeNull();
      expect(nestedViolation?.threatType).toBe("PROTOTYPE_POLLUTION");
    });

    it("sanitizes dangerous HTML and script tags", () => {
      const dirtyHtml = '<script>alert("xss")</script><div onclick="evil()">Click</div>';
      const clean = sanitizeHtmlContent(dirtyHtml);
      expect(clean).not.toContain("<script>");
      expect(clean).toContain("&lt;script&gt;");
    });

    it("applies policy-based value sanitization", () => {
      expect(sanitizeValueByPolicy("hello_123 !@#", "strict-alphanumeric")).toBe("hello_123");
      expect(sanitizeValueByPolicy("<tag>", "html-escape")).toBe("&lt;tag&gt;");
      expect(sanitizeValueByPolicy("clean-value", "none")).toBe("clean-value");
    });

    it("performs comprehensive tool input sanitization with security policy", () => {
      const policy = {
        allowShellExecution: false,
        stripUnsafeHtml: true,
        preventPrototypePollution: true,
        maxStringLength: 100,
      };

      const safePayload = {
        name: "alice",
        query: "select_all",
      };
      expect(isSafeExecutionPayload(safePayload, policy)).toBe(true);

      const unsafePayload = {
        name: "alice",
        cmd: "run; rm -rf /",
        html: "<script>alert(1)</script>",
      };
      const res = sanitizeToolInput(unsafePayload, policy);
      expect(res.safe).toBe(false);
      expect(res.violations.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("DynamicToolRegistry Security Integration", () => {
    it("rejects tool execution when security violations occur", async () => {
      const registry = new DynamicToolRegistry();
      registry.register({
        name: "secure-exec",
        description: "Executes commands under security policy",
        category: "system",
        parameters: [{ name: "cmd", type: "string", description: "Command" }],
        securityPolicy: {
          allowShellExecution: false,
        },
        handler: (args) => `executed: ${String(args.cmd)}`,
      });

      const res = await registry.execute("secure-exec", { cmd: "test; cat /etc/passwd" });
      expect(res.success).toBe(false);
      expect(res.error).toContain("Security violation");
      expect(res.securityViolations?.length).toBeGreaterThan(0);
    });

    it("allows execution when payload satisfies security policy and schema", async () => {
      const registry = new DynamicToolRegistry();
      registry.register({
        name: "secure-tool",
        description: "Safe tool",
        category: "safe",
        parameters: [{ name: "item", type: "string", description: "Item name", required: true }],
        securityPolicy: {
          allowShellExecution: false,
          maxStringLength: 50,
        },
        handler: (args) => ({ processed: args.item }),
      });

      const res = await registry.execute("secure-tool", { item: "valid-name" });
      expect(res.success).toBe(true);
      expect(res.output).toEqual({ processed: "valid-name" });
    });
  });
});
