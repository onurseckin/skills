import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DynamicToolRegistry,
  discoverToolsFromDirectory,
  discoverToolsFromManifest,
  getGlobalToolRegistry,
  parseToolSpec,
  resetGlobalToolRegistry,
  scanAndRegisterTools,
  validateToolSpec,
  type ToolDefinition,
} from "../../../olt/scripts/src/tooling/index.ts";

describe("Tooling System Test Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    resetGlobalToolRegistry();
    tempDir = mkdtempSync(join(tmpdir(), "tool-registry-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("DynamicToolRegistry execution and parameter validation", () => {
    it("validates parameters and executes handlers successfully", async () => {
      const registry = new DynamicToolRegistry();
      registry.register({
        name: "calculator",
        description: "Executes math",
        category: "math",
        parameters: [
          {
            name: "operation",
            type: "string",
            description: "Op",
            required: true,
            enumValues: ["add", "sub"],
          },
          { name: "a", type: "number", description: "First num", required: true },
          { name: "b", type: "number", description: "Second num", defaultValue: 5 },
          { name: "flag", type: "boolean", description: "Flag", required: false },
          { name: "meta", type: "object", description: "Metadata", required: false },
          { name: "items", type: "array", description: "List", required: false },
        ],
        handler: (args) => {
          const a = args.a as number;
          const b = args.b as number;
          return args.operation === "add" ? a + b : a - b;
        },
      });

      const resValid = await registry.execute("calculator", { operation: "add", a: 10 });
      expect(resValid.success).toBe(true);
      expect(resValid.output).toBe(15);
      expect(resValid.durationMs).toBeGreaterThanOrEqual(0);

      const resMissing = await registry.execute("calculator", {});
      expect(resMissing.success).toBe(false);
      expect(resMissing.error).toContain("Missing required parameter");

      const resInvalidEnum = await registry.execute("calculator", { operation: "mul", a: 10 });
      expect(resInvalidEnum.success).toBe(false);
      expect(resInvalidEnum.error).toContain("Invalid type or value");

      expect(
        (await registry.execute("calculator", { operation: "add", a: Number.NaN })).success,
      ).toBe(false);
      expect(
        (await registry.execute("calculator", { operation: "add", a: 1, flag: "not-bool" }))
          .success,
      ).toBe(false);
      expect(
        (await registry.execute("calculator", { operation: "add", a: 1, meta: [1, 2, 3] })).success,
      ).toBe(false);
      expect(
        (await registry.execute("calculator", { operation: "add", a: 1, items: "not-arr" }))
          .success,
      ).toBe(false);
    });

    it("handles execution edge cases and errors gracefully", async () => {
      const registry = new DynamicToolRegistry();
      registry.register({
        name: "faulty",
        description: "Fails",
        category: "test",
        parameters: [],
        handler: () => {
          throw new Error("Execution failure");
        },
      });
      registry.register({
        name: "disabled-tool",
        description: "Disabled",
        category: "test",
        enabled: false,
        parameters: [],
      });
      registry.register({
        name: "no-handler",
        description: "No handler",
        category: "test",
        parameters: [],
      });

      const resNotFound = await registry.execute("missing");
      expect(resNotFound.success).toBe(false);
      expect(resNotFound.error).toContain("not registered");

      const resDisabled = await registry.execute("disabled-tool");
      expect(resDisabled.success).toBe(false);
      expect(resDisabled.error).toContain("disabled");

      const resNoHandler = await registry.execute("no-handler");
      expect(resNoHandler.success).toBe(false);
      expect(resNoHandler.error).toContain("no executable handler");

      const resFault = await registry.execute("faulty");
      expect(resFault.success).toBe(false);
      expect(resFault.error).toBe("Execution failure");
    });
  });

  describe("DynamicToolRegistry catalog and stats", () => {
    it("exports catalog, imports catalog, and calculates stats", async () => {
      const registry = new DynamicToolRegistry();
      registry.register({
        name: "stat-tool",
        description: "Stat tool",
        category: "diagnostics",
        parameters: [],
        handler: () => "ok",
      });

      await registry.execute("stat-tool");
      await registry.execute("stat-tool");

      const stats = registry.getStats();
      expect(stats.totalTools).toBe(1);
      expect(stats.enabledTools).toBe(1);
      expect(stats.totalInvocations).toBe(2);
      expect(stats.categoryCounts.diagnostics).toBe(1);

      const catalog = registry.exportCatalog();
      expect(catalog.totalTools).toBe(1);
      expect(catalog.tools[0]?.name).toBe("stat-tool");
      expect(catalog.tools[0]?.handler).toBeUndefined();

      const newRegistry = new DynamicToolRegistry();
      const importedCount = newRegistry.importCatalog(catalog, {
        "stat-tool": () => "imported-ok",
      });
      expect(importedCount).toBe(1);
      expect(newRegistry.has("stat-tool")).toBe(true);

      const execImported = await newRegistry.execute("stat-tool");
      expect(execImported.output).toBe("imported-ok");
    });

    it("manages global singleton registry instance", () => {
      const singleton1 = getGlobalToolRegistry();
      const singleton2 = getGlobalToolRegistry();
      expect(singleton1).toBe(singleton2);

      singleton1.register({
        name: "global-probe",
        description: "Global",
        category: "system",
        parameters: [],
      });
      expect(singleton2.has("global-probe")).toBe(true);

      resetGlobalToolRegistry();
      const fresh = getGlobalToolRegistry();
      expect(fresh).not.toBe(singleton1);
      expect(fresh.has("global-probe")).toBe(false);
    });
  });

  describe("Tool Discovery and Scanning", () => {
    it("validates and parses tool specifications", () => {
      const validSpec = {
        name: "linter",
        description: "Runs linter",
        category: "quality",
        parameters: [
          { name: "fix", type: "boolean", description: "Apply autofixes", required: false },
        ],
        metadata: { version: "1.0.0", author: "Dev", tags: ["lint"], deprecated: false },
      };

      const validResult = validateToolSpec(validSpec);
      expect(validResult.valid).toBe(true);
      expect(validResult.definition?.name).toBe("linter");

      const parsed = parseToolSpec(JSON.stringify(validSpec));
      expect(parsed?.name).toBe("linter");
      expect(parseToolSpec("not-json")).toBeNull();
      expect(parseToolSpec("")).toBeNull();

      expect(validateToolSpec(null).valid).toBe(false);
      expect(validateToolSpec({}).valid).toBe(false);
      expect(validateToolSpec({ name: "test" }).valid).toBe(false);
      expect(
        validateToolSpec({ name: "test", description: "desc", parameters: "invalid" }).valid,
      ).toBe(false);
      expect(
        validateToolSpec({
          name: "test",
          description: "desc",
          parameters: [{ name: "p1", type: "unsupported" }],
        }).valid,
      ).toBe(false);
    });

    it("discovers tools from filesystem directory and manifests", () => {
      const subDir = join(tempDir, "sub");
      mkdirSync(subDir, { recursive: true });

      const tool1 = {
        name: "file-scanner",
        description: "Scans files",
        category: "general",
        parameters: [{ name: "path", type: "string", description: "Path" }],
      };
      const tool2 = {
        name: "ast-parser",
        description: "Parses AST",
        category: "syntax",
        parameters: [],
      };

      writeFileSync(join(tempDir, "scanner.tool.json"), JSON.stringify(tool1), "utf-8");
      writeFileSync(join(subDir, "parser.json"), JSON.stringify(tool2), "utf-8");
      writeFileSync(join(tempDir, "ignored.txt"), "some text", "utf-8");
      writeFileSync(join(tempDir, "corrupted.json"), "{ invalid json", "utf-8");

      const discovered = discoverToolsFromDirectory(tempDir, { defaultCategory: "custom-cat" });
      expect(discovered.length).toBe(2);
      expect(
        discovered.some(
          (d) => d.definition.name === "file-scanner" && d.definition.category === "custom-cat",
        ),
      ).toBe(true);
      expect(
        discovered.some(
          (d) => d.definition.name === "ast-parser" && d.definition.category === "syntax",
        ),
      ).toBe(true);

      const emptyDiscovery = discoverToolsFromDirectory(join(tempDir, "non-existent"));
      expect(emptyDiscovery).toEqual([]);

      const manifestPath = join(tempDir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({ tools: [tool1, tool2] }), "utf-8");
      const fromManifest = discoverToolsFromManifest(manifestPath, "manifest-cat");
      expect(fromManifest.length).toBe(2);
      expect(fromManifest[0]?.category).toBe("manifest-cat");

      const emptyManifest = discoverToolsFromManifest(join(tempDir, "non-existent-manifest.json"));
      expect(emptyManifest).toEqual([]);

      const scanRegistry = new DynamicToolRegistry();
      const report = scanAndRegisterTools(scanRegistry, [tempDir]);
      expect(report.discoveredCount).toBe(2);
      expect(report.registeredCount).toBe(2);
      expect(scanRegistry.count()).toBe(2);
    });
  });
});
