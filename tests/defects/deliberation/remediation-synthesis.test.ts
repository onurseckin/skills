import { describe, expect, it } from "bun:test";
import {
  formulateDefectHypotheses,
  synthesizeRemediationActions,
  validateResolutionProof,
  verifyResolutionProofEmpirical,
} from "../../../olt/scripts/src/mind/defects/index.ts";
import type {
  DefectEntry,
  DefectResolutionProof,
} from "../../../olt/scripts/src/mind/defects/core/index.ts";

export const remediationSynthesisSuiteName = "Defect Remediation Action Synthesis & Empirical Proofs";

describe(remediationSynthesisSuiteName, () => {
  it("validates resolution proofs strictly and rejects invalid formats", () => {
    const validProof: DefectResolutionProof = {
      task_id: "task-01",
      test_assertion: "expect(result).toBe(true)",
      resolved_at: "2026-08-22T12:00:00.000Z",
      commit_sha: "1a2b3c4d5e6f",
    };

    expect(validateResolutionProof(validProof)).toEqual(validProof);
    expect(verifyResolutionProofEmpirical(validProof).isValid).toBe(true);

    expect(() =>
      validateResolutionProof({
        task_id: "",
        test_assertion: "test",
        resolved_at: "2026-08-22T12:00:00.000Z",
      }),
    ).toThrow();

    expect(() =>
      validateResolutionProof({
        task_id: "task-01",
        test_assertion: "",
        resolved_at: "2026-08-22T12:00:00.000Z",
      }),
    ).toThrow();

    expect(() =>
      validateResolutionProof({
        task_id: "task-01",
        test_assertion: "test",
        resolved_at: "not-a-date",
      }),
    ).toThrow();

    expect(() =>
      validateResolutionProof(
        {
          task_id: "task-01",
          test_assertion: "test",
          resolved_at: "2026-08-22T12:00:00.000Z",
          commit_sha: "short",
        },
        { requireCommitSha: true },
      ),
    ).toThrow();
  });

  it("synthesizes remediation actions with prescribed test gates", () => {
    const defects: DefectEntry[] = [
      {
        id: "b-1",
        type: "role_confusion",
        severity: "critical",
        category: "boundary_violation",
        status: "open",
        observation: "Role confusion observed",
        remediation: "Apply supervisory reminder",
        timestamp: "2026-08-22T12:00:00.000Z",
        agent_id: "implementer_p31",
      },
    ];

    const hypotheses = formulateDefectHypotheses(defects);
    const actions = synthesizeRemediationActions(hypotheses, defects);

    expect(actions).toHaveLength(1);
    expect(actions[0]?.action_type).toBe("tighten_boundary");
    expect(actions[0]?.prescribed_test).toContain("verifyRoleRestraint");
    expect(actions[0]?.status).toBe("planned");
  });
});
