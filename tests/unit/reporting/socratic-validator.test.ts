import { describe, expect, test } from "bun:test";
import {
  evaluateSocraticSelfQuestioning,
  formatSocraticAuditSection,
  SOCRATIC_DIMENSIONS,
} from "../../../orchestrating-long-tasks/scripts/src/reporting/socratic-validator.ts";
import type { JsonObject } from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";

describe("Socratic Reflexive Self-Questioning Engine", () => {
  test("defines all 5 Socratic dimensions", () => {
    expect(SOCRATIC_DIMENSIONS).toHaveLength(5);
    const keys = SOCRATIC_DIMENSIONS.map((d) => d.key);
    expect(keys).toContain("premise_verification");
    expect(keys).toContain("edge_case_exploration");
    expect(keys).toContain("failure_mode_analysis");
    expect(keys).toContain("hierarchy_invariant_preservation");
    expect(keys).toContain("quantitative_empirical_proof");
  });

  test("evaluates clean/compliant state as healthy across all 5 dimensions", () => {
    const state: JsonObject = {
      tasks: {
        "task-1": {
          id: "task-1",
          status: "satisfied",
          falsifiable: true,
          validations: [
            {
              validator_id: "val-1",
              verdict: "pass",
              checks: ["cmd-1", "cmd-2"],
            },
          ],
        },
      },
      commands: {
        "cmd-1": {
          id: "cmd-1",
          actor: "val-1",
          status: "succeeded",
          exit_code: 0,
          wall_time_ms: 120,
          argv: ["bun", "test", "tests/unit/test-1.test.ts"],
        },
      },
      baseline: {
        drift: false,
      },
    };

    const report = evaluateSocraticSelfQuestioning("/mock/run", state);
    expect(report.healthy).toBe(true);
    expect(report.questions_evaluated).toBe(10);
    expect(report.questions_passed).toBe(10);
    expect(report.questions_failed).toBe(0);
    expect(report.issues).toHaveLength(0);
    expect(report.summary).toContain("10/10 criteria satisfied");

    // All dimensions must report positive counts
    expect(report.dimensions.premise_verification.passed).toBeGreaterThan(0);
    expect(report.dimensions.edge_case_exploration.passed).toBeGreaterThan(0);
    expect(report.dimensions.failure_mode_analysis.passed).toBeGreaterThan(0);
    expect(report.dimensions.hierarchy_invariant_preservation.passed).toBeGreaterThan(0);
    expect(report.dimensions.quantitative_empirical_proof.passed).toBeGreaterThan(0);
  });

  test("flags premise verification defect when passing validation lacks checks", () => {
    const state: JsonObject = {
      tasks: {
        "task-unverified": {
          id: "task-unverified",
          validations: [
            {
              validator_id: "val-lazy",
              verdict: "pass",
              checks: [], // Empty checks!
            },
          ],
        },
      },
    };

    const report = evaluateSocraticSelfQuestioning("/mock/run", state);
    expect(report.healthy).toBe(false);
    expect(report.questions_failed).toBeGreaterThan(0);

    const premiseQuestion = report.questions.find(
      (q) => q.id === "SOC-PREM-01-ARTIFACT-GROUNDING",
    );
    expect(premiseQuestion).toBeDefined();
    expect(premiseQuestion?.passed).toBe(false);
    expect(premiseQuestion?.verdict).toBe("DEFECT_FLAGGED");
    expect(premiseQuestion?.remediation).toBeDefined();
    expect(report.issues.some((i) => i.includes("SOC-PREM-01-ARTIFACT-GROUNDING"))).toBe(true);
  });

  test("flags failure mode analysis defect when task gate is marked non-falsifiable", () => {
    const state: JsonObject = {
      tasks: {
        "task-unfalsifiable": {
          id: "task-unfalsifiable",
          falsifiable: false,
        },
      },
    };

    const report = evaluateSocraticSelfQuestioning("/mock/run", state);
    expect(report.healthy).toBe(false);

    const failQuestion = report.questions.find(
      (q) => q.id === "SOC-FAIL-01-COUNTERFACTUAL-FALSIFIABILITY",
    );
    expect(failQuestion).toBeDefined();
    expect(failQuestion?.passed).toBe(false);
    expect(failQuestion?.verdict).toBe("DEFECT_FLAGGED");
  });

  test("flags hierarchy preservation defect when implementer attempts validation review command", () => {
    const state: JsonObject = {
      commands: {
        "cmd-rogue": {
          id: "cmd-rogue",
          actor: "implementer-1",
          argv: ["bun", "harness.ts", "task:validate-start", "--task", "task-1"],
        },
      },
    };

    const report = evaluateSocraticSelfQuestioning("/mock/run", state);
    expect(report.healthy).toBe(false);

    const hierQuestion = report.questions.find(
      (q) => q.id === "SOC-HIER-01-TIER-ROLE-SEGREGATION",
    );
    expect(hierQuestion).toBeDefined();
    expect(hierQuestion?.passed).toBe(false);
    expect(hierQuestion?.verdict).toBe("DEFECT_FLAGGED");
  });

  test("flags quantitative proof defect when command records unexpected nonzero exit code", () => {
    const state: JsonObject = {
      commands: {
        "cmd-fail": {
          id: "cmd-fail",
          actor: "val-1",
          status: "succeeded", // Succeeded status with nonzero exit code is a defect
          exit_code: 1,
        },
      },
    };

    const report = evaluateSocraticSelfQuestioning("/mock/run", state);
    expect(report.healthy).toBe(false);

    const empQuestion = report.questions.find(
      (q) => q.id === "SOC-EMP-01-MEASURED-EXECUTION-METRICS",
    );
    expect(empQuestion).toBeDefined();
    expect(empQuestion?.passed).toBe(false);
    expect(empQuestion?.verdict).toBe("DEFECT_FLAGGED");
  });

  test("handles empty and null state safely without throwing", () => {
    const reportNull = evaluateSocraticSelfQuestioning("/mock/run", null);
    expect(reportNull.healthy).toBe(true);
    expect(reportNull.questions_evaluated).toBe(10);

    const reportEmpty = evaluateSocraticSelfQuestioning("/mock/run", {});
    expect(reportEmpty.healthy).toBe(true);
  });

  test("formatSocraticAuditSection formats clean and defect reports", () => {
    const cleanReport = evaluateSocraticSelfQuestioning("/mock/run", {});
    const cleanMarkdown = formatSocraticAuditSection(cleanReport);
    expect(cleanMarkdown).toContain("### Socratic Reflexive Self-Questioning Engine");
    expect(cleanMarkdown).toContain("- **Status**: verified");
    expect(cleanMarkdown).toContain("1. Premise Verification");
    expect(cleanMarkdown).toContain("5. Quantitative Empirical Proof");

    const defectReport = evaluateSocraticSelfQuestioning("/mock/run", {
      baseline: { drift: true },
    });
    const defectMarkdown = formatSocraticAuditSection(defectReport);
    expect(defectMarkdown).toContain("### Socratic Reflexive Self-Questioning Engine");
    expect(defectMarkdown).toContain("- **Status**: issues detected");
    expect(defectMarkdown).toContain("SOC-PREM-02-BASELINE-CONSISTENCY");
    expect(defectMarkdown).toContain("*Remediation*:");
  });
});
