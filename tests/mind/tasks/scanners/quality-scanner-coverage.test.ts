import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { join, resolve } from "node:path";
import {
  collectFilesRecursively,
  resolveDiscoveryCharterPath,
  sanitizeSlug,
  scanCodeQuality,
} from "../../../../olt/scripts/src/mind/tasks/discovery/scanners/quality-scanner.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Task Discovery Quality Scanner Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const spies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
    session.cleanup();
  });

  describe("sanitizeSlug", () => {
    it("converts uppercase, special characters, and trims trailing hyphens with length cap", () => {
      expect(sanitizeSlug("Feature #123: Super (Cool) Feature!")).toBe(
        "feature-123-super-cool-feature",
      );
      expect(sanitizeSlug("---leading-and-trailing---")).toBe("leading-and-trailing");
      expect(sanitizeSlug("a".repeat(50))).toHaveLength(40);
      expect(sanitizeSlug("")).toBe("");
    });
  });

  describe("resolveDiscoveryCharterPath", () => {
    it("returns resolved custom path when provided or falls back to cwd charter path", () => {
      const custom = resolveDiscoveryCharterPath("custom/charter.yaml");
      expect(custom).toBe(resolve("custom/charter.yaml"));

      const fallback = resolveDiscoveryCharterPath("   ");
      expect(fallback).toContain(".yaml");
    });
  });

  describe("collectFilesRecursively", () => {
    it("returns accumulated files when dir does not exist", () => {
      expect(
        collectFilesRecursively("/virtual/root", "/virtual/root/missing", [".ts"], []),
      ).toEqual([]);
    });

    it("filters files by extension and respects exclude patterns", () => {
      const root = "/virtual/project";
      vfs.mkdirSync(join(root, "node_modules"), { recursive: true });
      vfs.mkdirSync(join(root, "sub"), { recursive: true });
      vfs.writeFileSync(join(root, "index.ts"), "");
      vfs.writeFileSync(join(root, "README.md"), "");
      vfs.writeFileSync(join(root, "sub", "component.tsx"), "");

      const files = collectFilesRecursively(root, root, [".ts", ".tsx"], ["node_modules"]);
      expect(files.sort()).toEqual(
        [join(root, "index.ts"), join(root, "sub", "component.tsx")].sort(),
      );
    });
  });

  describe("scanCodeQuality", () => {
    it("uses default options when none are passed", () => {
      (session.spies[0] as unknown as { mockReturnValue: (v: boolean) => void }).mockReturnValue(
        false,
      );
      const res = scanCodeQuality();
      expect(res.filesScanned).toBe(0);
      expect(res.totalFindings).toBe(0);
      expect(res.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("detects OVERSIZED_MODULE when line count exceeds threshold", () => {
      const longContent = Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`).join("\n");
      vfs.mkdirSync("/virtual/src", { recursive: true });
      vfs.writeFileSync("/virtual/src/large.ts", longContent);

      const res = scanCodeQuality({ sourceRoots: ["/virtual/src"], maxLineThreshold: 10 });
      expect(res.findings.some((f) => f.issueType === "OVERSIZED_MODULE")).toBe(true);
    });

    it("detects UNEXPORTED_DEAD_CODE on unreferenced top-level declarations", () => {
      const code = [
        "const unusedSecret = 42;",
        "export const usedPublic = 1;",
        "function unreferencedHelper() { return 1; }",
        "class UnusedEngine {}",
        "interface UnusedShape { id: string; }",
        "type UnusedAlias = string;",
        "let unusedVar = 'temp';",
        "var oldVar = true;",
        "const DEFAULT_TIMEOUT = 1000;",
        "const map = new Map();",
        "const ab = 1;",
        "// const commentedOut = 2;",
      ].join("\n");

      vfs.mkdirSync("/virtual/src", { recursive: true });
      vfs.writeFileSync("/virtual/src/dead.ts", code);

      const res = scanCodeQuality({ sourceRoots: ["/virtual/src"], maxLineThreshold: 1000 });
      const deadTypes = res.findings.filter((f) => f.issueType === "UNEXPORTED_DEAD_CODE");
      expect(deadTypes.length).toBeGreaterThanOrEqual(4);
      expect(deadTypes.some((f) => f.description.includes("unusedSecret"))).toBe(true);
      expect(deadTypes.some((f) => f.description.includes("unreferencedHelper"))).toBe(true);
      expect(deadTypes.some((f) => f.description.includes("DEFAULT_TIMEOUT"))).toBe(false);
      expect(deadTypes.some((f) => f.description.includes("map"))).toBe(false);
    });

    it("skips dead code check in test files and files with <= 5 lines", () => {
      const shortCode = "const deadA = 1;\nconst deadB = 2;";
      const testCode =
        "const deadTest = 1;\nconst deadTest2 = 2;\nconst deadTest3 = 3;\nconst deadTest4 = 4;\nconst deadTest5 = 5;\nconst deadTest6 = 6;";
      vfs.mkdirSync("/virtual/src", { recursive: true });
      vfs.writeFileSync("/virtual/src/short.ts", shortCode);
      vfs.writeFileSync("/virtual/src/module.test.ts", testCode);

      const res = scanCodeQuality({ sourceRoots: ["/virtual/src"] });
      expect(res.findings.some((f) => f.issueType === "UNEXPORTED_DEAD_CODE")).toBe(false);
    });

    it("detects COMPILER_SUPPRESSION and TYPE_SAFETY_ANY patterns", () => {
      const code = [
        "// @ts-ignore",
        "const a: any = 1;",
        "// @ts-nocheck",
        "const b = x as any;",
        "/* @ts-expect-error */",
        "const c: any = null;",
        "/* eslint-disable */",
        "const d: any = [];",
        "const f: Record<string, any> = {};",
        "function fn(param: any) {}",
        "// comment with : any should be ignored",
        "* multiline doc with as any ignored",
      ].join("\n");

      vfs.mkdirSync("/virtual/src", { recursive: true });
      vfs.writeFileSync("/virtual/src/types.ts", code);

      const res = scanCodeQuality({ sourceRoots: ["/virtual/src"] });
      const suppressions = res.findings.filter((f) => f.issueType === "COMPILER_SUPPRESSION");
      const anyTypes = res.findings.filter((f) => f.issueType === "TYPE_SAFETY_ANY");

      expect(suppressions).toHaveLength(4);
      expect(anyTypes.length).toBeGreaterThanOrEqual(6);
    });

    it("detects LITERAL_FALLBACK in production files and ignores them in test files", () => {
      const code = [
        "function stub1() { return 'TODO'; }",
        'function stub2() { return "dummy"; }',
        "function stub3() { return null as unknown as string; }",
        "function stub4() { return undefined as unknown as number; }",
        "const FALLBACK_OPTS = {};",
        "const STUB_HANDLER = () => {};",
        "const DUMMY_USER = { id: 1 };",
        "const MOCK_SERVICE = null;",
        "const cfg = { is_fallback: true, isFallback: true, literal_fallback: true };",
        "const flag = 1; // FALLBACK",
        "const note = 2; /* FALLBACK */",
      ].join("\n");

      vfs.mkdirSync("/virtual/src", { recursive: true });
      vfs.writeFileSync("/virtual/src/fallback.ts", code);
      vfs.writeFileSync("/virtual/src/fallback.spec.ts", code);

      const res = scanCodeQuality({ sourceRoots: ["/virtual/src"] });
      const fallbacks = res.findings.filter((f) => f.issueType === "LITERAL_FALLBACK");
      expect(fallbacks.length).toBeGreaterThanOrEqual(8);
      expect(fallbacks.every((f) => f.file.endsWith("fallback.ts"))).toBe(true);
    });

    it("detects TODO_FIXME_MARKER in comments", () => {
      const code = [
        "// TODO: implement caching",
        "/* FIXME: memory leak in loop */",
        "// HACK: bypass validation",
        "// XXX: temporary hack",
        "// BUG: race condition",
        "const normalCode = 1;",
      ].join("\n");

      vfs.mkdirSync("/virtual/src", { recursive: true });
      vfs.writeFileSync("/virtual/src/markers.ts", code);

      const res = scanCodeQuality({ sourceRoots: ["/virtual/src"] });
      const markers = res.findings.filter((f) => f.issueType === "TODO_FIXME_MARKER");
      expect(markers).toHaveLength(5);
    });

    it("respects maxFindings threshold and handles readFileSync errors gracefully", () => {
      const multiFindings = [
        "// TODO: 1",
        "// TODO: 2",
        "// TODO: 3",
        "// TODO: 4",
        "// TODO: 5",
      ].join("\n");

      vfs.mkdirSync("/virtual/src", { recursive: true });
      vfs.writeFileSync("/virtual/src/unreadable.ts", multiFindings);
      vfs.writeFileSync("/virtual/src/valid.ts", multiFindings);

      spies.push(
        spyOn(vfs, "readFileSync").mockImplementation((p: string) => {
          if (String(p).includes("unreadable")) throw new Error("Permission denied");
          return multiFindings;
        }),
      );

      const res = scanCodeQuality({ sourceRoots: ["/virtual/src"], maxFindings: 3 });
      expect(res.totalFindings).toBe(3);
      expect(res.findings).toHaveLength(3);
    });
  });
});
