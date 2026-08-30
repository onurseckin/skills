import { rotateMindGeneration } from "../rotate/index.ts";
import { validateRolloverReadiness } from "./reporter.ts";
import { loadRun } from "../../../engine/store/index.ts";
import { enforceLineLimit } from "../../lifecycle/cadence/index.ts";
import { extractAllCandidates } from "./types.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import type { FeedbackItem } from "../../feedback/queue/index.ts";
import type {
  AutonomousRecycleOptions,
  AutonomicRolloverOptions,
  AutonomicRolloverResult,
  CandidateRecord,
  RecycleAssessment,
  RecyclePlan,
} from "./types.ts";
import { assessRecyclingState } from "./scanner.ts";
import {
  transitionPulseToWake,
  drainAndAdmitFeedbackCandidates,
  compileAutonomicWavePlan,
} from "./collector.ts";
export function executeAutonomicRollover(
  options: AutonomicRolloverOptions,
): AutonomicRolloverResult {
  const actor = options.actor ?? "mind-autonomic-recycler";
  const sourceLoaded = loadRun(options.sourceRunRoot, false);
  const readiness = validateRolloverReadiness(
    sourceLoaded.state as Record<string, unknown>,
    undefined,
    { feedbackQueuePath: options.feedbackQueuePath },
  );
  if (!readiness.ready) {
    throw new HarnessError("INVALID_STATE", `Capsule not ready for rollover: ${readiness.reason}`);
  }

  const rotateResult = rotateMindGeneration({
    sourceRunRoot: options.sourceRunRoot,
    nextRunId: options.targetRunId,
    actor,
    now: options.now !== undefined ? new Date(options.now).toISOString() : undefined,
    capsulesDir: options.capsulesDir,
  });

  const shouldDrain = options.autoDrain !== false;
  let drainedFeedbackItems: readonly FeedbackItem[] = [];
  let admittedCandidates: readonly CandidateRecord[] = [];

  if (shouldDrain) {
    const drainResult = drainAndAdmitFeedbackCandidates({
      runRoot: rotateResult.targetRunRoot,
      actor,
      queuePath: options.feedbackQueuePath,
      now: options.now,
    });
    drainedFeedbackItems = drainResult.drainedItems;
    admittedCandidates = drainResult.admittedCandidates;
  }

  const targetLoaded = loadRun(rotateResult.targetRunRoot, false);
  const wavePlan = compileAutonomicWavePlan(
    targetLoaded.state as Record<string, unknown>,
    rotateResult.targetRunRoot,
    { maxParallel: options.maxParallel, actor },
  );

  const markdown = formatAutonomicRolloverBrief({
    sourceRunId: rotateResult.sourceRunId,
    targetRunId: rotateResult.targetRunId,
    sourceGeneration: rotateResult.sourceGeneration,
    targetGeneration: rotateResult.targetGeneration,
    targetRunRoot: rotateResult.targetRunRoot,
    drainedCount: drainedFeedbackItems.length,
    admittedCount: admittedCandidates.length,
    waveCount: wavePlan.waves.length,
    nextInstruction: wavePlan.nextInstruction,
  });

  return {
    success: true,
    sourceRunRoot: rotateResult.sourceRunRoot,
    sourceRunId: rotateResult.sourceRunId,
    targetRunRoot: rotateResult.targetRunRoot,
    targetRunId: rotateResult.targetRunId,
    sourceGeneration: rotateResult.sourceGeneration,
    targetGeneration: rotateResult.targetGeneration,
    drainedFeedbackItems,
    admittedCandidates,
    wavePlan,
    nextRecommendedCommand: wavePlan.nextInstruction,
    markdown,
  };
}

export function formatAutonomicRolloverBrief(params: {
  readonly sourceRunId: string;
  readonly targetRunId: string;
  readonly sourceGeneration: number;
  readonly targetGeneration: number;
  readonly targetRunRoot: string;
  readonly drainedCount: number;
  readonly admittedCount: number;
  readonly waveCount: number;
  readonly nextInstruction: string;
}): string {
  const lines = [
    `### Autonomic Mind Generation Rollover: ${params.sourceGeneration} → ${params.targetGeneration}`,
    `- **Source**: \`${params.sourceRunId}\` (converged & sealed)`,
    `- **Successor**: \`${params.targetRunId}\` at \`${params.targetRunRoot}\``,
    `- **FEEDBACK_QUEUE Drained**: ${params.drainedCount} items admitted`,
    `- **Candidates Admitted**: ${params.admittedCount}`,
    `- **Concurrency Waves Compiled**: ${params.waveCount}`,
    `- **Cadence**: infinite autonomous loop active (zero yield / zero idle)`,
    `- **Next Instruction**: \`${params.nextInstruction}\``,
  ];
  return enforceLineLimit(lines.join("\n"), 25);
}

export function planAutonomousRoundRecycle(
  state: Record<string, unknown>,
  options: AutonomousRecycleOptions,
): RecyclePlan {
  const assessment = assessRecyclingState(state, options.runRoot, {
    now: options.now,
    feedbackQueuePath: options.feedbackQueuePath,
    checkFeedbackQueue: options.checkFeedbackQueue,
    targetRunRoot: options.targetRunRoot,
    maxParallel: options.maxParallel,
  });
  const markdown = formatRecycleBrief(assessment, options.runRoot);

  return {
    runRoot: options.runRoot,
    transition: assessment.transition,
    currentRound: assessment.roundNumber,
    nextRound: assessment.roundNumber !== null ? assessment.roundNumber + 1 : null,
    objectiveId: assessment.objectiveId,
    candidateId: assessment.candidateId,
    planCommands: assessment.suggestedCommands,
    nextRecommendedCommand: assessment.nextRecommendedCommand,
    markdown,
  };
}

export function formatRecycleBrief(assessment: RecycleAssessment, runRoot: string): string {
  const lines = [
    `### Autonomous Mind Recycler`,
    `- **Capsule**: \`${runRoot}\``,
    `- **Phase**: \`${assessment.phase}\``,
    `- **Transition**: \`${assessment.transition}\``,
    assessment.objectiveId ? `- **Objective**: \`${assessment.objectiveId}\`` : undefined,
    assessment.candidateId ? `- **Candidate**: \`${assessment.candidateId}\`` : undefined,
    assessment.roundNumber !== null ? `- **Round**: ${assessment.roundNumber}` : undefined,
    `- **Cadence**: infinite autonomous loop active (prohibits agent termination / exit)`,
    `- **Reason**: ${assessment.reason}`,
    `- **Next Instruction**: \`${assessment.nextRecommendedCommand}\``,
  ].filter((l): l is string => l !== undefined);

  return enforceLineLimit(lines.join("\n"), 25);
}
