import type { DefectEntry, DefectRemediationAction } from "../../core/types.ts";
import type {
  DefectDeliberationRound,
  DeliberationRecommendation,
  DeliberationStatus,
  DeliberationSynthesis,
  ResolutionProof,
} from "./types.ts";
import {
  formulateDefectHypotheses,
  synthesizeBoundaryRemediationActions,
  synthesizeRemediationActions,
} from "./actions.ts";

export function synthesizeDeliberationRound(params: {
  readonly round_number: number;
  readonly defects: readonly DefectEntry[];
  readonly proofs?: readonly ResolutionProof[] | undefined;
  readonly options?: { readonly maxRounds?: number | undefined } | undefined;
}): DeliberationSynthesis {
  const { round_number, defects, proofs = [], options } = params;
  const maxRounds = options?.maxRounds ?? 3;

  const resolvedIds = new Set<string>();
  for (const proof of proofs) {
    resolvedIds.add(proof.task_id);
  }

  const resolved_defect_ids = defects
    .filter((d) => resolvedIds.has(d.id) || d.status === "resolved" || d.status === "completed")
    .map((d) => d.id);

  const unresolved_defect_ids = defects
    .filter((d) => !resolved_defect_ids.includes(d.id))
    .map((d) => d.id);

  const consensus_reached = unresolved_defect_ids.length === 0;
  const hypotheses = formulateDefectHypotheses(
    defects.filter((d) => unresolved_defect_ids.includes(d.id)),
  );
  const recommended_actions = synthesizeRemediationActions(hypotheses, defects);

  let recommendation: DeliberationRecommendation = "advance_round";
  if (consensus_reached) {
    recommendation = "converge";
  } else if (round_number >= maxRounds) {
    recommendation = "halt_for_human";
  }

  return {
    round_number,
    total_defects: defects.length,
    resolved_defect_ids,
    unresolved_defect_ids,
    recommended_actions,
    consensus_reached,
    summary: consensus_reached
      ? `Deliberation converged on round ${round_number}: all defects resolved.`
      : `Round ${round_number}: ${unresolved_defect_ids.length} unresolved defects remaining.`,
    recommendation,
    readiness_for_convergence: consensus_reached,
  };
}

export function createDefectDeliberationRound(params: {
  readonly round_number?: number | undefined;
  readonly capsule_root?: string | undefined;
  readonly defects: readonly DefectEntry[];
  readonly proofs?: readonly ResolutionProof[] | undefined;
  readonly options?: { readonly maxRounds?: number | undefined } | undefined;
}): DefectDeliberationRound {
  const round_number = params.round_number ?? 1;
  const defects = params.defects;
  const proofs = params.proofs ?? [];
  const hypotheses = formulateDefectHypotheses(defects);
  const remediation_actions = synthesizeRemediationActions(hypotheses, defects);
  const synthesis = synthesizeDeliberationRound({
    round_number,
    defects,
    proofs,
    options: params.options,
  });

  let status: DeliberationStatus = "deliberating";
  if (synthesis.consensus_reached) {
    status = "converged";
  } else if (synthesis.recommendation === "halt_for_human") {
    status = "exhausted";
  }

  return {
    round_number,
    capsule_root: params.capsule_root,
    status,
    defect_ids: defects.map((d) => d.id),
    defects,
    hypotheses,
    remediation_actions,
    actions: remediation_actions,
    proofs,
    synthesis,
  };
}

