import { beforeEach, describe, expect, it } from "bun:test";
import {
  DynamicToolRegistry,
  resetGlobalToolRegistry,
  type ToolDefinition,
} from "../../../olt/scripts/src/tooling/index.ts";

describe("Tooling System Test Suite", () => {
  beforeEach(() => {
    resetGlobalToolRegistry();
  });

  describe("DynamicToolRegistry lifecycle and registration", () => {
    it("manages registry registration, aliases, and removal", () => {
      const registry = new DynamicToolRegistry();
      expect(registry.count()).toBe(0);
      expect(registry.list()).toEqual([]);

      const sampleTool: ToolDefinition = {
        name: "test-tool",
        description: "A test tool",
        category: "testing",
        parameters: [
          { name: "query", type: "string", description: "Search query", required: true },
          { name: "count", type: "number", description: "Count limit", defaultValue: 10 },
        ],
        aliases: ["tt", "ttool"],
      };

      registry.register(sampleTool);
      expect(registry.count()).toBe(1);
      expect(registry.has("test-tool")).toBe(true);
      expect(registry.has("tt")).toBe(true);
      expect(registry.get("tt")?.name).toBe("test-tool");

      expect(() =>
        registry.register({
          name: "test-tool",
          description: "Duplicate",
          category: "test",
          parameters: [],
        }),
      ).toThrow();
      expect(() =>
        registry.register({
          name: "another",
          aliases: ["tt"],
          description: "Conflict",
          category: "test",
          parameters: [],
        }),
      ).toThrow();
      expect(() =>
        registry.register({ name: "", description: "Empty", category: "test", parameters: [] }),
      ).toThrow();

      registry.setHandler("test-tool", (args) => `Result for ${String(args.query)}`);
      expect(registry.get("test-tool")?.handler).toBeDefined();

      const unregistered = registry.unregister("tt");
      expect(unregistered).toBe(true);
      expect(registry.has("test-tool")).toBe(false);
      expect(registry.has("tt")).toBe(false);
      expect(registry.unregister("unknown")).toBe(false);
    });

    it("registers multiple tools and clears registry", () => {
      const registry = new DynamicToolRegistry();
      registry.registerMany([
        { name: "tool-a", description: "A", category: "cat-a", parameters: [] },
        { name: "tool-b", description: "B", category: "cat-b", parameters: [] },
      ]);
      expect(registry.count()).toBe(2);
      registry.clear();
      expect(registry.count()).toBe(0);
    });
  });

  describe("DynamicToolRegistry filtering and search", () => {
    it("filters and searches tool catalog", () => {
      const registry = new DynamicToolRegistry();
      registry.registerMany([
        {
          name: "alpha",
          description: "Alpha description",
          category: "build",
          parameters: [],
          metadata: { tags: ["ci"], deprecated: false },
        },
        {
          name: "beta",
          description: "Beta search query helper",
          category: "test",
          parameters: [],
          enabled: false,
          metadata: { tags: ["qa"], deprecated: true },
        },
        {
          name: "gamma",
          description: "Gamma tool",
          category: "build",
          parameters: [],
          aliases: ["g-alias"],
          metadata: { tags: ["ci"] },
        },
      ]);

      expect(registry.list().map((t) => t.name)).toEqual(["alpha", "gamma"]);
      expect(registry.list({ includeDeprecated: true }).map((t) => t.name)).toEqual([
        "alpha",
        "beta",
        "gamma",
      ]);
      expect(
        registry.list({ enabledOnly: true, includeDeprecated: true }).map((t) => t.name),
      ).toEqual(["alpha", "gamma"]);
      expect(registry.list({ category: "build" }).map((t) => t.name)).toEqual(["alpha", "gamma"]);
      expect(registry.list({ tag: "qa", includeDeprecated: true }).map((t) => t.name)).toEqual([
        "beta",
      ]);
      expect(
        registry.list({ search: "helper", includeDeprecated: true }).map((t) => t.name),
      ).toEqual(["beta"]);
      expect(registry.list({ search: "g-alias" }).map((t) => t.name)).toEqual(["gamma"]);
      expect(registry.count(true)).toBe(2);
    });

    it("rejects bidirectional collisions between primary names and aliases and trims whitespace", () => {
      const registry = new DynamicToolRegistry();
      registry.register({
        name: "  build-pack  ",
        description: "Build packer",
        category: "build",
        parameters: [],
        aliases: ["  bp  ", "packer"],
      });

      expect(registry.has("build-pack")).toBe(true);
      expect(registry.has("bp")).toBe(true);
      expect(registry.has("packer")).toBe(true);
      expect(registry.get("bp")?.name).toBe("build-pack");

      // Colliding primary name with existing alias "bp"
      expect(() =>
        registry.register({
          name: "bp",
          description: "Colliding tool name",
          category: "build",
          parameters: [],
        }),
      ).toThrow("Tool or alias already registered with name: bp");

      // Colliding alias with existing primary name "build-pack"
      expect(() =>
        registry.register({
          name: "another-tool",
          description: "Colliding alias",
          category: "build",
          parameters: [],
          aliases: ["build-pack"],
        }),
      ).toThrow("Alias conflict for 'build-pack'");

      // Whitespace-only name/alias rejection
      expect(() =>
        registry.register({
          name: "   ",
          description: "Empty name",
          category: "test",
          parameters: [],
        }),
      ).toThrow("Tool name cannot be empty");

      expect(() =>
        registry.register({
          name: "valid-name",
          description: "Empty alias",
          category: "test",
          parameters: [],
          aliases: ["   "],
        }),
      ).toThrow("Tool alias cannot be empty");
    });

    it("handles complex compound filtering, zero-match edge queries, and sorting", () => {
      const registry = new DynamicToolRegistry();
      registry.registerMany([
        {
          name: "lint-ts",
          description: "Lints typescript files",
          category: "qa",
          parameters: [],
          metadata: { tags: ["linter", "ci"] },
        },
        {
          name: "lint-py",
          description: "Lints python files",
          category: "qa",
          parameters: [],
          metadata: { tags: ["linter"] },
          enabled: false,
        },
        {
          name: "deploy-k8s",
          description: "Deploys to k8s cluster",
          category: "infra",
          parameters: [],
          metadata: { tags: ["ci"], deprecated: true },
        },
      ]);

      // Zero-match compound query
      const noMatch = registry.list({
        category: "qa",
        tag: "nonexistent",
      });
      expect(noMatch).toEqual([]);

      // Category + tag + enabledOnly filter
      const enabledLinters = registry.list({
        category: "qa",
        tag: "linter",
        enabledOnly: true,
      });
      expect(enabledLinters.map((t) => t.name)).toEqual(["lint-ts"]);

      // Unmatched search query
      expect(registry.list({ search: "UNKNOWN_STRING_XYZ" })).toEqual([]);

      // Deprecated exclusion by default
      expect(registry.list({ category: "infra" })).toEqual([]);
      expect(
        registry.list({ category: "infra", includeDeprecated: true }).map((t) => t.name),
      ).toEqual(["deploy-k8s"]);
    });

    it("handles idempotent clearing, unknown tool unregistration, and handler validation", () => {
      const registry = new DynamicToolRegistry();
      expect(registry.count()).toBe(0);
      registry.clear();
      expect(registry.count()).toBe(0);

      expect(registry.unregister("non-existent")).toBe(false);
      expect(registry.get("non-existent")).toBeUndefined();
      expect(registry.has("non-existent")).toBe(false);

      expect(() => registry.setHandler("non-existent", () => "test")).toThrow(
        "Tool not found: non-existent",
      );
    });

    it("handles tool execution lifecycle including missing handlers, disabled tools, and input validation", async () => {
      const registry = new DynamicToolRegistry();
      registry.register({
        name: "calc",
        description: "Calculator",
        category: "math",
        parameters: [
          { name: "a", type: "number", description: "First number", required: true },
          { name: "b", type: "number", description: "Second number", required: true },
        ],
      });

      // Missing handler execution
      const noHandlerResult = await registry.execute("calc", { a: 1, b: 2 });
      expect(noHandlerResult.success).toBe(false);
      expect(noHandlerResult.error).toContain("has no executable handler registered");

      // Register handler
      registry.setHandler("calc", (args) => Number(args.a) + Number(args.b));

      // Execution with missing required argument
      const missingParamResult = await registry.execute("calc", { a: 5 });
      expect(missingParamResult.success).toBe(false);
      expect(missingParamResult.error).toContain("Missing required parameter 'b'");

      // Successful execution
      const successResult = await registry.execute("calc", { a: 10, b: 25 });
      expect(successResult.success).toBe(true);
      expect(successResult.output).toBe(35);
      expect(registry.getStats().totalInvocations).toBe(1);

      // Disabled tool execution
      const disabledTool: ToolDefinition = {
        name: "locked",
        description: "Disabled tool",
        category: "admin",
        parameters: [],
        enabled: false,
        handler: () => "unreachable",
      };
      registry.register(disabledTool);
      const disabledResult = await registry.execute("locked");
      expect(disabledResult.success).toBe(false);
      expect(disabledResult.error).toContain("is disabled");

      // Execution on unregistered tool
      const unregisteredResult = await registry.execute("ghost");
      expect(unregisteredResult.success).toBe(false);
      expect(unregisteredResult.error).toContain("is not registered");
    });
  });
});
