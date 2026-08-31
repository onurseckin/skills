import { describe, expect, it } from "bun:test";
import {
  formulateDefectCandidates,
  formulateDefectHypotheses,
} from "../../../olt/scripts/src/mind/defects/index.ts";
import type { DefectEntry } from "../../../olt/scripts/src/mind/defects/core/index.ts";

export const hypothesisGenerationSuiteName = "Defect Hypothesis Generation & Charter Goal Mapping";

describe(hypothesisGenerationSuiteName, () => {
  it("formulates root cause hypotheses with high confidence and evidence", () => {
    const defects: DefectEntry[] = [
      {
        id: "b-bv",
        type: "role_leak",
        severity: "critical",
        category: "boundary_violation",
        status: "open",
        observation: "Agent executed non-conforming command",
        remediation: "Constrain agent role context",
        timestamp: "2026-08-22T12:00:00.000Z",
      },
      {
        id: "b-cd",
        type: "syntax_error",
        severity: "high",
        category: "code_defect",
        status: "open",
        observation: "Missing semicolon",
        remediation: "Add semicolon and run compiler",
        timestamp: "2026-08-22T12:00:00.000Z",
      },
    ];

    const hypotheses = formulateDefectHypotheses(defects);
    expect(hypotheses).toHaveLength(2);
    expect(hypotheses[0]?.category).toBe("boundary_violation");
    expect(hypotheses[0]?.confidence).toBeGreaterThan(0.9);
    expect(hypotheses[0]?.evidence).toContain("Observation: Agent executed non-conforming command");
  });

  it("formulates Mind candidate proposals with charter goal mappings", () => {
    const defects: DefectEntry[] = [
      {
        id: "b-cand-1",
        type: "boundary_violation_entry",
        severity: "critical",
        category: "boundary_violation",
        status: "open",
        observation: "Confinement error",
        remediation: "Enforce boundary",
        timestamp: "2026-08-22T12:00:00.000Z",
      },
      {
        id: "b-cand-2",
        type: "reasoning_drift_entry",
        severity: "high",
        category: "model_reasoning_error",
        status: "open",
        observation: "Plan drift",
        remediation: "Align intent",
        timestamp: "2026-08-22T12:00:00.000Z",
      },
    ];

    const proposals = formulateDefectCandidates(defects, ["G1", "G2"]);
    expect(proposals).toHaveLength(2);
    expect(proposals[0]?.id).toBe("cand-defect-b-cand-1");
    expect(proposals[0]?.charter_goal_ids).toContain("G2");
    expect(proposals[1]?.charter_goal_ids).toContain("G1");
  });
});
