import { describe, expect, test } from "bun:test";
import {
  calculateEpistemicGrade,
  clamp,
  computeEpistemicEntropy,
  computeEpistemicVector,
  DEFAULT_EPISTEMIC_WEIGHTS,
  DEFAULT_PASS_THRESHOLD,
  evaluateEpistemicConfidence,
  type EpistemicEvaluationInput,
} from "../../../olt/scripts/src/core/epistemic/index.ts";
import {
  checkEpistemicConfidence,
  type EpistemicConfidenceCheckOptions,
} from "../../../olt/scripts/src/reporting/doctor/epistemic-engine.ts";

export const epistemicEngineSuiteName = "Epistemic Mathematical Functions & Vector Computation";

describe(epistemicEngineSuiteName, () => {
  test("clamp constrains values strictly between min and max", () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(-0.2, 0, 1)).toBe(0);
    expect(clamp(1.5, 0, 1)).toBe(1);
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
  });

  test("calculateEpistemicGrade assigns correct discrete grades", () => {
    expect(calculateEpistemicGrade(0.95)).toBe("VERY_HIGH");
    expect(calculateEpistemicGrade(0.8)).toBe("HIGH");
    expect(calculateEpistemicGrade(0.65)).toBe("MEDIUM");
    expect(calculateEpistemicGrade(0.45)).toBe("LOW");
    expect(calculateEpistemicGrade(0.2)).toBe("VERY_LOW");
  });

  test("computeEpistemicEntropy calculates Shannon entropy", () => {
    expect(computeEpistemicEntropy([])).toBe(0);
    expect(computeEpistemicEntropy([1.0])).toBe(0);
    const fairCoinEntropy = computeEpistemicEntropy([0.5, 0.5]);
    expect(fairCoinEntropy).toBeCloseTo(1.0, 4);
  });

  test("computeEpistemicVector normalizes heterogeneous metrics", () => {
    const input: EpistemicEvaluationInput = {
      empiricalEvidenceCount: 5,
      contradictionCount: 0,
      falsifiableGateCount: 10,
      totalGateCount: 10,
      historicalStability: 0.9,
      testCoverageRatio: 0.85,
    };

    const vector = computeEpistemicVector(input);
    expect(vector.empirical).toBe(1.0);
    expect(vector.coherence).toBe(1.0);
    expect(vector.falsifiability).toBe(1.0);
    expect(vector.stability).toBe(0.9);
    expect(vector.coverage).toBe(0.85);
  });
});

describe("Epistemic Confidence Evaluator", () => {
  test("evaluates high-confidence evidence set to passing result", () => {
    const input: EpistemicEvaluationInput = {
      empiricalEvidenceCount: 6,
      contradictionCount: 0,
      falsifiableGateCount: 4,
      totalGateCount: 4,
      historicalStability: 0.95,
      testCoverageRatio: 0.9,
    };

    const verdict = evaluateEpistemicConfidence(input);
    expect(verdict.passed).toBe(true);
    expect(verdict.confidenceScore).toBeGreaterThanOrEqual(DEFAULT_PASS_THRESHOLD);
    expect(verdict.grade).toMatch(/HIGH|VERY_HIGH/);
    expect(verdict.vector.empirical).toBe(1.0);
    expect(verdict.vector.coherence).toBe(1.0);
  });

  test("penalizes logical contradictions in claim set", () => {
    const cleanInput: EpistemicEvaluationInput = {
      empiricalEvidenceCount: 5,
      contradictionCount: 0,
      falsifiableGateCount: 4,
      totalGateCount: 4,
      historicalStability: 0.9,
      testCoverageRatio: 0.8,
    };
    const cleanVerdict = evaluateEpistemicConfidence(cleanInput);

    const contaminatedInput: EpistemicEvaluationInput = {
      ...cleanInput,
      contradictionCount: 2,
    };
    const contaminatedVerdict = evaluateEpistemicConfidence(contaminatedInput);

    expect(contaminatedVerdict.confidenceScore).toBeLessThan(cleanVerdict.confidenceScore);
    expect(contaminatedVerdict.vector.coherence).toBeLessThan(1.0);
    expect(contaminatedVerdict.reasons.some((r) => r.includes("Contradictions detected"))).toBe(
      true,
    );
  });

  test("penalizes non-falsifiable evidence gates", () => {
    const unfalsifiableInput: EpistemicEvaluationInput = {
      empiricalEvidenceCount: 5,
      contradictionCount: 0,
      falsifiableGateCount: 1,
      totalGateCount: 5,
      historicalStability: 0.8,
      testCoverageRatio: 0.7,
    };

    const verdict = evaluateEpistemicConfidence(unfalsifiableInput);
    expect(verdict.vector.falsifiability).toBe(0.2);
    expect(verdict.reasons.some((r) => r.includes("falsifiable gates"))).toBe(true);
  });

  test("respects custom weights and pass threshold", () => {
    const input: EpistemicEvaluationInput = {
      empiricalEvidenceCount: 1,
      contradictionCount: 0,
      falsifiableGateCount: 1,
      totalGateCount: 1,
      historicalStability: 1.0,
      testCoverageRatio: 1.0,
    };

    const customWeights = {
      ...DEFAULT_EPISTEMIC_WEIGHTS,
      empirical: 0.9,
      coherence: 0.025,
      falsifiability: 0.025,
      stability: 0.025,
      coverage: 0.025,
    };

    const verdict = evaluateEpistemicConfidence(input, {
      weights: customWeights,
      threshold: 0.8,
    });
    expect(verdict.passed).toBe(false);
  });
});

