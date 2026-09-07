import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  autoPromoteDefect,
  promoteResolvedDefects,
  requireDistinctLedgerPaths,
  validateRegressionTest,
} from "../../../olt/scripts/src/mind/defects/loop/promotion.ts";
import type { DefectResolutionProof } from "../../../olt/scripts/src/mind/defects/core/types.ts";
import { createMockDefectEntry, createMockResolutionProof } from "./defect-fixture.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Defect Promotion Coverage Suite", () => {
  const tempDir = "/virtual/defect-promo-test";
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;

  const writeLedger = (file: string, entries: unknown[]) =>
    vfs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

  const createHardlink = (srcPath: string, dstPath: string): void => {
    const fn = session.spies[10] as unknown as (s: string, d: string) => void;
    fn(srcPath, dstPath);
  };

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("requireDistinctLedgerPaths", () => {
    it("throws when source and target paths resolve to the same normalized path", () => {
      const p = join(tempDir, "defects.jsonl");
      expect(() => requireDistinctLedgerPaths(p, p)).toThrow(HarnessError);
      expect(() => requireDistinctLedgerPaths(p, join(tempDir, ".", "defects.jsonl"))).toThrow(
        /source and target defect ledger paths must be distinct/,
      );
    });

    it("throws when target path is an existing directory", () => {
      const src = join(tempDir, "active.jsonl");
      vfs.writeFileSync(src, "");
      const targetDir = join(tempDir, "target_dir");
      vfs.mkdirSync(targetDir);
      expect(() => requireDistinctLedgerPaths(src, targetDir)).toThrow(
        /completed target path is a directory/,
      );
    });

    it("throws when source and target point to same file via symlink", () => {
      const realFile = join(tempDir, "real.jsonl");
      vfs.writeFileSync(realFile, "{}");
      const symlinkFile = join(tempDir, "symlink.jsonl");
      session.symlinkSync(realFile, symlinkFile);
      expect(() => requireDistinctLedgerPaths(realFile, symlinkFile)).toThrow(
        /same physical file via symlink/,
      );
    });

    it("throws when source and target point to same file via hardlink", () => {
      const src = join(tempDir, "orig.jsonl");
      vfs.writeFileSync(src, "{}");
      const hardlinkFile = join(tempDir, "hardlink.jsonl");
      createHardlink(src, hardlinkFile);
      expect(() => requireDistinctLedgerPaths(src, hardlinkFile)).toThrow(/same file via hardlink/);
    });

    it("succeeds when source and target are distinct paths", () => {
      const src = join(tempDir, "active.jsonl");
      const tgt = join(tempDir, "completed.jsonl");
      vfs.writeFileSync(src, "{}");
      vfs.writeFileSync(tgt, "{}");
      expect(() => requireDistinctLedgerPaths(src, tgt)).not.toThrow();
    });
  });

  describe("validateRegressionTest", () => {
    it("rejects non-string, empty, or whitespace test code", () => {
      expect(validateRegressionTest("" as string).isValid).toBe(false);
      expect(validateRegressionTest("   \n  \t").isValid).toBe(false);
      expect(validateRegressionTest(null as unknown as string).isValid).toBe(false);
      expect(validateRegressionTest(undefined as unknown as string).isValid).toBe(false);
    });

    it("detects missing describe/test/it runners and missing expect assertions", () => {
      const res = validateRegressionTest("const a = 10; const b = 20;");
      expect(res.isValid).toBe(false);
      expect(res.issues).toContain("Test code must contain at least describe(), test(), or it()");
      expect(res.issues).toContain("Test code must contain expect() assertion");
    });

    it("detects mismatched braces and parentheses", () => {
      const badBraces = 'describe("suite", () => { test("t", () => { expect(1).toBe(1); });';
      expect(
        validateRegressionTest(badBraces).issues.some((i) => i.includes("Mismatched braces")),
      ).toBe(true);

      const badParens = 'describe("suite", () => { test("t", () => { expect(1.toBe(1); }); });';
      expect(
        validateRegressionTest(badParens).issues.some((i) => i.includes("Mismatched parentheses")),
      ).toBe(true);
    });

    it("accepts valid test code with balanced syntax and assertions", () => {
      const res = validateRegressionTest('it("works", () => { expect(42).toBe(42); });');
      expect(res.isValid).toBe(true);
      expect(res.issues).toHaveLength(0);
    });
  });

  describe("promoteResolvedDefects", () => {
    it("handles options-only invocation and defaults gracefully", () => {
      const src = join(tempDir, "src-empty.jsonl");
      const tgt = join(tempDir, "tgt-empty.jsonl");
      const res = promoteResolvedDefects({ sourcePath: src, targetPath: tgt, dryRun: true });
      expect(res.total_evaluated).toBe(0);
      expect(res.promoted_count).toBe(0);
      expect(res.unpromoted_count).toBe(0);
    });

    it("resolves paths via capsuleRoot when provided", () => {
      const capsule = join(tempDir, "capsule");
      vfs.mkdirSync(join(capsule, "mind"), { recursive: true });
      const res = promoteResolvedDefects({ capsuleRoot: capsule, dryRun: true });
      expect(res.source_path).toContain("capsule");
      expect(res.target_path).toContain("capsule");
    });

    it("throws HarnessError on invalid defect resolution proof", () => {
      const invalidDefect = createMockDefectEntry({
        id: "DEF-INVALID-PROOF",
        status: "resolved",
        resolution: {
          resolved_at: "invalid-date",
          task_id: "",
          commit_sha: "abc",
          test_assertion: "",
        } as unknown as DefectResolutionProof,
      });

      expect(() =>
        promoteResolvedDefects([invalidDefect], {
          sourcePath: join(tempDir, "s.jsonl"),
          targetPath: join(tempDir, "t.jsonl"),
        }),
      ).toThrow(HarnessError);
    });

    it("promotes completed status defects and handles requireResolutionProof: false", () => {
      const compDefect = createMockDefectEntry({
        id: "DEF-COMPLETED",
        status: "completed",
        resolution: undefined,
      });
      const res = promoteResolvedDefects([compDefect], {
        sourcePath: join(tempDir, "s.jsonl"),
        targetPath: join(tempDir, "t.jsonl"),
        requireResolutionProof: false,
        dryRun: true,
      });
      expect(res.promoted_count).toBe(1);
    });

    it("generates regression test suite when generateRegressionTests is enabled", () => {
      const defect = createMockDefectEntry({
        id: "DEF-REG-GEN",
        status: "resolved",
        resolution: createMockResolutionProof(),
      });
      const res = promoteResolvedDefects([defect], {
        sourcePath: join(tempDir, "s.jsonl"),
        targetPath: join(tempDir, "t.jsonl"),
        generateRegressionTests: true,
        dryRun: true,
      });
      expect(res.generated_tests).toHaveLength(1);
      expect(res.generated_test_suite).toContain("DEF-REG-GEN");
    });

    it("writes promoted entries to target and updates source file on disk", () => {
      const src = join(tempDir, "active.jsonl");
      const tgt = join(tempDir, "completed.jsonl");
      const d1 = createMockDefectEntry({
        id: "DEF-1",
        status: "resolved",
        resolution: createMockResolutionProof(),
      });
      const d2 = createMockDefectEntry({ id: "DEF-2", status: "open" });
      writeLedger(src, [d1, d2]);

      const res = promoteResolvedDefects({
        sourcePath: src,
        targetPath: tgt,
        dryRun: false,
        updateSourceFile: true,
      });

      expect(res.promoted_count).toBe(1);
      expect(res.unpromoted_count).toBe(1);
      expect(vfs.existsSync(tgt)).toBe(true);
      expect(vfs.readFileSync(tgt, "utf-8")).toContain("DEF-1");
      expect(vfs.readFileSync(src, "utf-8")).not.toContain("DEF-1");
      expect(vfs.readFileSync(src, "utf-8")).toContain("DEF-2");
    });
  });

  describe("autoPromoteDefect", () => {
    it("throws HarnessError when target defect is absent in active log", () => {
      const src = join(tempDir, "active.jsonl");
      const tgt = join(tempDir, "completed.jsonl");
      vfs.writeFileSync(src, "");
      expect(() =>
        autoPromoteDefect({
          id: "NON-EXISTENT",
          proof: createMockResolutionProof(),
          options: { sourcePath: src, targetPath: tgt },
        }),
      ).toThrow(HarnessError);
    });

    it("promotes single defect, writes to target, and removes from source", () => {
      const src = join(tempDir, "active.jsonl");
      const tgt = join(tempDir, "completed.jsonl");
      writeLedger(src, [
        createMockDefectEntry({ id: "DEF-A", status: "open" }),
        createMockDefectEntry({ id: "DEF-B", status: "open" }),
      ]);

      const res = autoPromoteDefect({
        id: "DEF-A",
        proof: createMockResolutionProof(),
        options: { sourcePath: src, targetPath: tgt, dryRun: false },
      });

      expect(res.promoted).toBe(true);
      expect(res.defect.id).toBe("DEF-A");
      expect(res.defect.status).toBe("resolved");
      expect(vfs.readFileSync(tgt, "utf-8")).toContain("DEF-A");
      expect(vfs.readFileSync(src, "utf-8")).not.toContain("DEF-A");
      expect(vfs.readFileSync(src, "utf-8")).toContain("DEF-B");
    });

    it("respects dryRun and capsuleRoot options in autoPromoteDefect", () => {
      const capsule = join(tempDir, "capsule");
      const oltDir = join(capsule, ".olt");
      vfs.mkdirSync(oltDir, { recursive: true });
      writeLedger(join(oltDir, "defects.jsonl"), [
        createMockDefectEntry({ id: "DEF-CAP", status: "open" }),
      ]);

      const res = autoPromoteDefect({
        id: "DEF-CAP",
        proof: createMockResolutionProof(),
        options: { capsuleRoot: capsule, dryRun: true },
      });

      expect(res.promoted).toBe(true);
      expect(res.targetPath).toContain("completed-defects.jsonl");
    });
  });
});
