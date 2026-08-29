import { discoverTasks } from "../../task-discovery.ts";
import { drainPendingFeedbacks } from "../../feedback-queue.ts";
import type {
  SelfEvolutionCycleOptions,
  SelfEvolutionCycleResult,
} from "./self-evolution-chunk1.ts";
import { recordEvolutionCycle } from "./self-evolution-chunk2.ts";
import {
  balanceOrchestratorLoad,
  calculateHierarchyCapacity,
  evaluateHierarchyScaling,
} from "./self-evolution-chunk3.ts";
import { synthesizeDynamicPlanRevisions } from "./self-evolution-chunk4.ts";
import {
  evaluatePerpetualCadence,
  executeSelfEvolutionStep,
} from "./self-evolution-chunk5.ts";


/**
 * Executes a full self-evolution cycle in an idle Mind loop.
 */
export function runSelfEvolutionCycle(
  options: SelfEvolutionCycleOptions = {},
): SelfEvolutionCycleResult {
  const startTime = Date.now();
  const nowIso =
    options.now !== undefined ? new Date(options.now).toISOString() : new Date().toISOString();
  const generation = options.generation ?? 1;
  const cycleNumber = options.cycleNumber ?? 1;
  const maxTasks = options.maxTasksPerCycle ?? 5;
  const cycleId = `cycle-gen${generation}-${cycleNumber}-${Date.now().toString().slice(-6)}`;

  // Evaluate cadence
  const evaluation = evaluatePerpetualCadence({
    taskQueuePath: options.taskQueuePath,
    feedbackQueuePath: options.feedbackQueuePath,
    baseIntervalMs: options.baseIntervalMs,
    maxIntervalMs: options.maxIntervalMs,
    now: options.now,
    runRoot: options.runRoot,
    orchestrators: options.orchestrators,
  });

  let mode: SelfEvolutionMode = evaluation.mode;
  let synthesizedTasks: readonly DiscoveredTaskPlan[] = [];
  let candidateProposals: readonly CandidateEvolutionProposal[] = [];
  let enqueuedTasks: readonly TaskQueueItem[] = [];
  const admittedFeedbackIds: string[] = [];
  let discoveriesCount = 0;

  if (mode === "MODE_B_FEEDBACK_INTAKE") {
    const discoveryResult = discoverTasks({
      feedbackQueuePath: options.feedbackQueuePath,
      taskQueuePath: options.taskQueuePath,
      enableCodeQualityScan: false,
      enableTestCoverageScan: false,
      enableCognitiveGapScan: false,
      enableDormantCriteriaScan: false,
      enableFeedbackQueueScan: true,
      enableDefectScan: false,
      maxTasks,
      autoEnqueue: options.autoEnqueue !== false,
      actor: options.actor,
    });

    synthesizedTasks = discoveryResult.synthesizedPlans;
    candidateProposals = discoveryResult.candidateProposals;
    enqueuedTasks = discoveryResult.enqueuedTasks;

    const drained = drainPendingFeedbacks(
      { markAs: "ADMITTED", limit: maxTasks },
      options.feedbackQueuePath,
    );

    for (const fb of drained) {
      admittedFeedbackIds.push(fb.id);
    }
    discoveriesCount = drained.length;
  } else {
    const discoveryResult = discoverTasks({
      workspaceRoot: options.workspaceRoot,
      sourceRoots: options.sourceRoots,
      testRoots: options.testRoots,
      charterPath: options.charterPath,
      feedbackQueuePath: options.feedbackQueuePath,
      taskQueuePath: options.taskQueuePath,
      capsulesDir: options.capsulesDir,
      enableCodeQualityScan: true,
      enableTestCoverageScan: true,
      enableCognitiveGapScan: true,
      enableDormantCriteriaScan: true,
      enableFeedbackQueueScan: false,
      enableDefectScan: true,
      maxTasks,
      autoEnqueue: options.autoEnqueue !== false,
      actor: options.actor,
    });

    synthesizedTasks = discoveryResult.synthesizedPlans;
    candidateProposals = discoveryResult.candidateProposals;
    enqueuedTasks = discoveryResult.enqueuedTasks;
    discoveriesCount = discoveryResult.discoveries.length;
    if (discoveryResult.discoveries.length === 0) {
      mode = "MODE_C_INVARIANT_HARDENING";
    }
  }

  // Synthesize dynamic plan revisions
  const planRevisionSynthesis = synthesizeDynamicPlanRevisions({
    signals: options.externalSignals,
    activePlans: synthesizedTasks,
    actor: options.actor,
  });
  const planRevisions = planRevisionSynthesis.revisions;

  // Calculate hierarchy metrics and scaling decision
  const hierarchyMetrics =
    evaluation.hierarchyMetrics ??
    calculateHierarchyCapacity({
      taskQueue: enqueuedTasks,
      orchestrators: options.orchestrators,
    });

  const scalingDecision = evaluateHierarchyScaling(hierarchyMetrics);

  const durationMs = Date.now() - startTime;
  const runArg = options.runRoot ? ` --run ${options.runRoot}` : "";
  const nextRecommendedCommand =
    enqueuedTasks.length > 0
      ? `bun harness.ts queue:wave${runArg}`
      : `bun harness.ts mind:wake${runArg}`;

  const summary = `Self-Evolution Cycle ${cycleId} (${mode}): synthesized ${synthesizedTasks.length} task(s), proposed ${candidateProposals.length} evolution(s), generated ${planRevisions.length} plan revision(s), scaling action [${scalingDecision.action}], enqueued ${enqueuedTasks.length} into queue in ${durationMs}ms.`;

  // Update cadence state
  const cadenceState: SelfEvolutionCadenceState = {
    generation,
    cycle: cycleNumber,
    phase: enqueuedTasks.length > 0 ? "EVOLVING" : "PERPETUAL_REST",
    lastCycleAt: nowIso,
    consecutiveIdlePulses:
      enqueuedTasks.length === 0 ? (evaluation.activeTasksCount === 0 ? 1 : 0) : 0,
    totalTasksSynthesized: synthesizedTasks.length,
    totalTasksCompleted: 0,
    quiescenceStreak: enqueuedTasks.length === 0 ? 1 : 0,
    currentIntervalMs: evaluation.nextIntervalMs,
    nextWakeAt: evaluation.nextWakeAt,
    infiniteCadenceEnforced: true,
  };

  // Record ledger entry
  const ledgerEntry: EvolutionLedgerEntry = {
    cycleId,
    generation,
    cycleNumber,
    timestamp: nowIso,
    mode,
    discoveriesCount,
    taskIds: synthesizedTasks.map((t) => t.id),
    feedbackIds: admittedFeedbackIds,
    durationMs,
    summary,
    planRevisionsCount: planRevisions.length,
    scalingAction: scalingDecision.action,
  };

  recordEvolutionCycle(ledgerEntry, options.historyPath);

  return {
    cycleId,
    generation,
    cycleNumber,
    timestamp: nowIso,
    mode,
    discoveriesCount,
    synthesizedTasks,
    candidateProposals,
    planRevisions,
    enqueuedTasks,
    admittedFeedbackIds,
    hierarchyMetrics,
    scalingDecision,
    cadenceState,
    nextRecommendedCommand,
    summary,
    durationMs,
  };
}


export const executeSelfEvolutionStep = runSelfEvolutionCycle;
