export const DEFECT_ID = "defect-cli-1788679982455-lmerue";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE =
  "Defect Remediation: Cannot finalize review for task 'task-2': Cognitive deepening protocol not satisfied. Completed 1/5 required cognitive rounds. Run `task:probe --task task-2 --kind cognitive` to satisfy cognitive deepening.";
export const REQUIRED_COGNITIVE_ROUNDS = 5;

export interface CognitiveProtocolContext {
  readonly taskId: string;
  readonly completedRounds: number;
  readonly requiredRounds: number;
  readonly probeKind?: string | undefined;
  readonly probeResolution?: string | undefined;
}

export interface CognitiveProtocolResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly finalized: boolean;
  readonly currentRounds: number;
  readonly requiredRounds: number;
  readonly errors: readonly string[];
  readonly guidance: string;
}

export function evaluateCognitiveReviewFinalization(
  context: CognitiveProtocolContext,
): CognitiveProtocolResult {
  const req = context.requiredRounds > 0 ? context.requiredRounds : REQUIRED_COGNITIVE_ROUNDS;
  if (context.completedRounds < req) {
    const errorMsg =
      "Cannot finalize review for task '" +
      context.taskId +
      "': Cognitive deepening protocol not satisfied. Completed " +
      String(context.completedRounds) +
      "/" +
      String(req) +
      " required cognitive rounds. Run `task:probe --task " +
      context.taskId +
      " --kind cognitive` to satisfy cognitive deepening.";
    const guidanceMsg =
      "Run task:probe --task " + context.taskId + " --kind cognitive to advance cognitive rounds.";
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      finalized: false,
      currentRounds: context.completedRounds,
      requiredRounds: req,
      errors: [errorMsg],
      guidance: guidanceMsg,
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    finalized: true,
    currentRounds: context.completedRounds,
    requiredRounds: req,
    errors: [],
    guidance: "Cognitive deepening protocol satisfied. Review finalization permitted.",
  };
}

export function recordCognitiveProbe(context: CognitiveProtocolContext): CognitiveProtocolResult {
  const isCognitiveProbe = context.probeKind === "cognitive";
  const newRounds = isCognitiveProbe ? context.completedRounds + 1 : context.completedRounds;

  return evaluateCognitiveReviewFinalization({
    taskId: context.taskId,
    completedRounds: newRounds,
    requiredRounds: context.requiredRounds,
    probeKind: context.probeKind,
    probeResolution: context.probeResolution,
  });
}
