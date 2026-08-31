import { describe, expect, test } from "bun:test";
import {
  calculateEpistemicGrade,
  clamp,
  computeEpistemicEntropy,
  computeWeightedEpistemicScore,
  evaluateEpistemicConfidence,
  DEFAULT_EPISTEMIC_WEIGHTS,
  DEFAULT_PASS_THRESHOLD,
  type EpistemicEvaluationInput,
} from "../../../olt/scripts/src/core/epistemic/index.ts";
import {
  evaluatePlanEpistemicReadiness,
  detectScopeOverlapWarnings,
  type PlanEvaluationDocument,
} from "../../../olt/scripts/src/mind/planning/engine/index.ts";

describe("Epistemic Mathematics and Confidence Engine", () => {
  test("clamp normalizes values strictly within lower and upper bounds", () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(-0.2, 0, 1)).toBe(0);
    expect(clamp(1.8, 0, 1)).toBe(1);
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
  });

  test("calculateEpistemicGrade maps scores to categorical thresholds", () => {
    expect(calculateEpistemicGrade(0.95)).toBe("VERY_HIGH");
    expect(calculateEpistemicGrade(0.8)).toBe("HIGH");
    expect(calculateEpistemicGrade(0.65)).toBe("MEDIUM");
    expect(calculateEpistemicGrade(0.45)).toBe("LOW");
    expect(calculateEpistemicGrade(0.2)).toBe("VERY_LOW");
  });

  test("computeWeightedEpistemicScore applies standard weights correctly", () => {
    const vector = {
      empirical: 1.0,
      coherence: 1.0,
      falsifiability: 1.0,
      stability: 1.0,
      coverage: 1.0,
    };
    const score = computeWeightedEpistemicScore(vector, DEFAULT_EPISTEMIC_WEIGHTS);
    expect(score).toBe(1.0);
  });

  test("computeEpistemicEntropy measures probability distribution uncertainty", () => {
    expect(computeEpistemicEntropy([])).toBe(0);
    expect(computeEpistemicEntropy([1.0])).toBe(0);
    const uniformEntropy = computeEpistemicEntropy([0.5, 0.5]);
    expect(uniformEntropy).toBeCloseTo(1.0, 5);
  });

  test("evaluateEpistemicConfidence passes when all dimensions are healthy", () => {
    const input: EpistemicEvaluationInput = {
      empiricalEvidenceCount: 5,
      contradictionCount: 0,
      falsifiableGateCount: 4,
      totalGateCount: 4,
      historicalStability: 0.95,
      testCoverageRatio: 0.9,
    };

    const result = evaluateEpistemicConfidence(input, DEFAULT_PASS_THRESHOLD);
    expect(result.passed).toBe(true);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(DEFAULT_PASS_THRESHOLD);
    expect(result.grade).toBe("VERY_HIGH");
  });

  test("evaluateEpistemicConfidence fails when logical contradictions are present", () => {
    const input: EpistemicEvaluationInput = {
      empiricalEvidenceCount: 5,
      contradictionCount: 2,
      falsifiableGateCount: 4,
      totalGateCount: 4,
      historicalStability: 0.95,
    };

    const result = evaluateEpistemicConfidence(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes("contradiction"))).toBe(true);
  });

  test("evaluateEpistemicConfidence flags insufficient falsifiable gates", () => {
    const input: EpistemicEvaluationInput = {
      empiricalEvidenceCount: 5,
      contradictionCount: 0,
      falsifiableGateCount: 1,
      totalGateCount: 5,
      historicalStability: 0.9,
    };

    const result = evaluateEpistemicConfidence(input);
    expect(result.vector.falsifiability).toBe(0.2);
    expect(result.reasons.some((r) => r.includes("falsifiable gates"))).toBe(true);
  });
});

describe("Mind Plan Evaluator Integration", () => {
  test("detectScopeOverlapWarnings detects colliding write scopes across tasks", () => {
    const tasks = [
      { id: "task-1", title: "Task 1", write_scope: ["src/core/auth.ts", "src/core/user.ts"] },
      { id: "task-2", title: "Task 2", write_scope: ["src/core/user.ts", "src/core/session.ts"] },
      { id: "task-3", title: "Task 3", write_scope: ["src/api/routes.ts"] },
    ];

    const warnings = detectScopeOverlapWarnings(tasks);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("src/core/user.ts");
    expect(warnings[0]).toContain("task-1, task-2");
  });

  test("evaluatePlanEpistemicReadiness marks robust plan as READY", () => {
    const planDoc: PlanEvaluationDocument = {
      planId: "plan-feat-01",
      prompt: "Implement secure auth token refreshing",
      sources: ["src/core/auth.ts", "src/api/login.ts", "src/db/tokens.ts"],
      observations: ["Uses JWT with 15-minute expiry", "Requires atomic refresh mutex"],
      risks: ["Race condition on multiple tab refresh"],
      tasks: [
        {
          id: "task-1",
          title: "Implement refresh mutex",
          write_scope: ["src/core/auth.ts"],
          gate: "bun test tests/auth/refresh.test.ts",
        },
        {
          id: "task-2",
          title: "Update token route handler",
          write_scope: ["src/api/login.ts"],
          gate: "bun test tests/api/login.test.ts",
        },
      ],
      historicalStability: 0.95,
      testCoverageRatio: 0.92,
    };

    const evaluation = evaluatePlanEpistemicReadiness(planDoc);
    expect(evaluation.readinessVerdict).toBe("READY");
    expect(evaluation.totalTasks).toBe(2);
    expect(evaluation.falsifiableTaskCount).toBe(2);
    expect(evaluation.scopeOverlapWarnings.length).toBe(0);
    expect(evaluation.epistemic.passed).toBe(true);
  });

  test("evaluatePlanEpistemicReadiness demotes plan to REVISE when scope collision occurs", () => {
    const planDoc: PlanEvaluationDocument = {
      planId: "plan-feat-collision",
      sources: ["src/a.ts", "src/b.ts", "src/c.ts"],
      observations: ["Obs 1", "Obs 2"],
      tasks: [
        {
          id: "task-1",
          title: "Task 1",
          write_scope: ["src/shared.ts"],
          gate: "bun test tests/a.test.ts",
        },
        {
          id: "task-2",
          title: "Task 2",
          write_scope: ["src/shared.ts"],
          gate: "bun test tests/b.test.ts",
        },
      ],
      historicalStability: 0.9,
    };

    const evaluation = evaluatePlanEpistemicReadiness(planDoc);
    expect(evaluation.readinessVerdict).toBe("REVISE");
    expect(evaluation.scopeOverlapWarnings.length).toBe(1);
  });

  test("evaluatePlanEpistemicReadiness marks plan as BLOCKED when critical contradictions exist", () => {
    const planDoc: PlanEvaluationDocument = {
      planId: "plan-feat-contradiction",
      sources: [],
      observations: [],
      risks: [
        "Major architecture contradiction with existing database schema",
        "Direct logical conflict in requirements",
      ],
      tasks: [
        {
          id: "task-1",
          title: "Task 1",
          gate: "echo mock",
        },
      ],
      historicalStability: 0.2,
    };

    const evaluation = evaluatePlanEpistemicReadiness(planDoc);
    expect(evaluation.readinessVerdict).toBe("BLOCKED");
    expect(evaluation.epistemic.passed).toBe(false);
    expect(evaluation.falsifiableTaskCount).toBe(0);
  });
});
