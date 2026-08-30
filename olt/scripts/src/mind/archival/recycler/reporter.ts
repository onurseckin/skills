import { readFeedbackQueueStrict } from "../../feedback/index.ts";
import {
  extractAllCandidates,
  type AutonomousRecycleOptions,
  type RecycleAssessment,
} from "./types.ts";
import { assessRecyclingState } from "./scanner.ts";

export function enforceInfiniteMindCadence(params: {
  readonly runRoot: string;
  readonly actor: string;
  readonly isTerminal?: boolean | undefined;
  readonly nextWakeAt?: string | null | undefined;
}): {
  readonly cadence: "infinite_autonomous";
  readonly allowed: boolean;
  readonly nextInstruction: string;
  readonly message: string;
} {
  const nextCmd = `bun harness.ts mind:wake --run ${params.runRoot}`;

  if (params.isTerminal) {
    return {
      cadence: "infinite_autonomous",
      allowed: true,
      nextInstruction: nextCmd,
      message:
        "Terminal outcome recorded; perpetual mind loop remains armed and ready for manual or external restart.",
    };
  }

  return {
    cadence: "infinite_autonomous",
    allowed: true,
    nextInstruction: nextCmd,
    message:
      "Infinite autonomous mind cadence active; agents may not terminate background loops or schedulers.",
  };
}

export interface MindRecycleHealth {
  readonly healthy: boolean;
  readonly activeCadence: "infinite_autonomous";
  readonly assessment: RecycleAssessment;
  readonly timestamp: string;
}

export function inspectRecycleHealth(
  state: Record<string, unknown>,
  runRoot: string,
  options?: AutonomousRecycleOptions,
): MindRecycleHealth {
  const assessment = assessRecyclingState(state, runRoot, options);
  const nowIso =
    options?.now !== undefined ? new Date(options.now).toISOString() : new Date().toISOString();

  return {
    healthy: assessment.canRecycle && assessment.infiniteCadence,
    activeCadence: "infinite_autonomous",
    assessment,
    timestamp: nowIso,
  };
}

export function validateRolloverReadiness(
  sourceState: Record<string, unknown>,
  targetGeneration?: number,
  options?: { readonly feedbackQueuePath?: string | undefined },
): {
  readonly ready: boolean;
  readonly reason: string;
  readonly generation: number;
  readonly targetGeneration: number;
  readonly pendingFeedbackCount: number;
  readonly activeCandidatesCount: number;
} {
  const mind = sourceState.mind as Record<string, unknown> | undefined;
  if (!mind || typeof mind !== "object") {
    return {
      ready: false,
      reason: "Missing mind substate in source capsule",
      generation: 1,
      targetGeneration: targetGeneration ?? 2,
      pendingFeedbackCount: 0,
      activeCandidatesCount: 0,
    };
  }

  const currentGen = typeof mind.generation === "number" ? mind.generation : 1;
  const effectiveTargetGen = targetGeneration ?? currentGen + 1;
  if (effectiveTargetGen <= currentGen) {
    return {
      ready: false,
      reason: `Target generation ${effectiveTargetGen} must exceed current generation ${currentGen}`,
      generation: currentGen,
      targetGeneration: effectiveTargetGen,
      pendingFeedbackCount: 0,
      activeCandidatesCount: 0,
    };
  }

  if (mind.status === "rotated") {
    return {
      ready: false,
      reason: "Source capsule is already rotated (sealed)",
      generation: currentGen,
      targetGeneration: effectiveTargetGen,
      pendingFeedbackCount: 0,
      activeCandidatesCount: 0,
    };
  }

  const allCandidates = extractAllCandidates(sourceState);
  const activeCandidates = allCandidates.filter(
    (c) => c.status === "opened" || c.status === "open" || c.status === "admitted",
  );

  const pendingCount = readFeedbackQueueStrict(options?.feedbackQueuePath).filter(
    (item) => item.status === "PENDING",
  ).length;

  return {
    ready: true,
    reason: `Mind is ready to transition from generation ${currentGen} to ${effectiveTargetGen}`,
    generation: currentGen,
    targetGeneration: effectiveTargetGen,
    pendingFeedbackCount: pendingCount,
    activeCandidatesCount: activeCandidates.length,
  };
}
