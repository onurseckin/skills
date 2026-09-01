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
  });
});
