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

  describe("DynamicToolRegistry filtering and execution", () => {
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

      const noMatch = registry.list({
        category: "qa",
        tag: "nonexistent",
      });
      expect(noMatch).toEqual([]);

      const enabledLinters = registry.list({
        category: "qa",
        tag: "linter",
        enabledOnly: true,
      });
      expect(enabledLinters.map((t) => t.name)).toEqual(["lint-ts"]);

      expect(registry.list({ search: "UNKNOWN_STRING_XYZ" })).toEqual([]);

      expect(registry.list({ category: "infra" })).toEqual([]);
      expect(
        registry.list({ category: "infra", includeDeprecated: true }).map((t) => t.name),
      ).toEqual(["deploy-k8s"]);
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

      const noHandlerResult = await registry.execute("calc", { a: 1, b: 2 });
      expect(noHandlerResult.success).toBe(false);
      expect(noHandlerResult.error).toContain("has no executable handler registered");

      registry.setHandler("calc", (args) => Number(args.a) + Number(args.b));

      const missingParamResult = await registry.execute("calc", { a: 5 });
      expect(missingParamResult.success).toBe(false);
      expect(missingParamResult.error).toContain("Missing required parameter 'b'");

      const successResult = await registry.execute("calc", { a: 10, b: 25 });
      expect(successResult.success).toBe(true);
      expect(successResult.output).toBe(35);
      expect(registry.getStats().totalInvocations).toBe(1);

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

      const unregisteredResult = await registry.execute("ghost");
      expect(unregisteredResult.success).toBe(false);
      expect(unregisteredResult.error).toContain("is not registered");
    });
  });
});
