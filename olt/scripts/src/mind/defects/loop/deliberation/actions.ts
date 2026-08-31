import { categorizeDefect } from "../../core/sanitizer.ts";
import { formulateBoundaryViolationHypothesis } from "../ledger-ops.ts";
import type {
  DefectCategory,
  DefectEntry,
  DefectHypothesis,
  DefectRemediationAction,
} from "../../core/types.ts";

export function formulateDefectHypotheses(
  defects: readonly DefectEntry[],
): readonly DefectHypothesis[] {
  return defects.map((defect) => {
    const cat =
      defect.category !== undefined && defect.category !== ""
        ? defect.category
        : categorizeDefect(defect);
    if (cat === "boundary_violation") {
      return formulateBoundaryViolationHypothesis(defect);
    }

    const obs =
      defect.observation !== undefined && defect.observation !== ""
        ? defect.observation
        : defect.message !== undefined && defect.message !== ""
          ? defect.message
          : "Unknown observation";
    return {
      id: `hypo-${defect.id}`,
      defect_id: defect.id,
      root_cause: `Defect observed: ${obs}`,
      confidence: 0.95,
      category: cat,
      evidence: [obs],
    };
  });
}

export function synthesizeBoundaryRemediationActions(
  hypotheses: readonly DefectHypothesis[],
  defects: readonly DefectEntry[],
): readonly DefectRemediationAction[] {
  const defectMap = new Map(defects.map((d) => [d.id, d]));
  const actions: DefectRemediationAction[] = [];

  for (const hypo of hypotheses) {
    const defect = defectMap.get(hypo.defect_id);
    const defectType =
      defect !== undefined && defect.type !== undefined && defect.type !== ""
        ? defect.type
        : "boundary_violation";
    const isCoord = defectType.includes("coordinator");

    actions.push({
      id: `action-${hypo.id}`,
      action_id: `action-${hypo.id}`,
      defect_id: hypo.defect_id,
      action_type: isCoord ? "tighten_boundary" : "add_test_gate",
      description: isCoord
        ? "Enforce Zero Coordinator Code Writing invariant and delegate file edits to Tier 3 Implementers."
        : "Constrain main thread execution and enforce subagent boundary delegation.",
      prescribed_test: isCoord
        ? "expect(coordinatorModifications).toHaveLength(0)"
        : "expect(isBoundaryConcurred).toBeTrue()",
      target_scope: isCoord ? ["olt/scripts/src/mind/roles/**"] : ["olt/scripts/src/mind/**"],
      priority: "critical",
      status: "planned",
    });
  }

  return actions;
}

export function synthesizeRemediationActions(
  hypotheses: readonly DefectHypothesis[],
  defects: readonly DefectEntry[] = [],
): readonly DefectRemediationAction[] {
  const defectMap = new Map(defects.map((d) => [d.id, d]));
  return hypotheses.map((hypo, idx) => {
    const defect = defectMap.get(hypo.defect_id);
    const cat = hypo.category;
    const isBoundary = cat === "boundary_violation";

    let prescribedTest = "expect(status).toBe(0)";
    if (isBoundary) {
      prescribedTest = "expect(verifyRoleRestraint(agent)).toBe(true)";
    }

    return {
      id: `action-${hypo.id}-${idx + 1}`,
      action_id: `action-${hypo.id}-${idx + 1}`,
      defect_id: hypo.defect_id,
      action_type: isBoundary ? "tighten_boundary" : "add_test_gate",
      description: `Remediation action for ${hypo.root_cause}`,
      prescribed_test: prescribedTest,
      target_scope: isBoundary ? ["olt/scripts/src/mind/roles/**"] : ["olt/scripts/src/mind/**"],
      priority: "high",
      status: "planned",
    };
  });
}
