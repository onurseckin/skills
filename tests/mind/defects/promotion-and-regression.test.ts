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
} from "../../../olt/scripts/src/mind/defects/index.ts";
import { createMockDefectEntry, createMockResolutionProof } from "./defect-fixture.ts";

describe("Defect Promotion & Regression Suite", () => {
  describe("validateResolutionProof", () => {
    it("validates well-formed proof with valid non-empty fields", () => {
      const proof = createMockResolutionProof();
      expect(validateResolutionProof(proof)).toBe(true);
    });

    it("rejects proof with missing testPath or invalid verificationHash", () => {
      expect(validateResolutionProof(createMockResolutionProof({ testPath: "" }))).toBe(false);
      expect(validateResolutionProof(createMockResolutionProof({ verificationHash: "" }))).toBe(
        false,
      );
      expect(validateResolutionProof(createMockResolutionProof({ executionDurationMs: -1 }))).toBe(
        false,
      );
    });
  });

  describe("isDefectEligibleForPromotion", () => {
    it("certifies resolved defects with valid proof as promotion-eligible", () => {
      const defect = createMockDefectEntry({
        status: "resolved",
        proof: createMockResolutionProof(),
      });
      expect(isDefectEligibleForPromotion(defect)).toBe(true);
    });

    it("disqualifies open, in_progress, or unproven defects", () => {
      expect(isDefectEligibleForPromotion(createMockDefectEntry({ status: "open" }))).toBe(false);
      expect(
        isDefectEligibleForPromotion(
          createMockDefectEntry({ status: "resolved", proof: undefined }),
        ),
      ).toBe(false);
    });
  });

  describe("generateDefectRegressionTest & generateRegressionTestSuite", () => {
    it("generates runnable Bun test code for a single resolved defect", () => {
      const defect = createMockDefectEntry({
        id: "def-reg-1",
        title: "Fix state mutation leak in scheduler",
      });

      const testCode = generateDefectRegressionTest(defect);
      expect(testCode).toContain('describe("Regression: def-reg-1"');
      expect(testCode).toContain(
        'it("prevents recurrence of: Fix state mutation leak in scheduler"',
      );
      expect(testCode).toContain("expect(");
    });

    it("bundles multiple defect regression tests into an aggregated test suite", () => {
      const defects: DefectEntry[] = [
        createMockDefectEntry({ id: "def-10", title: "Bug 10" }),
        createMockDefectEntry({ id: "def-20", title: "Bug 20" }),
      ];

      const suite = generateRegressionTestSuite(defects);
      expect(suite).toContain('import { describe, expect, it } from "bun:test";');
      expect(suite).toContain("def-10");
      expect(suite).toContain("def-20");
    });
  });

  describe("validateRegressionTest", () => {
    it("validates generated regression test syntax contains essential assertion guards", () => {
      const defect = createMockDefectEntry({ id: "def-valid-test" });
      const testCode = generateDefectRegressionTest(defect);

      const isValid = validateRegressionTest(testCode);
      expect(isValid).toBe(true);
    });
  });

  describe("promoteResolvedDefects & autoPromoteDefect", () => {
    it("filters and promotes all eligible resolved defects from an in-memory backlog", () => {
      const backlog: DefectEntry[] = [
        createMockDefectEntry({
          id: "d-prom-1",
          status: "resolved",
          proof: createMockResolutionProof(),
        }),
        createMockDefectEntry({ id: "d-prom-2", status: "open" }),
        createMockDefectEntry({
          id: "d-prom-3",
          status: "resolved",
          proof: createMockResolutionProof(),
        }),
      ];

      const promoted = promoteResolvedDefects(backlog);
      expect(promoted.length).toBe(2);
      expect(promoted.map((d) => d.id)).toEqual(["d-prom-1", "d-prom-3"]);
    });

    it("autoPromoteDefect returns promotion metadata and verified regression test", () => {
      const defect = createMockDefectEntry({
        id: "d-auto-1",
        status: "resolved",
        proof: createMockResolutionProof(),
      });

      const result = autoPromoteDefect(defect);
      expect(result.promoted).toBe(true);
      expect(result.regressionTestCode).toBeDefined();
      expect(result.regressionTestCode).toContain("d-auto-1");
    });
  });
});
