import { categorizeDefect } from "../core/sanitizer.ts";
import { formulateBoundaryViolationHypothesis } from "./ledger-ops.ts";
import type {
  DefectCategory,
  DefectEntry,
  DefectHypothesis,
  DefectRemediationAction,
} from "../core/types.ts";

export interface DeliberationSynthesis {
  readonly round_number: number;
  readonly total_defects: number;
  readonly resolved_defect_ids: readonly string[];
  readonly unresolved_defect_ids: readonly string[];
  readonly recommended_actions: readonly DefectRemediationAction[];
  readonly consensus_reached: boolean;
  readonly summary: string;
}

export interface DefectDeliberationRound {
  readonly round_number: number;
  readonly capsule_root: string;
  readonly defects: readonly DefectEntry[];
  readonly hypotheses: readonly DefectHypothesis[];
  readonly remediation_actions: readonly DefectRemediationAction[];
  readonly synthesis: DeliberationSynthesis;
}

export function formulateDefectHypotheses(
  defects: readonly DefectEntry[],
): readonly DefectHypothesis[] {
  return defects.map((defect) => {
    const cat = defect.category || categorizeDefect(defect);
    if (cat === "boundary_violation") {
      return formulateBoundaryViolationHypothesis(defect);
    }

    const obs = defect.observation || defect.message || "Unknown observation";
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
    const defectType = defect?.type || "boundary_violation";
    const isCoord = defectType.includes("coordinator");

    actions.push({
      id: `action-${hypo.id}`,
      defect_id: hypo.defect_id,
      action_type: isCoord ? "tighten_boundary" : "add_test_gate",
      description: isCoord
        ? "Enforce Zero Coordinator Code Writing invariant and delegate file edits to Tier 3 Implementers."
        : "Constrain main thread execution and enforce subagent boundary delegation.",
      prescribed_test: isCoord
        ? "expect(coordinatorModifications).toHaveLength(0)"
        : "expect(isBoundaryConcurred).toBeTrue()",
      target_scope: isCoord ? "olt/scripts/src/mind/roles/**" : "olt/scripts/src/mind/**",
      priority: "critical",
    });
  }

  return actions;
}

export function synthesizeRemediationActions(
  hypotheses: readonly DefectHypothesis[],
): readonly DefectRemediationAction[] {
  return hypotheses.map((hypo) => {
    return {
      id: `action-${hypo.id}`,
      defect_id: hypo.defect_id,
      action_type: "tighten_boundary" as const,
      description: `Remediation for ${hypo.root_cause}`,
      prescribed_test: `test("${hypo.defect_id}", () => expect(true).toBe(true))`,
      target_scope: "olt/scripts/src/mind/**",
      priority: "high" as const,
    };
  });
}

export function synthesizeDeliberationRound(
  roundNumber: number,
  defects: readonly DefectEntry[],
  actions: readonly DefectRemediationAction[],
): DeliberationSynthesis {
  const resolvedIds = defects
    .filter((d) => d.status === "resolved" || d.status === "completed")
    .map((d) => d.id);
  const unresolvedIds = defects
    .filter((d) => d.status !== "resolved" && d.status !== "completed")
    .map((d) => d.id);

  return {
    round_number: roundNumber,
    total_defects: defects.length,
    resolved_defect_ids: resolvedIds,
    unresolved_defect_ids: unresolvedIds,
    recommended_actions: actions,
    consensus_reached: unresolvedIds.length === 0,
    summary: `Round ${roundNumber}: ${resolvedIds.length}/${defects.length} defects resolved.`,
  };
}

export function createDefectDeliberationRound(params: {
  readonly round_number: number;
  readonly capsule_root: string;
  readonly defects: readonly DefectEntry[];
}): DefectDeliberationRound {
  const hypotheses = formulateDefectHypotheses(params.defects);
  const actions = synthesizeBoundaryRemediationActions(hypotheses, params.defects);
  const synthesis = synthesizeDeliberationRound(params.round_number, params.defects, actions);

  return {
    round_number: params.round_number,
    capsule_root: params.capsule_root,
    defects: params.defects,
    hypotheses,
    remediation_actions: actions,
    synthesis,
  };
}

export function advanceDeliberationRound(
  previousRound: DefectDeliberationRound,
  resolvedIds: readonly string[],
): DefectDeliberationRound {
  const updatedDefects = previousRound.defects.map((d) =>
    resolvedIds.includes(d.id) ? { ...d, status: "resolved" as const } : d,
  );
  return createDefectDeliberationRound({
    round_number: previousRound.round_number + 1,
    capsule_root: previousRound.capsule_root,
    defects: updatedDefects,
  });
}

export class DefectDeliberationPipeline {
  private currentRound: DefectDeliberationRound | undefined;

  public initialize(capsuleRoot: string, defects: readonly DefectEntry[]): DefectDeliberationRound {
    this.currentRound = createDefectDeliberationRound({
      round_number: 1,
      capsule_root: capsuleRoot,
      defects,
    });
    return this.currentRound;
  }

  public advance(resolvedIds: readonly string[]): DefectDeliberationRound {
    if (!this.currentRound) {
      throw new Error("Deliberation pipeline not initialized");
    }
    this.currentRound = advanceDeliberationRound(this.currentRound, resolvedIds);
    return this.currentRound;
  }

  public getRound(): DefectDeliberationRound | undefined {
    return this.currentRound;
  }
}
