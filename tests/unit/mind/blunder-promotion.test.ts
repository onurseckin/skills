import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";
import {
  appendCompletedBlunderLogEntry,
  autoPromoteBlunder,
  generateBlunderRegressionTest,
  generateRegressionTestSuite,
  isBlunderEligibleForPromotion,
  parseBlunderLog,
  promoteResolvedBlunders,
  readCompletedBlundersLog,
  resolveBlunder,
  resolveCanonicalBlunderLogPath,
  resolveCanonicalCompletedBlundersPath,
  resolveCompletedBlundersPath,
  serializeBlunderLog,
  validateRegressionTest,
  validateResolutionProof,
  verifyResolutionProofEmpirical,
  writeCompletedBlundersLog,
  type BlunderCategory,
  type BlunderEntry,
  type BlunderResolutionProof,
} from "../../../olt/scripts/src/mind/blunders.ts";

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

function createSampleBlunder(overrides: Partial<BlunderEntry> = {}): BlunderEntry {
  return {
    id: `blunder-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

describe("Blunder Promotion Engine", () => {
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
      const result = validateResolutionProof(proofWithValidSha, { requireCommitSha: true });
      expect(result.commit_sha).toBe("abcd123");
    });

    test("verifyResolutionProofEmpirical rejects test assertions shorter than 5 characters", () => {
      const proof: BlunderResolutionProof = {
        task_id: "task-1",
        test_assertion: "ok",
        resolved_at: new Date().toISOString(),
      };
      const result = verifyResolutionProofEmpirical(proof);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("too brief");
    });
  });

  describe("Blunder Promotion Eligibility (isBlunderEligibleForPromotion)", () => {
    test("marks resolved blunder with valid proof as eligible", () => {
      const blunder = createSampleBlunder({
        status: "resolved",
        resolution: {
          task_id: "task-fix-1",
          test_assertion: "expect(isBoundaryConcurred).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });
      expect(isBlunderEligibleForPromotion(blunder)).toBe(true);
    });

    test("rejects open or wontfix blunders even if resolution field exists", () => {
      const proof: BlunderResolutionProof = {
        task_id: "task-fix-1",
        test_assertion: "expect(isBoundaryConcurred).toBeTrue()",
        resolved_at: new Date().toISOString(),
      };

      const openBlunder = createSampleBlunder({ status: "open", resolution: proof });
      expect(isBlunderEligibleForPromotion(openBlunder)).toBe(false);

      const wontfixBlunder = createSampleBlunder({ status: "wontfix", resolution: proof });
      expect(isBlunderEligibleForPromotion(wontfixBlunder)).toBe(false);
    });

    test("rejects resolved blunders missing resolution proof or with invalid proof", () => {
      const noProof = createSampleBlunder({ status: "resolved", resolution: null });
      expect(isBlunderEligibleForPromotion(noProof)).toBe(false);

      const badProof = createSampleBlunder({
        status: "resolved",
        resolution: {
          task_id: "",
          test_assertion: "a",
          resolved_at: "bad",
        },
      });
      expect(isBlunderEligibleForPromotion(badProof)).toBe(false);
    });

    test("evaluates requireCommitSha option during promotion eligibility check", () => {
      const resolvedWithoutSha = createSampleBlunder({
        status: "resolved",
        resolution: {
          task_id: "task-fix-1",
          test_assertion: "expect(isBoundaryConcurred).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });

      expect(isBlunderEligibleForPromotion(resolvedWithoutSha, { requireCommitSha: false })).toBe(
        true,
      );
      expect(isBlunderEligibleForPromotion(resolvedWithoutSha, { requireCommitSha: true })).toBe(
        false,
      );

      const resolvedWithSha = createSampleBlunder({
        status: "resolved",
        resolution: {
          task_id: "task-fix-1",
          test_assertion: "expect(isBoundaryConcurred).toBeTrue()",
          resolved_at: new Date().toISOString(),
          commit_sha: "abcd1234567",
        },
      });
      expect(isBlunderEligibleForPromotion(resolvedWithSha, { requireCommitSha: true })).toBe(true);
    });
  });

  describe("Regression Test Generation & Validation", () => {
    test("generates regression test for boundary_violation category", () => {
      const blunder = createSampleBlunder({
        id: "blunder-bv-1",
        category: "boundary_violation",
        type: "main_thread_direct_execution",
        remediation: "Dispatch Tier 3 Implementer",
      });

      const gen = generateBlunderRegressionTest(blunder);
      expect(gen.blunder_id).toBe("blunder-bv-1");
      expect(gen.category).toBe("boundary_violation");
      expect(gen.file_path_hint).toBe("tests/unit/mind/boundary-regression.test.ts");
      expect(gen.test_code).toContain("isBoundaryConcurred");

      const val = validateRegressionTest(
        `import { describe, expect, test } from "bun:test";\ndescribe("s", () => {\n${gen.test_code}\n});`,
      );
      expect(val.isValid).toBe(true);
    });

    test("generates regression test for model_reasoning_error category", () => {
      const blunder = createSampleBlunder({
        id: "blunder-mre-1",
        category: "model_reasoning_error",
        type: "hallucination_detected",
        remediation: "Verify ground truth in store",
      });

      const gen = generateBlunderRegressionTest(blunder);
      expect(gen.blunder_id).toBe("blunder-mre-1");
      expect(gen.category).toBe("model_reasoning_error");
      expect(gen.file_path_hint).toBe("tests/unit/mind/reasoning-regression.test.ts");
      expect(gen.test_code).toContain("adheresToInvariants");

      const val = validateRegressionTest(
        `import { describe, expect, test } from "bun:test";\ndescribe("s", () => {\n${gen.test_code}\n});`,
      );
      expect(val.isValid).toBe(true);
    });

    test("generates regression test for code_defect category", () => {
      const blunder = createSampleBlunder({
        id: "blunder-cd-1",
        category: "code_defect",
        type: "syntax_error",
        remediation: "Fix parse error in compiler",
      });

      const gen = generateBlunderRegressionTest(blunder);
      expect(gen.blunder_id).toBe("blunder-cd-1");
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
      expect(suite).toContain("Total blunders protected: 0");
      const val = validateRegressionTest(suite);
      expect(val.isValid).toBe(true);
    });
  });

  describe("End-to-End Blunder Promotion (promoteResolvedBlunders)", () => {
    test("promotes resolved blunders in-memory and separates open from eligible", () => {
      const b1 = createSampleBlunder({
        id: "b-open-1",
        status: "open",
      });
      const b2 = createSampleBlunder({
        id: "b-resolved-1",
        status: "resolved",
        resolution: {
          task_id: "task-1",
          test_assertion: "expect(true).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });
      const b3 = createSampleBlunder({
        id: "b-resolved-no-proof",
        status: "resolved",
        resolution: null,
      });

      const result = promoteResolvedBlunders([b1, b2, b3], {
        dryRun: true,
        generateRegressionTests: true,
      });

      expect(result.total_evaluated).toBe(3);
      expect(result.promoted_count).toBe(1);
      expect(result.unpromoted_count).toBe(2);
      expect(result.promoted_blunders.map((b) => b.id)).toEqual(["b-resolved-1"]);
      expect(result.remaining_blunders.map((b) => b.id)).toEqual([
        "b-open-1",
        "b-resolved-no-proof",
      ]);
      expect(result.generated_tests).toHaveLength(1);
      expect(result.generated_test_suite).toBeDefined();
    });

    test("promotes resolved blunders on filesystem: moves from source to target COMPLETED_BLUNDERS.jsonl", () => {
      const tempDir = createTempDir("blunder-promo-fs-");
      const sourcePath = join(tempDir, "blunders.jsonl");
      const targetPath = join(tempDir, "COMPLETED_BLUNDERS.jsonl");

      const openBlunder = createSampleBlunder({ id: "blunder-open" });
      const resolvedBlunder = createSampleBlunder({
        id: "blunder-resolved",
        status: "resolved",
        resolution: {
          task_id: "task-resolve-1",
          test_assertion: "expect(boundaryRestraintActive).toBeTrue()",
          resolved_at: new Date().toISOString(),
          commit_sha: "abcdef1234567890",
        },
      });

      writeFileSync(sourcePath, serializeBlunderLog([openBlunder, resolvedBlunder]), "utf8");

      const result = promoteResolvedBlunders({
        sourcePath,
        targetPath,
        updateSourceFile: true,
        generateRegressionTests: true,
      });

      expect(result.promoted_count).toBe(1);
      expect(result.unpromoted_count).toBe(1);

      // Verify target file has the resolved blunder
      const completedEntries = readCompletedBlundersLog(targetPath);
      expect(completedEntries).toHaveLength(1);
      expect(completedEntries[0]!.id).toBe("blunder-resolved");

      // Verify source file only has the open blunder remaining
      const remainingSourceContent = readFileSync(sourcePath, "utf8");
      const remainingSource = parseBlunderLog(remainingSourceContent);
      expect(remainingSource).toHaveLength(1);
      expect(remainingSource[0]!.id).toBe("blunder-open");
    });

    test("is idempotent when appending to existing completed blunders log", () => {
      const tempDir = createTempDir("blunder-promo-idempotent-");
      const sourcePath = join(tempDir, "blunders.jsonl");
      const targetPath = join(tempDir, "COMPLETED_BLUNDERS.jsonl");

      const resolved1 = createSampleBlunder({
        id: "b-res-1",
        status: "resolved",
        resolution: {
          task_id: "task-1",
          test_assertion: "expect(true).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });
      const resolved2 = createSampleBlunder({
        id: "b-res-2",
        status: "resolved",
        resolution: {
          task_id: "task-2",
          test_assertion: "expect(true).toBeTrue()",
          resolved_at: new Date().toISOString(),
        },
      });

      // First run: promote resolved1
      writeFileSync(sourcePath, serializeBlunderLog([resolved1]), "utf8");
      promoteResolvedBlunders({ sourcePath, targetPath });

      let completed = readCompletedBlundersLog(targetPath);
      expect(completed).toHaveLength(1);
      expect(completed[0]!.id).toBe("b-res-1");

      // Second run: promote resolved1 again and resolved2
      writeFileSync(sourcePath, serializeBlunderLog([resolved1, resolved2]), "utf8");
      promoteResolvedBlunders({ sourcePath, targetPath });

      completed = readCompletedBlundersLog(targetPath);
      expect(completed).toHaveLength(2);
      const ids = completed.map((c) => c.id);
      expect(ids).toContain("b-res-1");
      expect(ids).toContain("b-res-2");
    });
  });

  describe("Single Blunder Auto-Promotion (autoPromoteBlunder)", () => {
    test("automatically promotes a blunder by ID and writes resolution proof", () => {
      const tempDir = createTempDir("blunder-auto-promo-");
      const sourcePath = join(tempDir, "blunders.jsonl");
      const targetPath = join(tempDir, "COMPLETED_BLUNDERS.jsonl");

      const blunder = createSampleBlunder({ id: "blunder-to-auto-promote" });
      writeFileSync(sourcePath, serializeBlunderLog([blunder]), "utf8");

      const proof: BlunderResolutionProof = {
        task_id: "task-auto-fix",
        test_assertion: "expect(autoPromoted).toBeTrue()",
        resolved_at: new Date().toISOString(),
        commit_sha: "fedcba9876543210",
      };

      const result = autoPromoteBlunder({
        id: "blunder-to-auto-promote",
        proof,
        options: {
          sourcePath,
          targetPath,
        },
      });

      expect(result.promoted).toBe(true);
      expect(result.blunder.id).toBe("blunder-to-auto-promote");
      expect(result.blunder.status).toBe("resolved");
      expect(result.blunder.resolution?.task_id).toBe("task-auto-fix");

      const completed = readCompletedBlundersLog(targetPath);
      expect(completed).toHaveLength(1);
      expect(completed[0]!.id).toBe("blunder-to-auto-promote");
      expect(completed[0]!.status).toBe("resolved");

      // Source file should now be empty of this blunder
      const sourceRemaining = parseBlunderLog(readFileSync(sourcePath, "utf8"));
      expect(sourceRemaining).toHaveLength(0);
    });

    test("auto-promotes synthetic blunder when ID does not exist in active log", () => {
      const tempDir = createTempDir("blunder-auto-synth-");
      const sourcePath = join(tempDir, "blunders.jsonl");
      const targetPath = join(tempDir, "COMPLETED_BLUNDERS.jsonl");

      writeFileSync(
        sourcePath,
        serializeBlunderLog([createSampleBlunder({ id: "existing-id" })]),
        "utf8",
      );

      const proof: BlunderResolutionProof = {
        task_id: "task-synthetic",
        test_assertion: "expect(syntheticResolved).toBeTrue()",
        resolved_at: new Date().toISOString(),
      };

      const result = autoPromoteBlunder({
        id: "new-synthetic-id",
        proof,
        options: { sourcePath, targetPath },
      });

      expect(result.promoted).toBe(true);
      expect(result.blunder.id).toBe("new-synthetic-id");
      expect(result.blunder.status).toBe("resolved");

      const completed = readCompletedBlundersLog(targetPath);
      expect(completed).toHaveLength(1);
      expect(completed[0]!.id).toBe("new-synthetic-id");
    });

    test("throws HarnessError when trying to auto-promote with invalid proof", () => {
      const tempDir = createTempDir("blunder-auto-invalid-");
      const sourcePath = join(tempDir, "blunders.jsonl");
      const targetPath = join(tempDir, "COMPLETED_BLUNDERS.jsonl");

      const invalidProof = {
        task_id: "",
        test_assertion: "expect(true).toBeTrue()",
        resolved_at: new Date().toISOString(),
      } as unknown as BlunderResolutionProof;

      expect(() =>
        autoPromoteBlunder({
          id: "some-id",
          proof: invalidProof,
          options: { sourcePath, targetPath },
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("Completed Blunders Log Persistence Utilities", () => {
    test("handles reading from non-existent file gracefully returning empty array", () => {
      const missingPath = join(tmpdir(), `non-existent-${Date.now()}.jsonl`);
      expect(readCompletedBlundersLog(missingPath)).toEqual([]);
    });

    test("appendCompletedBlunderLogEntry appends a new completed blunder", () => {
      const tempDir = createTempDir("blunder-append-");
      const targetPath = join(tempDir, "COMPLETED_BLUNDERS.jsonl");

      const b1 = createSampleBlunder({ id: "b1", status: "resolved" });
      const b2 = createSampleBlunder({ id: "b2", status: "resolved" });

      appendCompletedBlunderLogEntry(b1, targetPath);
      appendCompletedBlunderLogEntry(b2, targetPath);

      const entries = readCompletedBlundersLog(targetPath);
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.id)).toEqual(["b1", "b2"]);
    });

    test("resolveCompletedBlundersPath resolves canonical and fallback locations", () => {
      const customPath = "/custom/path/COMPLETED_BLUNDERS.jsonl";
      expect(resolveCompletedBlundersPath(customPath)).toBe(customPath);

      const defaultResolved = resolveCompletedBlundersPath();
      expect(defaultResolved).toBeDefined();
      expect(defaultResolved.length).toBeGreaterThan(0);

      const canonicalPath = resolveCanonicalCompletedBlundersPath("/my/root");
      expect(canonicalPath).toContain("/my/root");
      expect(canonicalPath).toContain(".capsules/mind/queue/completed-blunders.jsonl");
    });
  });
});