export function advanceDeliberationRound(
  arg1:
    | DefectDeliberationRound
    | {
        readonly previousRound: DefectDeliberationRound;
        readonly additionalProofs?: readonly ResolutionProof[] | undefined;
        readonly options?: { readonly maxRounds?: number | undefined } | undefined;
      },
  roundNumberOrProofs?: number | readonly ResolutionProof[],
  defectsOrOptions?: readonly DefectEntry[] | { readonly maxRounds?: number | undefined },
  proofsArg?: readonly ResolutionProof[],
  optionsArg?: { readonly maxRounds?: number | undefined },
): DefectDeliberationRound {
  if ("previousRound" in arg1) {
    const { previousRound, additionalProofs = [], options } = arg1;
    const nextRoundNumber = previousRound.round_number + 1;
    const combinedProofs = [...previousRound.proofs, ...additionalProofs];
    return createDefectDeliberationRound({
      round_number: nextRoundNumber,
      capsule_root: previousRound.capsule_root,
      defects: previousRound.defects,
      proofs: combinedProofs,
      options,
    });
  }

  const previousRound = arg1;
  const roundNumber =
    typeof roundNumberOrProofs === "number" ? roundNumberOrProofs : previousRound.round_number + 1;
  const defects = Array.isArray(defectsOrOptions) ? defectsOrOptions : previousRound.defects;
  const proofs = Array.isArray(proofsArg)
    ? proofsArg
    : Array.isArray(roundNumberOrProofs)
      ? roundNumberOrProofs
      : [];
  const options =
    optionsArg ??
    (typeof defectsOrOptions === "object" && !Array.isArray(defectsOrOptions)
      ? (defectsOrOptions as { readonly maxRounds?: number | undefined })
      : undefined);
  const combinedProofs = [...previousRound.proofs, ...proofs];

  return createDefectDeliberationRound({
    round_number: roundNumber,
    capsule_root: previousRound.capsule_root,
    defects,
    proofs: combinedProofs,
    options,
  });
}

export class DefectDeliberationPipeline {
  private currentRound: DefectDeliberationRound | null = null;
  private rounds: DefectDeliberationRound[] = [];
  private readonly options?:
    | { readonly maxRounds?: number | undefined; readonly capsule_root?: string | undefined }
    | undefined;

  constructor(
    initialOrOptions?:
      | readonly DefectEntry[]
      | { readonly maxRounds?: number | undefined; readonly capsule_root?: string | undefined },
    maybeOptions?: {
      readonly maxRounds?: number | undefined;
      readonly capsule_root?: string | undefined;
    },
  ) {
    if (Array.isArray(initialOrOptions)) {
      this.options = maybeOptions;
      this.currentRound = createDefectDeliberationRound({
        round_number: 1,
        capsule_root: maybeOptions?.capsule_root,
        defects: [...initialOrOptions],
        options: maybeOptions,
      });
      this.rounds = [this.currentRound];
    } else {
      this.options = initialOrOptions as
        | { readonly maxRounds?: number | undefined; readonly capsule_root?: string | undefined }
        | undefined;
    }
  }

  public startDeliberation(defects: readonly DefectEntry[]): DefectDeliberationRound {
    this.currentRound = createDefectDeliberationRound({
      round_number: 1,
      capsule_root: this.options?.capsule_root,
      defects: [...defects],
      options: this.options,
    });
    this.rounds = [this.currentRound];
    return this.currentRound;
  }

  public getRound(): DefectDeliberationRound {
    if (!this.currentRound) {
      throw new Error("No deliberation round started");
    }
    return this.currentRound;
  }

  public advance(
    defectsOrProofs: readonly DefectEntry[] | readonly ResolutionProof[] = [],
    maybeProofs?: readonly ResolutionProof[],
  ): DefectDeliberationRound {
    if (!this.currentRound) {
      throw new Error("No deliberation round started");
    }
    if (Array.isArray(maybeProofs)) {
      const defects = defectsOrProofs as readonly DefectEntry[];
      this.currentRound = advanceDeliberationRound(
        this.currentRound,
        this.currentRound.round_number + 1,
        defects,
        maybeProofs,
        this.options,
      );
    } else {
      const proofs = defectsOrProofs as readonly ResolutionProof[];
      this.currentRound = advanceDeliberationRound({
        previousRound: this.currentRound,
        additionalProofs: [...proofs],
        options: this.options,
      });
    }
    this.rounds.push(this.currentRound);
    return this.currentRound;
  }

  public getAllRounds(): readonly DefectDeliberationRound[] {
    return this.rounds;
  }

  public isConverged(): boolean {
    return this.currentRound?.status === "converged";
  }

  public isExhausted(): boolean {
    return this.currentRound?.status === "exhausted";
  }
}
