import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";
import {
  DynamicToolRegistry,
  discoverToolsFromDirectory,
  discoverToolsFromManifest,
  parseToolSpec,
  scanAndRegisterTools,
  validateToolSpec,
  type ToolDefinition,
} from "../../../olt/scripts/src/tooling/index.ts";

describe("Tool Discovery and Scanning Unit Test Suite", () => {
  let vfsSession: VirtualFSSession;
  let testRoot: string;

  beforeEach(() => {
    vfsSession = createVirtualFSSession(new VirtualMemoryFS());
    testRoot = `/virtual/discovery-unit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    vfsSession.cleanup();
  });

  const sampleToolSpec1 = {
    name: "calculatorTool",
    description: "Performs basic mathematical operations",
    category: "math",
    parameters: [
      { name: "a", type: "number", description: "First operand", required: true },
      { name: "b", type: "number", description: "Second operand", required: true },
      {
        name: "operation",
        type: "string",
        description: "Operation type",
        required: false,
        defaultValue: "add",
        enumValues: ["add", "subtract", "multiply", "divide"],
      },
    ],
    aliases: ["calc", "mathCalc"],
    metadata: { version: "1.0.0", author: "CoreTeam", tags: ["utility", "math"] },
  };

  const sampleToolSpec2 = {
    name: "networkPing",
    description: "Pings a remote host",
    category: "network",
    parameters: [
      { name: "host", type: "string", description: "Host to ping", required: true },
      { name: "timeoutMs", type: "number", description: "Timeout in ms", defaultValue: 5000 },
    ],
  };

  const genericToolSpec = {
    name: "genericHelper",
    description: "A helper with no explicit category",
    category: "general",
    parameters: [],
  };

  describe("Specification Validation & Parsing", () => {
    it("validates well-formed tool specifications with metadata and aliases", () => {
      const result = validateToolSpec(sampleToolSpec1);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.definition?.name).toBe("calculatorTool");
      expect(result.definition?.aliases).toEqual(["calc", "mathCalc"]);
      expect(result.definition?.metadata?.tags).toEqual(["utility", "math"]);
    });

    it("rejects non-object or null raw input", () => {
      expect(validateToolSpec(null).valid).toBe(false);
      expect(validateToolSpec("string").valid).toBe(false);
      expect(validateToolSpec([1, 2, 3]).valid).toBe(false);
    });

    it("identifies missing required name or description fields", () => {
      const missingName = { description: "Missing name" };
      const missingDesc = { name: "toolWithoutDesc" };

      expect(validateToolSpec(missingName).valid).toBe(false);
      expect(validateToolSpec(missingName).errors).toContain(
        "Tool definition requires a non-empty 'name' string",
      );

      expect(validateToolSpec(missingDesc).valid).toBe(false);
      expect(validateToolSpec(missingDesc).errors).toContain(
        "Tool definition requires a 'description' string",
      );
    });

    it("validates and detects invalid parameter types", () => {
      const invalidParamTypeSpec = {
        name: "badParamTool",
        description: "Tool with bad param",
        parameters: [{ name: "badParam", type: "invalidType", description: "Invalid" }],
      };

      const result = validateToolSpec(invalidParamTypeSpec);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Invalid parameter type 'invalidType'");
    });

    it("parses valid JSON string content and rejects invalid JSON", () => {
      const parsed = parseToolSpec(JSON.stringify(sampleToolSpec1));
      expect(parsed).not.toBeNull();
      expect(parsed?.name).toBe("calculatorTool");

      expect(parseToolSpec("")).toBeNull();
      expect(parseToolSpec("   ")).toBeNull();
      expect(parseToolSpec("{ invalid json }")).toBeNull();
    });
  });

  describe("Directory Scanning & File Filtering", () => {
    it("handles non-existent search directory gracefully", () => {
      const tools = discoverToolsFromDirectory(join(testRoot, "non-existent-dir"));
      expect(tools).toEqual([]);
    });

    it("discovers tools matching specified extensions recursively", () => {
      const scanDir = join(testRoot, "dir-scan-test");
      const subDir = join(scanDir, "nested", "sub");
      mkdirSync(subDir, { recursive: true });

      writeFileSync(join(scanDir, "tool1.json"), JSON.stringify(sampleToolSpec1));
      writeFileSync(join(subDir, "tool2.tool.json"), JSON.stringify(sampleToolSpec2));
      writeFileSync(join(scanDir, "ignored.txt"), "Not a json tool");
      writeFileSync(join(scanDir, "readme.md"), "# Readme");

      const discovered = discoverToolsFromDirectory(scanDir, {
        extensions: [".json", ".tool.json"],
        recursive: true,
      });

      expect(discovered.length).toBe(2);
      const names = discovered.map((d) => d.definition.name).sort();
      expect(names).toEqual(["calculatorTool", "networkPing"]);
    });

    it("respects non-recursive directory scanning", () => {
      const nonRecDir = join(testRoot, "non-recursive-test");
      const innerDir = join(nonRecDir, "inner");
      mkdirSync(innerDir, { recursive: true });

      writeFileSync(join(nonRecDir, "root.json"), JSON.stringify(sampleToolSpec1));
      writeFileSync(join(innerDir, "nested.json"), JSON.stringify(sampleToolSpec2));

      const discovered = discoverToolsFromDirectory(nonRecDir, { recursive: false });
      expect(discovered.length).toBe(1);
      expect(discovered[0]?.definition.name).toBe("calculatorTool");
    });

    it("applies default category overrides for generic tools", () => {
      const catDir = join(testRoot, "cat-override-test");
      mkdirSync(catDir, { recursive: true });
      writeFileSync(join(catDir, "generic.json"), JSON.stringify(genericToolSpec));

      const discovered = discoverToolsFromDirectory(catDir, { defaultCategory: "customCategory" });
      expect(discovered.length).toBe(1);
      expect(discovered[0]?.definition.category).toBe("customCategory");
    });
  });

  describe("Manifest Tool Discovery", () => {
    it("handles non-existent manifest files gracefully", () => {
      const tools = discoverToolsFromManifest(join(testRoot, "missing-manifest.json"));
      expect(tools).toEqual([]);
    });

    it("parses single tool object manifest", () => {
      const singleManifestDir = join(testRoot, "single-manifest");
      mkdirSync(singleManifestDir, { recursive: true });
      const manifestPath = join(singleManifestDir, "single.json");
      writeFileSync(manifestPath, JSON.stringify(sampleToolSpec1));

      const tools = discoverToolsFromManifest(manifestPath);
      expect(tools.length).toBe(1);
      expect(tools[0]?.name).toBe("calculatorTool");
    });

    it("parses array of tool objects in manifest", () => {
      const arrayManifestDir = join(testRoot, "array-manifest");
      mkdirSync(arrayManifestDir, { recursive: true });
      const manifestPath = join(arrayManifestDir, "tools-array.json");
      writeFileSync(manifestPath, JSON.stringify([sampleToolSpec1, sampleToolSpec2]));

      const tools = discoverToolsFromManifest(manifestPath);
      expect(tools.length).toBe(2);
      expect(tools.map((t) => t.name).sort()).toEqual(["calculatorTool", "networkPing"]);
    });

    it("parses object wrapper manifest with tools key", () => {
      const wrappedManifestDir = join(testRoot, "wrapped-manifest");
      mkdirSync(wrappedManifestDir, { recursive: true });
      const manifestPath = join(wrappedManifestDir, "wrapped.json");
      writeFileSync(manifestPath, JSON.stringify({ tools: [sampleToolSpec1, sampleToolSpec2] }));

      const tools = discoverToolsFromManifest(manifestPath);
      expect(tools.length).toBe(2);
      expect(tools.map((t) => t.name).sort()).toEqual(["calculatorTool", "networkPing"]);
    });

    it("applies manifest default category to general tools", () => {
      const defCatDir = join(testRoot, "def-cat-manifest");
      mkdirSync(defCatDir, { recursive: true });
      const manifestPath = join(defCatDir, "general.json");
      writeFileSync(manifestPath, JSON.stringify(genericToolSpec));

      const tools = discoverToolsFromManifest(manifestPath, "manifestFallback");
      expect(tools.length).toBe(1);
      expect(tools[0]?.category).toBe("manifestFallback");
    });

    it("handles malformed JSON and non-object items in manifest gracefully", () => {
      const edgeDir = join(testRoot, "manifest-edge-cases");
      mkdirSync(edgeDir, { recursive: true });
      const badJsonPath = join(edgeDir, "malformed.json");
      writeFileSync(badJsonPath, "{ not valid json");
      expect(discoverToolsFromManifest(badJsonPath)).toEqual([]);

      const mixedArrayPath = join(edgeDir, "mixed.json");
      writeFileSync(mixedArrayPath, JSON.stringify([null, "not-an-object", 123, sampleToolSpec1]));
      const res = discoverToolsFromManifest(mixedArrayPath);
      expect(res.length).toBe(1);
      expect(res[0]?.name).toBe("calculatorTool");
    });
  });

  describe("Scan and Register Engine", () => {
    it("scans directories and registers discovered tools into registry", () => {
      const scanRegisterDir = join(testRoot, "scan-reg-test");
      mkdirSync(scanRegisterDir, { recursive: true });
      writeFileSync(join(scanRegisterDir, "tool1.json"), JSON.stringify(sampleToolSpec1));
      writeFileSync(join(scanRegisterDir, "tool2.json"), JSON.stringify(sampleToolSpec2));

      const registry = new DynamicToolRegistry();
      const report = scanAndRegisterTools(registry, [scanRegisterDir]);

      expect(report.discoveredCount).toBe(2);
      expect(report.registeredCount).toBe(2);
      expect(report.errors).toEqual([]);
      expect(registry.get("calculatorTool")).toBeDefined();
      expect(registry.get("networkPing")).toBeDefined();
    });

    it("skips registration when autoRegister is false", () => {
      const scanNoRegDir = join(testRoot, "scan-no-reg-test");
      mkdirSync(scanNoRegDir, { recursive: true });
      writeFileSync(join(scanNoRegDir, "tool1.json"), JSON.stringify(sampleToolSpec1));

      const registry = new DynamicToolRegistry();
      const report = scanAndRegisterTools(registry, [scanNoRegDir], { autoRegister: false });

      expect(report.discoveredCount).toBe(1);
      expect(report.registeredCount).toBe(0);
      expect(registry.get("calculatorTool")).toBeUndefined();
    });

    it("collects errors during registration conflicts", () => {
      const conflictDir = join(testRoot, "conflict-test");
      mkdirSync(conflictDir, { recursive: true });
      writeFileSync(join(conflictDir, "t1.json"), JSON.stringify(sampleToolSpec1));

      const registry = new DynamicToolRegistry();
      registry.register({ ...sampleToolSpec1, aliases: ["conflictAlias"] });

      const duplicateSpec = {
        name: "otherTool",
        description: "Tool with alias conflict",
        category: "other",
        parameters: [],
        aliases: ["conflictAlias"],
      };
      writeFileSync(join(conflictDir, "t2.json"), JSON.stringify(duplicateSpec));

      const report = scanAndRegisterTools(registry, [conflictDir]);
      expect(report.discoveredCount).toBe(2);
      expect(report.errors.length).toBeGreaterThan(0);
    });

    it("cleans up temporary test directory", () => {
      rmSync(testRoot, { recursive: true, force: true });
      expect(true).toBe(true);
    });
  });
});
