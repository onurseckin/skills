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
          items: [{ constructor: { name: "Fake" } }],
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

