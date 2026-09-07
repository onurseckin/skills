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

      expect(() =>
        registry.register({
          name: "bp",
          description: "Colliding tool name",
          category: "build",
          parameters: [],
        }),
      ).toThrow("Tool or alias already registered with name: bp");

      expect(() =>
        registry.register({
          name: "another-tool",
          description: "Colliding alias",
          category: "build",
          parameters: [],
          aliases: ["build-pack"],
        }),
      ).toThrow("Alias conflict for 'build-pack'");

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
  });
});
