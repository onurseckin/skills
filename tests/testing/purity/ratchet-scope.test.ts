import { describe, expect, it } from "bun:test";
import {
  allowanceAppliesTo,
  auditTestPuritySync,
  buildAuditResult,
  readPurityAllowance,
  type PurityViolation,
} from "../../../scripts/testing/guardrails/index.ts";

describe("Purity Ratchet Scope - Repository Baseline Honor", () => {
  it("honors repository scope in allowanceAppliesTo unless strict is enabled", () => {
    expect(allowanceAppliesTo("repository", false)).toBe(true);
    expect(allowanceAppliesTo("repository", true)).toBe(false);
    expect(allowanceAppliesTo("staged", false)).toBe(true);
    expect(allowanceAppliesTo("staged", true)).toBe(false);
    expect(allowanceAppliesTo("explicit", false)).toBe(true);
    expect(allowanceAppliesTo("explicit", true)).toBe(false);
  });

  it("passes end-to-end repository audit at HEAD with on-disk baseline", () => {
    const result = auditTestPuritySync({ all: true });
    expect(result.scope).toBe("repository");
    expect(result.passed).toBe(true);
    expect(result.blockingViolations).toHaveLength(0);
    expect(result.toleratedViolations.length).toBeGreaterThan(0);
  });

  it("fails when adding a synthetic violation beyond baselined count", () => {
    const baseline = readPurityAllowance();
    const result = auditTestPuritySync({ all: true });
    const syntheticViolation: PurityViolation = {
      file: "tests/synthetic-unbaselined.test.ts",
      line: 10,
      column: 5,
      category: "filesystem",
      rule: "no-physical-fs-call",
      message: "Prohibited synthetic fs call",
    };
    const exceeded = buildAuditResult(
      result.scannedFiles,
      [...result.violations, syntheticViolation],
      "repository",
      result.requestedFiles,
      baseline,
    );
    expect(exceeded.passed).toBe(false);
    expect(exceeded.blockingViolations.length).toBeGreaterThanOrEqual(1);
    expect(
      exceeded.exceedances.some(
        (e) => e.file === "tests/synthetic-unbaselined.test.ts" && e.rule === "no-physical-fs-call",
      ),
    ).toBe(true);
  });

  it("ignores baseline allowance when strict mode is requested", () => {
    const strictResult = auditTestPuritySync({ all: true, strict: true });
    expect(strictResult.passed).toBe(false);
    expect(strictResult.blockingViolations.length).toBe(strictResult.violations.length);
    expect(strictResult.toleratedViolations).toHaveLength(0);
  });
});
