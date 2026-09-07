import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  DynamicToolRegistry,
  discoverToolsFromDirectory,
  scanAndRegisterTools,
} from "../../../olt/scripts/src/tooling/index.ts";

describe("Tool Discovery and Scanning Unit Test Suite", () => {
  let vfs: VirtualMemoryFS;
  let vfsSession: VirtualFSSession;
  let testRoot: string;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfsSession = createVirtualFSSession(vfs);
    testRoot = `/virtual/discovery-unit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

  describe("Directory Scanning & File Filtering", () => {
    it("handles non-existent search directory gracefully", () => {
      const tools = discoverToolsFromDirectory(join(testRoot, "non-existent-dir"));
      expect(tools).toEqual([]);
    });

    it("discovers tools matching specified extensions recursively", () => {
      const scanDir = join(testRoot, "dir-scan-test");
      const subDir = join(scanDir, "nested", "sub");
      vfs.mkdirSync(subDir, { recursive: true });

      vfs.writeFileSync(join(scanDir, "tool1.json"), JSON.stringify(sampleToolSpec1));
      vfs.writeFileSync(join(subDir, "tool2.tool.json"), JSON.stringify(sampleToolSpec2));
      vfs.writeFileSync(join(scanDir, "ignored.txt"), "Not a json tool");
      vfs.writeFileSync(join(scanDir, "readme.md"), "# Readme");

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
      vfs.mkdirSync(innerDir, { recursive: true });

      vfs.writeFileSync(join(nonRecDir, "root.json"), JSON.stringify(sampleToolSpec1));
      vfs.writeFileSync(join(innerDir, "nested.json"), JSON.stringify(sampleToolSpec2));

      const discovered = discoverToolsFromDirectory(nonRecDir, { recursive: false });
      expect(discovered.length).toBe(1);
      expect(discovered[0]?.definition.name).toBe("calculatorTool");
    });

    it("applies default category overrides for generic tools", () => {
      const catDir = join(testRoot, "cat-override-test");
      vfs.mkdirSync(catDir, { recursive: true });
      vfs.writeFileSync(join(catDir, "generic.json"), JSON.stringify(genericToolSpec));

      const discovered = discoverToolsFromDirectory(catDir, { defaultCategory: "customCategory" });
      expect(discovered.length).toBe(1);
      expect(discovered[0]?.definition.category).toBe("customCategory");
    });
  });

  describe("Scan and Register Engine", () => {
    it("scans directories and registers discovered tools into registry", () => {
      const scanRegisterDir = join(testRoot, "scan-reg-test");
      vfs.mkdirSync(scanRegisterDir, { recursive: true });
      vfs.writeFileSync(join(scanRegisterDir, "tool1.json"), JSON.stringify(sampleToolSpec1));
      vfs.writeFileSync(join(scanRegisterDir, "tool2.json"), JSON.stringify(sampleToolSpec2));

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
      vfs.mkdirSync(scanNoRegDir, { recursive: true });
      vfs.writeFileSync(join(scanNoRegDir, "tool1.json"), JSON.stringify(sampleToolSpec1));

      const registry = new DynamicToolRegistry();
      const report = scanAndRegisterTools(registry, [scanNoRegDir], { autoRegister: false });

      expect(report.discoveredCount).toBe(1);
      expect(report.registeredCount).toBe(0);
      expect(registry.get("calculatorTool")).toBeUndefined();
    });

    it("collects errors during registration conflicts", () => {
      const conflictDir = join(testRoot, "conflict-test");
      vfs.mkdirSync(conflictDir, { recursive: true });
      vfs.writeFileSync(join(conflictDir, "t1.json"), JSON.stringify(sampleToolSpec1));

      const registry = new DynamicToolRegistry();
      registry.register({ ...sampleToolSpec1, aliases: ["conflictAlias"] });

      const duplicateSpec = {
        name: "otherTool",
        description: "Tool with alias conflict",
        category: "other",
        parameters: [],
        aliases: ["conflictAlias"],
      };
      vfs.writeFileSync(join(conflictDir, "t2.json"), JSON.stringify(duplicateSpec));

      const report = scanAndRegisterTools(registry, [conflictDir]);
      expect(report.discoveredCount).toBe(2);
      expect(report.errors.length).toBeGreaterThan(0);
    });

    it("cleans up temporary test directory", () => {
      vfs.rmSync(testRoot, { recursive: true, force: true });
      expect(vfs.existsSync(testRoot)).toBe(false);
    });
  });
});
