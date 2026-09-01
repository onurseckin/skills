/**
 * @file promotion-and-regression.test.ts
 * Unit tests for Defect Regression Suite Generation, Validation, and Auto-Promotion
 */

import { describe, expect, it } from "bun:test";
import {
  generateDefectRegressionTest,
  generateRegressionTestSuite,
  isDefectEligibleForPromotion,
  promoteResolvedDefects,
  validateRegressionTest,
  validateResolutionProof,
  type DefectEntry,
} from "../../../olt/scripts/src/mind/defects/index.ts";
import { createMockDefectEntry, createMockResolutionProof } from "./defect-fixture.ts";

describe("Defect Promotion & Regression Suite", () => {
  describe("validateResolutionProof", () => {
    it("validates well-formed proof with valid non-empty fields", () => {
      const proof = createMockResolutionProof();
      expect(validateResolutionProof(proof)).toEqual(proof);
    });

    it("rejects proof with missing test assertion or empty task_id", () => {
      expect(() =>
        validateResolutionProof(createMockResolutionProof({ test_assertion: "" })),
      ).toThrow();
      expect(() => validateResolutionProof(createMockResolutionProof({ task_id: "" }))).toThrow();
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
      expect(
        isDefectEligibleForPromotion(
          createMockDefectEntry({ status: "resolved", resolution: undefined }),
        ),
      ).toBe(false);
    });
  });

  describe("generateDefectRegressionTest & generateRegressionTestSuite", () => {
    it("generates runnable Bun test code for a single resolved defect", () => {
      const defect = createMockDefectEntry({
        id: "def-reg-1",
        observation: "Fix state mutation leak in scheduler",
      });

      const result = generateDefectRegressionTest(defect);
      expect(result.test_code).toContain('test("regression [def-reg-1]');
      expect(result.test_code).toContain("expect(");
      expect(result.defect_id).toBe("def-reg-1");
    });

    it("bundles multiple defect regression tests into an aggregated test suite", () => {
      const defects: DefectEntry[] = [
        createMockDefectEntry({ id: "def-10", observation: "Bug 10" }),
        createMockDefectEntry({ id: "def-20", observation: "Bug 20" }),
      ];

      const suite = generateRegressionTestSuite(defects);
      expect(suite).toContain('import { describe, expect, test } from "bun:test";');
      expect(suite).toContain("def-10");
      expect(suite).toContain("def-20");
    });
  });

  describe("validateRegressionTest", () => {
    it("validates generated regression test syntax contains essential assertion guards", () => {
      const validCode = `
describe("Regression Suite", () => {
  test("test 1", () => {
    expect(true).toBe(true);
  });
});
`;
      const validation = validateRegressionTest(validCode);
      expect(validation.isValid).toBe(true);
      expect(validation.issues).toEqual([]);
    });

    it("detects invalid test code lacking describe/test or unbalanced braces", () => {
      const invalidCode = "const x = 1;";
      const validation = validateRegressionTest(invalidCode);
      expect(validation.isValid).toBe(false);
      expect(validation.issues.length).toBeGreaterThan(0);
    });
  });

  describe("promoteResolvedDefects", () => {
    it("filters and promotes all eligible resolved defects from an in-memory backlog", () => {
      const backlog: DefectEntry[] = [
        createMockDefectEntry({
          id: "d-prom-1",
          status: "resolved",
          resolution: createMockResolutionProof(),
        }),
        createMockDefectEntry({ id: "d-prom-2", status: "open" }),
        createMockDefectEntry({
          id: "d-prom-3",
          status: "resolved",
          resolution: createMockResolutionProof(),
        }),
      ];

      const result = promoteResolvedDefects(backlog, { dryRun: true });
      expect(result.promoted_count).toBe(2);
      expect(result.unpromoted_count).toBe(1);
      expect(result.promoted_defects.map((d) => d.id)).toEqual(["d-prom-1", "d-prom-3"]);
    });
  });
});
