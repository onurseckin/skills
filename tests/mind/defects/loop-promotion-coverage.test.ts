/**
 * @file loop-promotion-coverage.test.ts
 * Comprehensive unit tests for olt/scripts/src/mind/defects/loop/promotion.ts
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  autoPromoteDefect,
  promoteResolvedDefects,
  requireDistinctLedgerPaths,
  validateRegressionTest,
} from "../../../olt/scripts/src/mind/defects/loop/promotion.ts";
import type {
  DefectEntry,
  DefectResolutionProof,
} from "../../../olt/scripts/src/mind/defects/core/types.ts";
import { createMockDefectEntry, createMockResolutionProof } from "./defect-fixture.ts";

describe("Defect Promotion Coverage Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "defect-promo-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
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
      writeFileSync(src, "");
      const targetDir = join(tempDir, "target_dir");
      mkdirSync(targetDir);

      expect(() => requireDistinctLedgerPaths(src, targetDir)).toThrow(
        /completed target path is a directory/,
      );
    });

    it("throws when source and target point to same file via symlink", () => {
      const realFile = join(tempDir, "real.jsonl");
      writeFileSync(realFile, "{}");
      const symlinkFile = join(tempDir, "symlink.jsonl");
      symlinkSync(realFile, symlinkFile);

      expect(() => requireDistinctLedgerPaths(realFile, symlinkFile)).toThrow(
        /same physical file via symlink/,
      );
    });

    it("throws when source and target point to same file via hardlink", () => {
      const src = join(tempDir, "orig.jsonl");
      writeFileSync(src, "{}");
      const hardlinkFile = join(tempDir, "hardlink.jsonl");
      linkSync(src, hardlinkFile);

      expect(() => requireDistinctLedgerPaths(src, hardlinkFile)).toThrow(/same file via hardlink/);
    });

    it("succeeds when source and target are distinct paths", () => {
      const src = join(tempDir, "active.jsonl");
      const tgt = join(tempDir, "completed.jsonl");
      writeFileSync(src, "{}");
      writeFileSync(tgt, "{}");
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
      const resBraces = validateRegressionTest(badBraces);
      expect(resBraces.isValid).toBe(false);
      expect(resBraces.issues.some((i) => i.includes("Mismatched braces"))).toBe(true);

      const badParens = 'describe("suite", () => { test("t", () => { expect(1.toBe(1); }); });';
      const resParens = validateRegressionTest(badParens);
      expect(resParens.isValid).toBe(false);
      expect(resParens.issues.some((i) => i.includes("Mismatched parentheses"))).toBe(true);
    });

    it("accepts valid test code with balanced syntax and assertions", () => {
      const code = 'it("works", () => { expect(42).toBe(42); });';
      const res = validateRegressionTest(code);
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
      mkdirSync(join(capsule, "mind"), { recursive: true });
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
      expect(res.generated_tests).toBeDefined();
      expect(res.generated_tests).toHaveLength(1);
      expect(res.generated_test_suite).toBeDefined();
      expect(res.generated_test_suite).toContain("DEF-REG-GEN");
    });

    it("writes promoted entries to target and updates source file on disk", () => {
      const src = join(tempDir, "active.jsonl");
      const tgt = join(tempDir, "completed.jsonl");
      const defect1 = createMockDefectEntry({
        id: "DEF-1",
        status: "resolved",
        resolution: createMockResolutionProof(),
      });
      const defect2 = createMockDefectEntry({
        id: "DEF-2",
        status: "open",
      });

      writeFileSync(src, `${JSON.stringify(defect1)}\n${JSON.stringify(defect2)}\n`);

      const res = promoteResolvedDefects({
        sourcePath: src,
        targetPath: tgt,
        dryRun: false,
        updateSourceFile: true,
      });

      expect(res.promoted_count).toBe(1);
      expect(res.unpromoted_count).toBe(1);
      expect(existsSync(tgt)).toBe(true);

      const tgtContent = readFileSync(tgt, "utf-8");
      expect(tgtContent).toContain("DEF-1");

      const srcContent = readFileSync(src, "utf-8");
      expect(srcContent).not.toContain("DEF-1");
      expect(srcContent).toContain("DEF-2");
    });
  });

  describe("autoPromoteDefect", () => {
    it("throws HarnessError when target defect is absent in active log", () => {
      const src = join(tempDir, "active.jsonl");
      const tgt = join(tempDir, "completed.jsonl");
      writeFileSync(src, "");

      const proof = createMockResolutionProof();
      expect(() =>
        autoPromoteDefect({
          id: "NON-EXISTENT",
          proof,
          options: { sourcePath: src, targetPath: tgt },
        }),
      ).toThrow(HarnessError);
    });

    it("promotes single defect, writes to target, and removes from source", () => {
      const src = join(tempDir, "active.jsonl");
      const tgt = join(tempDir, "completed.jsonl");
      const defectA = createMockDefectEntry({ id: "DEF-A", status: "open" });
      const defectB = createMockDefectEntry({ id: "DEF-B", status: "open" });

      writeFileSync(src, `${JSON.stringify(defectA)}\n${JSON.stringify(defectB)}\n`);
      const proof = createMockResolutionProof();

      const res = autoPromoteDefect({
        id: "DEF-A",
        proof,
        options: { sourcePath: src, targetPath: tgt, dryRun: false },
      });

      expect(res.promoted).toBe(true);
      expect(res.defect.id).toBe("DEF-A");
      expect(res.defect.status).toBe("resolved");

      const tgtContent = readFileSync(tgt, "utf-8");
      expect(tgtContent).toContain("DEF-A");

      const srcContent = readFileSync(src, "utf-8");
      expect(srcContent).not.toContain("DEF-A");
      expect(srcContent).toContain("DEF-B");
    });

    it("respects dryRun and capsuleRoot options in autoPromoteDefect", () => {
      const capsule = join(tempDir, "capsule");
      const oltDir = join(capsule, ".olt");
      mkdirSync(oltDir, { recursive: true });
      const activePath = join(oltDir, "defects.jsonl");
      const defect = createMockDefectEntry({ id: "DEF-CAP", status: "open" });
      writeFileSync(activePath, `${JSON.stringify(defect)}\n`);

      const proof = createMockResolutionProof();
      const res = autoPromoteDefect({
        id: "DEF-CAP",
        proof,
        options: { capsuleRoot: capsule, dryRun: true },
      });

      expect(res.promoted).toBe(true);
      expect(res.targetPath).toContain("completed-defects.jsonl");
    });
  });
});
