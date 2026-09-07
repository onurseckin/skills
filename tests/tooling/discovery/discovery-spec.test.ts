import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  discoverToolsFromManifest,
  parseToolSpec,
  validateToolSpec,
} from "../../../olt/scripts/src/tooling/index.ts";

describe("Tool Specification and Manifest Discovery Suite", () => {
  let vfs: VirtualMemoryFS;
  let vfsSession: VirtualFSSession;
  let testRoot: string;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfsSession = createVirtualFSSession(vfs);
    testRoot = `/virtual/discovery-spec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    vfs.mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    vfsSession.cleanup();
    vfs.reset();
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

  describe("Manifest Tool Discovery", () => {
    it("handles non-existent manifest files gracefully", () => {
      const tools = discoverToolsFromManifest(join(testRoot, "missing-manifest.json"));
      expect(tools).toEqual([]);
    });

    it("parses single tool object manifest", () => {
      const singleManifestDir = join(testRoot, "single-manifest");
      vfs.mkdirSync(singleManifestDir, { recursive: true });
      const manifestPath = join(singleManifestDir, "single.json");
      vfs.writeFileSync(manifestPath, JSON.stringify(sampleToolSpec1));

      const tools = discoverToolsFromManifest(manifestPath);
      expect(tools.length).toBe(1);
      expect(tools[0]?.name).toBe("calculatorTool");
    });

    it("parses array of tool objects in manifest", () => {
      const arrayManifestDir = join(testRoot, "array-manifest");
      vfs.mkdirSync(arrayManifestDir, { recursive: true });
      const manifestPath = join(arrayManifestDir, "tools-array.json");
      vfs.writeFileSync(manifestPath, JSON.stringify([sampleToolSpec1, sampleToolSpec2]));

      const tools = discoverToolsFromManifest(manifestPath);
      expect(tools.length).toBe(2);
      expect(tools.map((t) => t.name).sort()).toEqual(["calculatorTool", "networkPing"]);
    });

    it("parses object wrapper manifest with tools key", () => {
      const wrappedManifestDir = join(testRoot, "wrapped-manifest");
      vfs.mkdirSync(wrappedManifestDir, { recursive: true });
      const manifestPath = join(wrappedManifestDir, "wrapped.json");
      vfs.writeFileSync(
        manifestPath,
        JSON.stringify({ tools: [sampleToolSpec1, sampleToolSpec2] }),
      );

      const tools = discoverToolsFromManifest(manifestPath);
      expect(tools.length).toBe(2);
      expect(tools.map((t) => t.name).sort()).toEqual(["calculatorTool", "networkPing"]);
    });

    it("applies manifest default category to general tools", () => {
      const defCatDir = join(testRoot, "def-cat-manifest");
      vfs.mkdirSync(defCatDir, { recursive: true });
      const manifestPath = join(defCatDir, "general.json");
      vfs.writeFileSync(manifestPath, JSON.stringify(genericToolSpec));

      const tools = discoverToolsFromManifest(manifestPath, "manifestFallback");
      expect(tools.length).toBe(1);
      expect(tools[0]?.category).toBe("manifestFallback");
    });

    it("handles malformed JSON and non-object items in manifest gracefully", () => {
      const edgeDir = join(testRoot, "manifest-edge-cases");
      vfs.mkdirSync(edgeDir, { recursive: true });
      const badJsonPath = join(edgeDir, "malformed.json");
      vfs.writeFileSync(badJsonPath, "{ not valid json");
      expect(discoverToolsFromManifest(badJsonPath)).toEqual([]);

      const mixedArrayPath = join(edgeDir, "mixed.json");
      vfs.writeFileSync(
        mixedArrayPath,
        JSON.stringify([null, "not-an-object", 123, sampleToolSpec1]),
      );
      const res = discoverToolsFromManifest(mixedArrayPath);
      expect(res.length).toBe(1);
      expect(res[0]?.name).toBe("calculatorTool");
    });
  });
});
