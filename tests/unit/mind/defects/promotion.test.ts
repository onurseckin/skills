import { describe, expect, test } from "bun:test";
import {
  isDefectEligibleForPromotion,
  promoteResolvedDefects,
  validateResolutionProof,
  verifyResolutionProofEmpirical,
  type DefectEntry,
  type DefectResolutionProof,
} from "../../../../olt/scripts/src/mind/defects/index.ts";

function createMockProof(overrides?: Partial<DefectResolutionProof>): DefectResolutionProof {
  return {
    task_id: "task-defects-remediation-w1",
    test_assertion: "bun test tests/unit/mind/defects/promotion.test.ts",
    resolved_at: "2026-09-10T01:30:00.000Z",
    commit_sha: "cec97e9ba939dcccad5975540b399ecf01dfafdc",
    remediation_notes: "Empirical contract verification and defect ledger synchronization",
    verified_by: "tier3-implementer",
    ...overrides,
  };
}

function createMockDefect(overrides?: Partial<DefectEntry>): DefectEntry {
  return {
    id: `defect-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: "cli_error",
    category: "cli_error",
    status: "open",
    severity: "warning",
    observation: "CLI command contract failure",
    message: "CLI command contract failure",
    timestamp: "2026-09-10T01:00:00.000Z",
    ...overrides,
  };
}

describe("Unit: Mind Defect Promotion Suite", () => {
  describe("validateResolutionProof", () => {
    test("validates well-formed proof with valid non-empty fields", () => {
      const proof = createMockProof();
      const validated = validateResolutionProof(proof);
      expect(validated.task_id).toBe(proof.task_id);
      expect(validated.test_assertion).toBe(proof.test_assertion);
      expect(validated.resolved_at).toBe(proof.resolved_at);
      expect(validated.commit_sha).toBe(proof.commit_sha);
      expect(validated.remediation_notes).toBe(proof.remediation_notes);
      expect(validated.verified_by).toBe(proof.verified_by);
    });

    test("rejects proof with missing test assertion or empty task_id", () => {
      expect(() => validateResolutionProof(createMockProof({ test_assertion: "" }))).toThrow();
      expect(() => validateResolutionProof(createMockProof({ task_id: "" }))).toThrow();
      expect(() =>
        validateResolutionProof(createMockProof({ resolved_at: "not-a-date" })),
      ).toThrow();
    });

    test("enforces commit_sha requirement when requireCommitSha is true", () => {
      expect(() =>
        validateResolutionProof(createMockProof({ commit_sha: undefined }), {
          requireCommitSha: true,
        }),
      ).toThrow();
      expect(() =>
        validateResolutionProof(createMockProof({ commit_sha: "short" }), {
          requireCommitSha: true,
        }),
      ).toThrow();
      const valid = validateResolutionProof(createMockProof(), { requireCommitSha: true });
      expect(valid.commit_sha).toBeDefined();
    });
  });

  describe("verifyResolutionProofEmpirical", () => {
    test("confirms empirical validity of substantive resolution proof", () => {
      const proof = createMockProof();
      const result = verifyResolutionProofEmpirical(proof);
      expect(result.isValid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    test("disqualifies assertion that is too brief to be empirical", () => {
      const briefProof: DefectResolutionProof = {
        task_id: "task-01",
        test_assertion: "ok",
        resolved_at: "2026-09-10T01:00:00.000Z",
      };
      const result = verifyResolutionProofEmpirical(briefProof);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("too brief");
    });
  });

  describe("isDefectEligibleForPromotion", () => {
    test("certifies resolved defects with valid proof as promotion-eligible", () => {
      const defect = createMockDefect({
        status: "resolved",
        resolution: createMockProof(),
      });
      expect(isDefectEligibleForPromotion(defect)).toBe(true);
    });

    test("disqualifies open, in_progress, or unproven defects", () => {
      expect(isDefectEligibleForPromotion(createMockDefect({ status: "open" }))).toBe(false);
      expect(
        isDefectEligibleForPromotion(
          createMockDefect({ status: "resolved", resolution: undefined }),
        ),
      ).toBe(false);
    });
  });

  describe("promoteResolvedDefects", () => {
    test("filters and promotes all eligible resolved defects from an in-memory backlog", () => {
      const backlog: DefectEntry[] = [
        createMockDefect({
          id: "def-prom-1",
          status: "resolved",
          resolution: createMockProof(),
        }),
        createMockDefect({ id: "def-prom-2", status: "open" }),
        createMockDefect({
          id: "def-prom-3",
          status: "resolved",
          resolution: createMockProof(),
        }),
      ];

      const result = promoteResolvedDefects(backlog, { dryRun: true });
      expect(result.promoted_count).toBe(2);
      expect(result.unpromoted_count).toBe(1);
      expect(result.promoted_defects.map((d) => d.id)).toEqual(["def-prom-1", "def-prom-3"]);
      expect(result.remaining_defects.map((d) => d.id)).toEqual(["def-prom-2"]);
    });

    test("promotes 100% of defects when all are resolved with valid proofs", () => {
      const backlog: DefectEntry[] = [
        createMockDefect({
          id: "def-all-1",
          status: "resolved",
          resolution: createMockProof(),
        }),
        createMockDefect({
          id: "def-all-2",
          status: "resolved",
          resolution: createMockProof(),
        }),
      ];

      const result = promoteResolvedDefects(backlog, { dryRun: true });
      expect(result.promoted_count).toBe(2);
      expect(result.unpromoted_count).toBe(0);
      expect(result.remaining_defects.length).toBe(0);
    });
  });
});
