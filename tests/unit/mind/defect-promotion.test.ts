import { afterEach, describe, expect, test } from "bun:test";
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
import { join, relative } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  appendCompletedDefectLogEntry,
  autoPromoteDefect,
  generateDefectRegressionTest,
  generateRegressionTestSuite,
  isDefectEligibleForPromotion,
  parseDefectLog,
  promoteResolvedDefects,
  readCompletedDefectsLog,
  resolveDefect,
  resolveCanonicalDefectLogPath,
  resolveCanonicalCompletedDefectsPath,
  resolveCompletedDefectsPath,
  serializeDefectLog,
  validateRegressionTest,
  validateResolutionProof,
  verifyResolutionProofEmpirical,
  writeCompletedDefectsLog,
  type DefectCategory,
  type DefectEntry,
  type DefectResolutionProof,
} from "../../../olt/scripts/src/mind/defects/index.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
  tempRoots.length = 0;
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function createSampleDefect(overrides: Partial<DefectEntry> = {}): DefectEntry {
  return {
    id: `defect-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: "main_thread_direct_execution",
    severity: "critical",
    timestamp: new Date().toISOString(),
    category: "boundary_violation",
    status: "open",
    observation: "Main thread executed task directly",
    remediation: "Dispatch Tier 3 Implementer via invoke_subagent",
    ...overrides,
  };
}

describe("Defect Promotion Engine", () => {
  describe("Resolution Proof Validation (validateResolutionProof & verifyResolutionProofEmpirical)", () => {
    test("validates complete resolution proof with all required and optional fields", () => {
      const proofInput = {
        task_id: "task-101-remediation",
        test_assertion: "expect(isBoundaryConcurred).toBeTrue()",
        resolved_at: "2026-08-23T04:00:00.000Z",
        commit_sha: "abcd1234ef567890abcd1234ef567890abcd1234",
        remediation_notes: "Implemented boundary enforcement test gate",
        verified_by: "agent-validator-alpha",
      };

      const validated = validateResolutionProof(proofInput);
      expect(validated.task_id).toBe("task-101-remediation");
      expect(validated.test_assertion).toBe("expect(isBoundaryConcurred).toBeTrue()");
      expect(validated.resolved_at).toBe("2026-08-23T04:00:00.000Z");
      expect(validated.commit_sha).toBe("abcd1234ef567890abcd1234ef567890abcd1234");
      expect(validated.remediation_notes).toBe("Implemented boundary enforcement test gate");
      expect(validated.verified_by).toBe("agent-validator-alpha");

      const empirical = verifyResolutionProofEmpirical(validated);
      expect(empirical.isValid).toBe(true);
      expect(empirical.reason).toBeUndefined();
    });

    test("throws HarnessError on non-object proof", () => {
      expect(() => validateResolutionProof(null)).toThrow(HarnessError);
      expect(() => validateResolutionProof("not an object")).toThrow(HarnessError);
      expect(() => validateResolutionProof(123)).toThrow(HarnessError);
    });

    test("throws HarnessError on missing or blank task_id", () => {
      const badProof = {
        task_id: "   ",
        test_assertion: "expect(true).toBeTrue()",
        resolved_at: new Date().toISOString(),
      };
      expect(() => validateResolutionProof(badProof)).toThrow(HarnessError);
    });

    test("throws HarnessError on missing or blank test_assertion", () => {
      const badProof = {
        task_id: "task-1",
        test_assertion: "  ",
        resolved_at: new Date().toISOString(),
      };
      expect(() => validateResolutionProof(badProof)).toThrow(HarnessError);
    });

    test("throws HarnessError on missing or invalid resolved_at date timestamp", () => {
      const missingDate = {
        task_id: "task-1",
        test_assertion: "expect(true).toBeTrue()",
        resolved_at: "",
      };
      expect(() => validateResolutionProof(missingDate)).toThrow(HarnessError);

      const invalidDate = {
        task_id: "task-1",
        test_assertion: "expect(true).toBeTrue()",
        resolved_at: "not-a-real-date",
      };
      expect(() => validateResolutionProof(invalidDate)).toThrow(HarnessError);
    });

    test("enforces valid commit_sha when requireCommitSha is enabled", () => {
      const proofWithoutSha = {
        task_id: "task-1",
        test_assertion: "expect(true).toBeTrue()",
        resolved_at: new Date().toISOString(),
      };
      expect(() => validateResolutionProof(proofWithoutSha, { requireCommitSha: true })).toThrow(
        HarnessError,
      );

      const proofWithShortSha = {
        ...proofWithoutSha,
        commit_sha: "abc",
      };
      expect(() => validateResolutionProof(proofWithShortSha, { requireCommitSha: true })).toThrow(
        HarnessError,
      );

      const proofWithValidSha = {
        ...proofWithoutSha,
        commit_sha: "abcd123",
      };
      const result = validateResolutionProof(proofWithValidSha, {
        requireCommitSha: true,
      });
      expect(result.commit_sha).toBe("abcd123");
    });

    test("verifyResolutionProofEmpirical rejects test assertions shorter than 5 characters", () => {
      const proof: DefectResolutionProof = {
        task_id: "task-1",
        test_assertion: "ok",
        resolved_at: new Date().toISOString(),
      };
      const result = verifyResolutionProofEmpirical(proof);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("too brief");
    });
  });

  describe("Defect Promotion Eligibility (isDefectEligibleForPromotion)", () => {
    test("marks resolved defect with valid proof as eligible", () => {
      const defect = createSampleDefect({
        status: "resolved",
        resolution: {
          task_id: "task-fix-1",
          test_assertion: "expect(isBoundaryConcurred).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });
      expect(isDefectEligibleForPromotion(defect)).toBe(true);
    });

    test("rejects open or wontfix defects even if resolution field exists", () => {
      const proof: DefectResolutionProof = {
        task_id: "task-fix-1",
        test_assertion: "expect(isBoundaryConcurred).toBeTrue()",
        resolved_at: new Date().toISOString(),
      };

      const openDefect = createSampleDefect({
        status: "open",
        resolution: proof,
      });
      expect(isDefectEligibleForPromotion(openDefect)).toBe(false);

      const wontfixDefect = createSampleDefect({
        status: "wontfix",
        resolution: proof,
      });
      expect(isDefectEligibleForPromotion(wontfixDefect)).toBe(false);
    });

    test("rejects resolved defects missing resolution proof or with invalid proof", () => {
      const noProof = createSampleDefect({
        status: "resolved",
        resolution: null,
      });
      expect(isDefectEligibleForPromotion(noProof)).toBe(false);

      const badProof = createSampleDefect({
        status: "resolved",
        resolution: {
          task_id: "",
          test_assertion: "a",
          resolved_at: "bad",
        },
      });
      expect(isDefectEligibleForPromotion(badProof)).toBe(false);
    });

    test("evaluates requireCommitSha option during promotion eligibility check", () => {
      const resolvedWithoutSha = createSampleDefect({
        status: "resolved",
        resolution: {
          task_id: "task-fix-1",
          test_assertion: "expect(isBoundaryConcurred).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });

      expect(
        isDefectEligibleForPromotion(resolvedWithoutSha, {
          requireCommitSha: false,
        }),
      ).toBe(true);
      expect(
        isDefectEligibleForPromotion(resolvedWithoutSha, {
          requireCommitSha: true,
        }),
      ).toBe(false);

      const resolvedWithSha = createSampleDefect({
        status: "resolved",
        resolution: {
          task_id: "task-fix-1",
          test_assertion: "expect(isBoundaryConcurred).toBeTrue()",
          resolved_at: new Date().toISOString(),
          commit_sha: "abcd1234567",
        },
      });
      expect(
        isDefectEligibleForPromotion(resolvedWithSha, {
          requireCommitSha: true,
        }),
      ).toBe(true);
    });
  });

  describe("Regression Test Generation & Validation", () => {
    test("generates regression test for boundary_violation category", () => {
      const defect = createSampleDefect({
        id: "defect-bv-1",
        category: "boundary_violation",
        type: "main_thread_direct_execution",
        remediation: "Dispatch Tier 3 Implementer",
      });

      const gen = generateDefectRegressionTest(defect);
      expect(gen.defect_id).toBe("defect-bv-1");
      expect(gen.category).toBe("boundary_violation");
      expect(gen.file_path_hint).toBe("tests/unit/mind/boundary-regression.test.ts");
      expect(gen.test_code).toContain("isBoundaryConcurred");

      const val = validateRegressionTest(
        `import { describe, expect, test } from "bun:test";\ndescribe("s", () => {\n${gen.test_code}\n});`,
      );
      expect(val.isValid).toBe(true);
    });

    test("generates regression test for model_reasoning_error category", () => {
      const defect = createSampleDefect({
        id: "defect-mre-1",
        category: "model_reasoning_error",
        type: "hallucination_detected",
        remediation: "Verify ground truth in store",
      });

      const gen = generateDefectRegressionTest(defect);
      expect(gen.defect_id).toBe("defect-mre-1");
      expect(gen.category).toBe("model_reasoning_error");
      expect(gen.file_path_hint).toBe("tests/unit/mind/reasoning-regression.test.ts");
      expect(gen.test_code).toContain("adheresToInvariants");

      const val = validateRegressionTest(
        `import { describe, expect, test } from "bun:test";\ndescribe("s", () => {\n${gen.test_code}\n});`,
      );
      expect(val.isValid).toBe(true);
    });

    test("generates regression test for code_defect category", () => {
      const defect = createSampleDefect({
        id: "defect-cd-1",
        category: "code_defect",
        type: "syntax_error",
        remediation: "Fix parse error in compiler",
      });

      const gen = generateDefectRegressionTest(defect);
      expect(gen.defect_id).toBe("defect-cd-1");
      expect(gen.category).toBe("code_defect");
      expect(gen.file_path_hint).toBe("tests/unit/mind/code-defect-regression.test.ts");
      expect(gen.test_code).toContain("isResolved");

      const val = validateRegressionTest(
        `import { describe, expect, test } from "bun:test";\ndescribe("s", () => {\n${gen.test_code}\n});`,
      );
      expect(val.isValid).toBe(true);
    });

    test("validateRegressionTest detects syntax defects and missing constructs", () => {
      expect(validateRegressionTest("").isValid).toBe(false);
      expect(validateRegressionTest("const x = 1;").isValid).toBe(false); // missing test() and expect()
      expect(validateRegressionTest("test('a', () => { const x = 1; });").isValid).toBe(false); // missing expect()

      const unbalancedBraces = validateRegressionTest("test('a', () => { expect(1).toBe(1); }); }");
      expect(unbalancedBraces.isValid).toBe(false);
      expect(unbalancedBraces.issues).toContain("Mismatched braces: balance is -1");

      const unbalancedParens = validateRegressionTest("test('a', () => { expect(1.toBe(1); });");
      expect(unbalancedParens.isValid).toBe(false);
      expect(unbalancedParens.issues).toContain("Mismatched parentheses: balance is 1");
    });

    test("generateRegressionTestSuite handles empty array with placeholder", () => {
      const suite = generateRegressionTestSuite([]);
      expect(suite).toContain("empty regression suite placeholder");
      expect(suite).toContain("Total defects protected: 0");
      const val = validateRegressionTest(suite);
      expect(val.isValid).toBe(true);
    });
  });

  describe("End-to-End Defect Promotion (promoteResolvedDefects)", () => {
    test("promotes resolved defects in-memory and separates open from eligible", () => {
      const b1 = createSampleDefect({
        id: "b-open-1",
        status: "open",
      });
      const b2 = createSampleDefect({
        id: "b-resolved-1",
        status: "resolved",
        resolution: {
          task_id: "task-1",
          test_assertion: "expect(true).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });
      const b3 = createSampleDefect({
        id: "b-resolved-no-proof",
        status: "resolved",
        resolution: null,
      });

      const result = promoteResolvedDefects([b1, b2, b3], {
        dryRun: true,
        generateRegressionTests: true,
      });

      expect(result.total_evaluated).toBe(3);
      expect(result.promoted_count).toBe(1);
      expect(result.unpromoted_count).toBe(2);
      expect(result.promoted_defects.map((b) => b.id)).toEqual(["b-resolved-1"]);
      expect(result.remaining_defects.map((b) => b.id)).toEqual([
        "b-open-1",
        "b-resolved-no-proof",
      ]);
      expect(result.generated_tests).toHaveLength(1);
      expect(result.generated_test_suite).toBeDefined();
    });

    test("promotes resolved defects on filesystem: moves from source to target COMPLETED_DEFECTS.jsonl", () => {
      const tempDir = createTempDir("defect-promo-fs-");
      const sourcePath = join(tempDir, "defects.jsonl");
      const targetPath = join(tempDir, "COMPLETED_DEFECTS.jsonl");

      const openDefect = createSampleDefect({ id: "defect-open" });
      const resolvedDefect = createSampleDefect({
        id: "defect-resolved",
        status: "resolved",
        resolution: {
          task_id: "task-resolve-1",
          test_assertion: "expect(boundaryRestraintActive).toBeTrue()",
          resolved_at: new Date().toISOString(),
          commit_sha: "abcdef1234567890",
        },
      });

      writeFileSync(sourcePath, serializeDefectLog([openDefect, resolvedDefect]), "utf8");

      const result = promoteResolvedDefects({
        sourcePath,
        targetPath,
        updateSourceFile: true,
        generateRegressionTests: true,
      });

      expect(result.promoted_count).toBe(1);
      expect(result.unpromoted_count).toBe(1);

      // Verify target file has the resolved defect
      const completedEntries = readCompletedDefectsLog(targetPath);
      expect(completedEntries).toHaveLength(1);
      expect(completedEntries[0]!.id).toBe("defect-resolved");

      // Verify source file only has the open defect remaining
      const remainingSourceContent = readFileSync(sourcePath, "utf8");
      const remainingSource = parseDefectLog(remainingSourceContent);
      expect(remainingSource).toHaveLength(1);
      expect(remainingSource[0]!.id).toBe("defect-open");
    });

    test("is idempotent when appending to existing completed defects log", () => {
      const tempDir = createTempDir("defect-promo-idempotent-");
      const sourcePath = join(tempDir, "defects.jsonl");
      const targetPath = join(tempDir, "COMPLETED_DEFECTS.jsonl");

      const resolved1 = createSampleDefect({
        id: "b-res-1",
        status: "resolved",
        resolution: {
          task_id: "task-1",
          test_assertion: "expect(true).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });
      const resolved2 = createSampleDefect({
        id: "b-res-2",
        status: "resolved",
        resolution: {
          task_id: "task-2",
          test_assertion: "expect(true).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });

      // First run: promote resolved1
      writeFileSync(sourcePath, serializeDefectLog([resolved1]), "utf8");
      promoteResolvedDefects({ sourcePath, targetPath });

      let completed = readCompletedDefectsLog(targetPath);
      expect(completed).toHaveLength(1);
      expect(completed[0]!.id).toBe("b-res-1");

      // Second run: promote resolved1 again and resolved2
      writeFileSync(sourcePath, serializeDefectLog([resolved1, resolved2]), "utf8");
      promoteResolvedDefects({ sourcePath, targetPath });

      completed = readCompletedDefectsLog(targetPath);
      expect(completed).toHaveLength(2);
      const ids = completed.map((c) => c.id);
      expect(ids).toContain("b-res-1");
      expect(ids).toContain("b-res-2");
    });

    test("fails closed when the completed target is a directory and preserves the active ledger", () => {
      const tempDir = createTempDir("defect-promo-directory-target-");
      const sourcePath = join(tempDir, "defects.jsonl");
      const targetPath = join(tempDir, "completed-directory");
      const resolved = createSampleDefect({
        id: "directory-target-bulk",
        status: "resolved",
        resolution: {
          task_id: "task-directory-target",
          test_assertion: "expect(targetWrite).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });
      const sourceBytes = serializeDefectLog([resolved]);
      writeFileSync(sourcePath, sourceBytes, "utf8");
      mkdirSync(targetPath);

      let error: unknown;
      try {
        promoteResolvedDefects({ sourcePath, targetPath });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect(readFileSync(sourcePath, "utf8")).toBe(sourceBytes);
    });

    test("recovers a target-only partial promotion without replacing its durable completed record", () => {
      const tempDir = createTempDir("defect-promo-target-only-retry-");
      const sourcePath = join(tempDir, "defects.jsonl");
      const targetPath = join(tempDir, "COMPLETED_DEFECTS.jsonl");
      const resolved = createSampleDefect({
        id: "target-only-partial",
        status: "resolved",
        resolution: {
          task_id: "task-target-only-retry",
          test_assertion: "expect(retryConverges).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });
      const staleResolved = createSampleDefect({
        ...resolved,
        type: "stale_resolution",
        observation: "Stale completed record",
      });
      const sourceBytes = serializeDefectLog([resolved]);
      writeFileSync(sourcePath, sourceBytes, "utf8");
      writeFileSync(targetPath, serializeDefectLog([staleResolved]), "utf8");

      promoteResolvedDefects({ sourcePath, targetPath });

      expect(readCompletedDefectsLog(targetPath).map((entry) => entry.id)).toEqual([
        "target-only-partial",
      ]);
      expect(readFileSync(targetPath, "utf8")).toBe(serializeDefectLog([staleResolved]));
      expect(parseDefectLog(readFileSync(sourcePath, "utf8"))).toEqual([]);
    });

    test("rejects identical active and completed paths before mutating either ledger", () => {
      const tempDir = createTempDir("defect-promo-identical-paths-");
      const sourcePath = join(tempDir, "defects.jsonl");
      const resolved = createSampleDefect({
        id: "identical-path-bulk",
        status: "resolved",
        resolution: {
          task_id: "task-identical-path",
          test_assertion: "expect(pathsAreDistinct).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });
      const sourceBytes = serializeDefectLog([resolved]);
      writeFileSync(sourcePath, sourceBytes, "utf8");

      let error: unknown;
      try {
        promoteResolvedDefects({ sourcePath, targetPath: sourcePath });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect(readFileSync(sourcePath, "utf8")).toBe(sourceBytes);
    });

    test("rejects a relative target alias for the active ledger before mutation", () => {
      const tempDir = createTempDir("defect-promo-relative-alias-");
      const sourcePath = join(tempDir, "defects.jsonl");
      const resolved = createSampleDefect({
        id: "relative-alias-bulk",
        status: "resolved",
        resolution: {
          task_id: "task-relative-alias",
          test_assertion: "expect(aliasRejected).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });
      const sourceBytes = serializeDefectLog([resolved]);
      writeFileSync(sourcePath, sourceBytes, "utf8");

      let error: unknown;
      try {
        promoteResolvedDefects({
          sourcePath,
          targetPath: relative(process.cwd(), sourcePath),
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect(readFileSync(sourcePath, "utf8")).toBe(sourceBytes);
    });

    test("rejects a symbolic-link target alias for the active ledger before mutation", () => {
      const tempDir = createTempDir("defect-promo-symlink-alias-");
      const sourcePath = join(tempDir, "defects.jsonl");
      const targetPath = join(tempDir, "completed-link.jsonl");
      const resolved = createSampleDefect({
        id: "symlink-alias-bulk",
        status: "resolved",
        resolution: {
          task_id: "task-symlink-alias",
          test_assertion: "expect(aliasRejected).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });
      const sourceBytes = serializeDefectLog([resolved]);
      writeFileSync(sourcePath, sourceBytes, "utf8");
      symlinkSync(sourcePath, targetPath);

      let error: unknown;
      try {
        promoteResolvedDefects({ sourcePath, targetPath });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect(readFileSync(sourcePath, "utf8")).toBe(sourceBytes);
    });

    test("rejects a hard-link target alias for the active ledger before mutation", () => {
      const tempDir = createTempDir("defect-promo-hardlink-alias-");
      const sourcePath = join(tempDir, "defects.jsonl");
      const targetPath = join(tempDir, "completed-hardlink.jsonl");
      const resolved = createSampleDefect({
        id: "hardlink-alias-bulk",
        status: "resolved",
        resolution: {
          task_id: "task-hardlink-alias",
          test_assertion: "expect(aliasRejected).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });
      const sourceBytes = serializeDefectLog([resolved]);
      writeFileSync(sourcePath, sourceBytes, "utf8");
      linkSync(sourcePath, targetPath);

      let error: unknown;
      try {
        promoteResolvedDefects({ sourcePath, targetPath });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect(readFileSync(sourcePath, "utf8")).toBe(sourceBytes);
    });

    test("dry runs without mutating either ledger", () => {
      const tempDir = createTempDir("defect-promo-dry-run-");
      const sourcePath = join(tempDir, "defects.jsonl");
      const targetPath = join(tempDir, "COMPLETED_DEFECTS.jsonl");
      const resolved = createSampleDefect({
        id: "dry-run-bulk",
        status: "resolved",
        resolution: {
          task_id: "task-dry-run",
          test_assertion: "expect(dryRun).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });
      const sourceBytes = serializeDefectLog([resolved]);
      const targetBytes = serializeDefectLog([createSampleDefect({ id: "existing-completed" })]);
      writeFileSync(sourcePath, sourceBytes, "utf8");
      writeFileSync(targetPath, targetBytes, "utf8");

      promoteResolvedDefects({ sourcePath, targetPath, dryRun: true });

      expect(readFileSync(sourcePath, "utf8")).toBe(sourceBytes);
      expect(readFileSync(targetPath, "utf8")).toBe(targetBytes);
    });

    test("keeps the active ledger when source updates are disabled", () => {
      const tempDir = createTempDir("defect-promo-preserve-active-");
      const sourcePath = join(tempDir, "defects.jsonl");
      const targetPath = join(tempDir, "COMPLETED_DEFECTS.jsonl");
      const resolved = createSampleDefect({
        id: "preserve-active-bulk",
        status: "resolved",
        resolution: {
          task_id: "task-preserve-active",
          test_assertion: "expect(activePreserved).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });
      const sourceBytes = serializeDefectLog([resolved]);
      writeFileSync(sourcePath, sourceBytes, "utf8");

      promoteResolvedDefects({
        sourcePath,
        targetPath,
        updateSourceFile: false,
      });

      expect(readFileSync(targetPath, "utf8")).toBe(
        serializeDefectLog(parseDefectLog(sourceBytes)),
      );
      expect(readFileSync(sourcePath, "utf8")).toBe(sourceBytes);
    });

    test("fails closed when the existing bulk source path cannot be read", () => {
      const tempDir = createTempDir("defect-promo-source-directory-");
      const sourcePath = join(tempDir, "active-directory");
      const targetPath = join(tempDir, "COMPLETED_DEFECTS.jsonl");
      mkdirSync(sourcePath);

      let error: unknown;
      try {
        promoteResolvedDefects({ sourcePath, targetPath });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect(existsSync(targetPath)).toBe(false);
    });
  });

  describe("Single Defect Auto-Promotion (autoPromoteDefect)", () => {
    test("automatically promotes a defect by ID and writes resolution proof", () => {
      const tempDir = createTempDir("defect-auto-promo-");
      const sourcePath = join(tempDir, "defects.jsonl");
      const targetPath = join(tempDir, "COMPLETED_DEFECTS.jsonl");

      const defect = createSampleDefect({ id: "defect-to-auto-promote" });
      writeFileSync(sourcePath, serializeDefectLog([defect]), "utf8");

      const proof: DefectResolutionProof = {
        task_id: "task-auto-fix",
        test_assertion: "expect(autoPromoted).toBeTrue()",
        resolved_at: new Date().toISOString(),
        commit_sha: "fedcba9876543210",
      };

      const result = autoPromoteDefect({
        id: "defect-to-auto-promote",
        proof,
        options: {
          sourcePath,
          targetPath,
        },
      });

      expect(result.promoted).toBe(true);
      expect(result.defect.id).toBe("defect-to-auto-promote");
      expect(result.defect.status).toBe("resolved");
      expect(result.defect.resolution?.task_id).toBe("task-auto-fix");

      const completed = readCompletedDefectsLog(targetPath);
      expect(completed).toHaveLength(1);
      expect(completed[0]!.id).toBe("defect-to-auto-promote");
      expect(completed[0]!.status).toBe("resolved");

      // Source file should now be empty of this defect
      const sourceRemaining = parseDefectLog(readFileSync(sourcePath, "utf8"));
      expect(sourceRemaining).toHaveLength(0);
    });

    test("refuses auto-promotion when ID does not exist in active log", () => {
      const tempDir = createTempDir("defect-auto-synth-");
      const sourcePath = join(tempDir, "defects.jsonl");
      const targetPath = join(tempDir, "COMPLETED_DEFECTS.jsonl");

      writeFileSync(
        sourcePath,
        serializeDefectLog([createSampleDefect({ id: "existing-id" })]),
        "utf8",
      );

      const proof: DefectResolutionProof = {
        task_id: "task-synthetic",
        test_assertion: "expect(syntheticResolved).toBeTrue()",
        resolved_at: new Date().toISOString(),
      };

      expect(() =>
        autoPromoteDefect({
          id: "new-synthetic-id",
          proof,
          options: { sourcePath, targetPath },
        }),
      ).toThrow(HarnessError);
      expect(existsSync(targetPath)).toBeFalse();
    });

    test("throws HarnessError when trying to auto-promote with invalid proof", () => {
      const tempDir = createTempDir("defect-auto-invalid-");
      const sourcePath = join(tempDir, "defects.jsonl");
      const targetPath = join(tempDir, "COMPLETED_DEFECTS.jsonl");

      const invalidProof = {
        task_id: "",
        test_assertion: "expect(true).toBeTrue()",
        resolved_at: new Date().toISOString(),
      } as unknown as DefectResolutionProof;

      expect(() =>
        autoPromoteDefect({
          id: "some-id",
          proof: invalidProof,
          options: { sourcePath, targetPath },
        }),
      ).toThrow(HarnessError);
    });

    test("fails closed when auto-promotion receives a completed target directory", () => {
      const tempDir = createTempDir("defect-auto-directory-target-");
      const sourcePath = join(tempDir, "defects.jsonl");
      const targetPath = join(tempDir, "completed-directory");
      const defect = createSampleDefect({ id: "directory-target-auto" });
      const sourceBytes = serializeDefectLog([defect]);
      writeFileSync(sourcePath, sourceBytes, "utf8");
      mkdirSync(targetPath);

      let error: unknown;
      try {
        autoPromoteDefect({
          id: defect.id,
          proof: {
            task_id: "task-auto-directory-target",
            test_assertion: "expect(targetWrite).toBeTrue()",
            resolved_at: new Date().toISOString(),
          },
          options: { sourcePath, targetPath },
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect(readFileSync(sourcePath, "utf8")).toBe(sourceBytes);
    });

    test("rejects identical auto-promotion paths before mutating the active ledger", () => {
      const tempDir = createTempDir("defect-auto-identical-paths-");
      const sourcePath = join(tempDir, "defects.jsonl");
      const defect = createSampleDefect({ id: "identical-path-auto" });
      const sourceBytes = serializeDefectLog([defect]);
      writeFileSync(sourcePath, sourceBytes, "utf8");

      let error: unknown;
      try {
        autoPromoteDefect({
          id: defect.id,
          proof: {
            task_id: "task-auto-identical-path",
            test_assertion: "expect(pathsAreDistinct).toBeTrue()",
            resolved_at: new Date().toISOString(),
          },
          options: { sourcePath, targetPath: sourcePath },
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect(readFileSync(sourcePath, "utf8")).toBe(sourceBytes);
    });

    test("rejects a symbolic-link auto-promotion target alias before mutation", () => {
      const tempDir = createTempDir("defect-auto-symlink-alias-");
      const sourcePath = join(tempDir, "defects.jsonl");
      const targetPath = join(tempDir, "completed-link.jsonl");
      const defect = createSampleDefect({ id: "symlink-alias-auto" });
      const sourceBytes = serializeDefectLog([defect]);
      writeFileSync(sourcePath, sourceBytes, "utf8");
      symlinkSync(sourcePath, targetPath);

      let error: unknown;
      try {
        autoPromoteDefect({
          id: defect.id,
          proof: {
            task_id: "task-auto-symlink-alias",
            test_assertion: "expect(aliasRejected).toBeTrue()",
            resolved_at: new Date().toISOString(),
          },
          options: { sourcePath, targetPath },
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect(readFileSync(sourcePath, "utf8")).toBe(sourceBytes);
    });

    test("fails closed when the existing auto-promotion source path cannot be read", () => {
      const tempDir = createTempDir("defect-auto-source-directory-");
      const sourcePath = join(tempDir, "active-directory");
      const targetPath = join(tempDir, "COMPLETED_DEFECTS.jsonl");
      mkdirSync(sourcePath);

      let error: unknown;
      try {
        autoPromoteDefect({
          id: "source-read-failure-auto",
          proof: {
            task_id: "task-auto-source-read",
            test_assertion: "expect(sourceRead).toBeTrue()",
            resolved_at: new Date().toISOString(),
          },
          options: { sourcePath, targetPath },
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect(existsSync(targetPath)).toBe(false);
    });
  });

  describe("Completed Defects Log Persistence Utilities", () => {
    test("handles reading from non-existent file gracefully returning empty array", () => {
      const missingPath = join(tmpdir(), `non-existent-${Date.now()}.jsonl`);
      expect(readCompletedDefectsLog(missingPath)).toEqual([]);
    });

    test("fails closed when an existing completed path cannot be read", () => {
      const tempDir = createTempDir("defect-completed-read-directory-");
      const targetPath = join(tempDir, "completed-directory");
      mkdirSync(targetPath);

      let error: unknown;
      try {
        readCompletedDefectsLog(targetPath);
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect((error as Error).message).toContain(targetPath);
    });

    test("appendCompletedDefectLogEntry appends a new completed defect", () => {
      const tempDir = createTempDir("defect-append-");
      const targetPath = join(tempDir, "COMPLETED_DEFECTS.jsonl");

      const b1 = createSampleDefect({ id: "b1", status: "resolved" });
      const b2 = createSampleDefect({ id: "b2", status: "resolved" });

      appendCompletedDefectLogEntry(b1, targetPath);
      appendCompletedDefectLogEntry(b2, targetPath);

      const entries = readCompletedDefectsLog(targetPath);
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.id)).toEqual(["b1", "b2"]);
    });

    test("resolveCompletedDefectsPath resolves canonical and fallback locations", () => {
      const customPath = "/custom/path/COMPLETED_DEFECTS.jsonl";
      expect(resolveCompletedDefectsPath(customPath)).toBe(customPath);

      const defaultResolved = resolveCompletedDefectsPath();
      expect(defaultResolved).toBeDefined();
      expect(defaultResolved.length).toBeGreaterThan(0);

      const canonicalPath = resolveCanonicalCompletedDefectsPath("/my/root");
      expect(canonicalPath).toContain("/my/root");
      expect(canonicalPath).toContain(".olt/completed-defects.jsonl");
    });
  });
});