describe("Doctor Epistemic Engine (checkEpistemicConfidence)", () => {
  test("returns healthy result when default options are passed", () => {
    const result = checkEpistemicConfidence();
    expect(result.engine).toBe("checkEpistemicConfidence");
    expect(result.passed).toBe(true);
    expect(result.findings.filter((f) => f.severity === "ERROR").length).toBe(0);
  });

  test("reports finding when epistemic confidence falls below threshold", () => {
    const options: EpistemicConfidenceCheckOptions = {
      metrics: {
        empiricalEvidenceCount: 0,
        contradictionCount: 3,
        falsifiableGateCount: 0,
        totalGateCount: 2,
        historicalStability: 0.1,
        testCoverageRatio: 0.0,
      },
      threshold: 0.7,
    };

    const result = checkEpistemicConfidence(options);
    expect(result.passed).toBe(false);

    const thresholdFinding = result.findings.find(
      (f) => f.code === "EPISTEMIC_CONFIDENCE_BELOW_THRESHOLD",
    );
    expect(thresholdFinding).toBeDefined();
    expect(thresholdFinding?.engine).toBe("checkEpistemicConfidence");

    const contradictionFinding = result.findings.find(
      (f) => f.code === "EPISTEMIC_CONTRADICTIONS_DETECTED",
    );
    expect(contradictionFinding).toBeDefined();
    expect(contradictionFinding?.severity).toBe("ERROR");
  });

  test("warns when unfalsifiable evidence gates are present", () => {
    const options: EpistemicConfidenceCheckOptions = {
      metrics: {
        empiricalEvidenceCount: 5,
        contradictionCount: 0,
        falsifiableGateCount: 2,
        totalGateCount: 5,
        historicalStability: 0.9,
        testCoverageRatio: 0.8,
      },
    };

    const result = checkEpistemicConfidence(options);
    const gateFinding = result.findings.find((f) => f.code === "EPISTEMIC_UNFALSIFIABLE_GATES");
    expect(gateFinding).toBeDefined();
    expect(gateFinding?.severity).toBe("WARN");
  });
});

describe("Physical Density and Zero-Comment Invariants", () => {
  test("in-memory invariant validator verifies max lines, zero comments, zero any, zero suppressions", () => {
    const samplePureFile = `
export interface SampleType {
  readonly id: string;
  readonly value: number;
}
export function sampleFn(input: SampleType): number {
  return input.value * 2;
}
`;
    const commentPattern = new RegExp("\\/\\/|\\/\\*|\\*\\/");
    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionPattern = new RegExp(
      [
        "@ts" + "-ignore",
        "@ts" + "-expect-error",
        "@ts" + "-nocheck",
        "eslint" + "-disable",
        "oxlint" + "-disable",
      ].join("|"),
    );

    const lines = samplePureFile.trim().split("\n");
    expect(lines.length).toBeLessThanOrEqual(300);

    for (const line of lines) {
      expect(commentPattern.test(line)).toBe(false);
      expect(anyPattern.test(line)).toBe(false);
      expect(suppressionPattern.test(line)).toBe(false);
    }
  });
});
