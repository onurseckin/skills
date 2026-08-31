/**
 * @file promotion-and-regression.test.ts
 * Unit tests for Defect Regression Suite Generation, Validation, and Auto-Promotion
 */

import { describe, expect, it } from "bun:test";
import {
  autoPromoteDefect,
  generateDefectRegressionTest,
  generateRegressionTestSuite,
  isDefectEligibleForPromotion,
  promoteResolvedDefects,
  validateRegressionTest,
  validateResolutionProof,
  type DefectEntry,
} from "../../../../olt/scripts/src/mind/defects/index.ts";
import { createMockDefectEntry, createMockResolutionProof } from "./defect-fixture.ts";

describe("Defect Promotion & Regression Suite", () => {
  describe("validateResolutionProof", () => {
    it("validates well-formed proof with valid non-empty fields", () => {
      const proof = createMockResolutionProof();
      const validated = validateResolutionProof(proof);
      expect(validated.task_id).toBe("task-001");
      expect(validated.test_assertion).toBe("expect(isResolved).toBe(true)");
    });

    it("rejects proof with missing task_id or invalid resolved_at", () => {
      expect(() => validateResolutionProof(createMockResolutionProof({ task_id: "" }))).toThrow();
      expect(() => validateResolutionProof(createMockResolutionProof({ resolved_at: "not-a-date" }))).toThrow();
    });
  });

  describe("isDefectEligibleForPromotion", () => {
    it("certifies resolved defects with valid proof as promotion-eligible", () => {
      const defect = createMockDefectEntry({
        status: "resolved",
        resolution: createMockResolutionProof(),
      });
      expect(isDefectEligibleForPromotion(defect)).toBe(true);
    });

    it("disqualifies open, in_progress, or unproven defects", () => {
      expect(isDefectEligibleForPromotion(createMockDefectEntry({ status: "open" }))).toBe(false);
      expect(isDefectEligibleForPromotion(createMockDefectEntry({ status: "resolved", resolution: undefined }))).toBe(false);
    });
  });

  describe("generateDefectRegressionTest & generateRegressionTestSuite", () => {
    it("generates runnable Bun test code for a single resolved defect", () => {
      const defect = createMockDefectEntry({
        id: "def-reg-1",
        category: "code_defect",
        type: "null_ref",
      });

      const generated = generateDefectRegressionTest(defect);
      expect(generated.defect_id).toBe("def-reg-1");
      expect(generated.test_name).toContain("regression [def-reg-1]");
      expect(generated.test_code).toContain("test(");
      expect(generated.test_code).toContain("expect(");
    });

    it("bundles multiple defect regression tests into an aggregated test suite", () => {
      const defects: DefectEntry[] = [
        createMockDefectEntry({ id: "def-10", category: "boundary_violation" }),
        createMockDefectEntry({ id: "def-20", category: "code_defect" }),
      ];

      const suite = generateRegressionTestSuite(defects);
      expect(suite).toContain('import { describe, expect, test } from "bun:test";');
      expect(suite).toContain("def-10");
      expect(suite).toContain("def-20");
    });
  });

  describe("validateRegressionTest", () => {
    it("validates generated regression test syntax contains essential assertion guards", () => {
      const defect = createMockDefectEntry({ id: "def-valid-test" });
      const generated = generateDefectRegressionTest(defect);

      const result = validateRegressionTest(generated.test_code);
      expect(result.isValid).toBe(true);
      expect(result.issues.length).toBe(0);
    });
  });

  describe("promoteResolvedDefects & autoPromoteDefect", () => {
    it("filters and promotes all eligible resolved defects from an in-memory backlog", () => {
      const backlog: DefectEntry[] = [
        createMockDefectEntry({ id: "d-prom-1", status: "resolved", resolution: createMockResolutionProof() }),
        createMockDefectEntry({ id: "d-prom-2", status: "open" }),
        createMockDefectEntry({ id: "d-prom-3", status: "resolved", resolution: createMockResolutionProof() }),
      ];

      const result = promoteResolvedDefects(backlog);
      expect(result.promoted_count).toBe(2);
      expect(result.skipped_count).toBe(1);
      expect(result.promoted_defects.map((d) => d.id)).toEqual(["d-prom-1", "d-prom-3"]);
    });

    it("autoPromoteDefect returns promotion metadata and verified regression test", () => {
      const defect = createMockDefectEntry({
        id: "d-auto-1",
        status: "resolved",
        resolution: createMockResolutionProof(),
      });

      const result = autoPromoteDefect(defect);
      expect(result.promoted_count).toBe(1);
      expect(result.promoted_defects[0]?.id).toBe("d-auto-1");
    });
  });
});
