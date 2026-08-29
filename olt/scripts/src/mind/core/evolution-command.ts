/**
 * Unified Mind Subsystem Registry and Cognitive Discovery Engine.
 * Exports cognitive task discovery, self-evolution loops, strategic purpose codification,
 * CLI commands, and core mind domain facilities.
 */

import {
  boolFlag,
  integerFlag,
  listFlag,
  textFlag,
  type CommandContext,
  type Flags,
} from "../../cli/options.ts";
import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  requiredFlag,
  type CommandSpec,
  type FlagSpec,
} from "../../cli/registry/types.ts";
import { enforceLineLimit } from "../../cli/formatters/line-limiter.ts";
import {
  discoverTasks,
  formatTaskDiscoveryBrief,
  proposeCandidateEvolutions,
  resolveDiscoveryCharterPath,
  scanCodeQuality,
  scanCognitiveGaps,
  scanDormantCriteria,
  scanTestCoverage,
  synthesizeTaskFromDiscovery,
  type CandidateEvolutionProposal,
  type CodeQualityFinding,
  type CodeQualityIssueType,
  type CodeQualityScanOptions,
  type CodeQualityScanResult,
  type CognitiveGapFinding,
  type CognitiveGapScanOptions,
  type CognitiveGapScanResult,
  type CognitiveIssueType,
  type DiscoveredTaskPlan,
  type DiscoveryCategory,
  type DiscoveryItem,
  type DiscoverySeverity,
  type DormantCriteriaFinding,
  type DormantCriteriaScanOptions,
  type DormantCriteriaScanResult,
  type TaskDiscoveryOptions,
  type TaskDiscoveryResult,
  type TestCoverageFinding,
  type TestCoverageIssueType,
  type TestCoverageScanOptions,
  type TestCoverageScanResult,
} from "../tasks/discovery/index.ts";
import {
  CLOSING_FORBIDDEN_IDLE_MIND,
  DEFAULT_EVOLUTION_BASE_INTERVAL_MS,
  DEFAULT_EVOLUTION_MAX_INTERVAL_MS,
  enforcePerpetualNonStoppingCadence,
  evaluatePerpetualCadence,
  executeSelfEvolutionStep,
  formatSelfEvolutionBrief,
  getEvolutionStats,
  NON_STOPPING_RULE,
  PERPETUAL_NON_STOPPING_CADENCE,
  readEvolutionHistory,
  recordEvolutionCycle,
  resolveEvolutionHistoryPath,
  runSelfEvolutionCycle,
  type CadencePhase,
  type EvolutionHistoryStats,
  type EvolutionLedgerEntry,
  type PerpetualCadenceEvaluation,
  type SelfEvolutionCadenceState,
  type SelfEvolutionCycleOptions,
  type SelfEvolutionCycleResult,
  type SelfEvolutionMode,
} from "../lifecycle/evolution/index.ts";
import {
  MIND_STRATEGIC_ALTITUDE,
  MIND_HARD_ZEROS,
  MIND_PROACTIVE_BANDWIDTH_ACTIVITIES,
  diagnoseMacroDag,
  groomBacklog,
  evaluateStrategicCandidateAdmission,
  planProactiveRoadmap,
  executeProactiveMindCognition,
  formatStrategicCognitionBrief,
  verifyMindRoleStrategicInvariants,
  type MacroDagTaskNode,
  type MacroDagBottleneck,
  type MacroDagDiagnosticResult,
  type BacklogGroomingItem,
  type BacklogGroomingResult,
  type StrategicCandidate,
  type StrategicCandidateEvaluation,
  type StrategicCandidateAdmissionResult,
  type ProactiveWaveTask,
  type ProactiveWavePlan,
  type ProactiveRoadmapPlan,
  type ProactiveMindCognitionResult,
  type MacroDagDiagnosticOptions,
  type BacklogGroomingOptions,
  type StrategicCandidateAdmissionOptions,
  type ProactiveRoadmapPlanningOptions,
  type ProactiveMindCognitionOptions,
  type MindProactiveBandwidthActivity,
} from "../lifecycle/purpose/index.ts";
import {
  DEFAULT_COGNITIVE_MEMORY_FILE,
  resolveCanonicalCognitiveMemoryPath,
  resolveCognitiveMemoryPath,
  readCognitiveMemory,
  writeCognitiveMemory,
  updateCognitiveMemory,
  synthesizeAutonomousTasks,
  processAutonomousDualIntake,
  runAutonomousDualIntakeCycle,
  synthesizeSmartTasksFromFeedbackQueue,
  synthesizeSmartTasksFromSelfEvolution,
  expandExternalPromptToPlan,
  expandExternalPromptToWavePlan,
  planEnhance,
  planEnhanceToWavePlan,
  planWaveExecution,
  compileSmartTasksToWavePlan,
  partitionIntoDisjointWaves,
  partitionGroupedFeedbacksStrictly,
  partitionCandidatesStrictly,
  validateAntiBatchingRule,
  validateAntiBatchingIsolation,
  assertAntiBatchingRule,
  calculateScopeCollisions,
  detectScopeCollisions,
  detectScopeOverlap,
  type ActiveHypothesis,
  type RoadmapItem,
  type MacroMetrics,
  type CognitiveMemoryState,
  type SmartTaskPlan,
  type SmartTaskSourceType,
  type AntiBatchingValidationReport,
  type SmartTaskSynthesisResult,
  type WaveGroup,
  type SmartWavePlanResult,
  type ScopeCollision,
  type AutonomousDualIntakeResult,
} from "../tasks/smart/index.ts";
import {
  DEFAULT_TASK_QUEUE_FILE,
  resolveCanonicalTaskQueuePath,
  resolveTaskQueuePath,
  readTaskQueue,
  writeTaskQueue,
  clearTaskQueue,
  enqueueTask,
  enqueueTasksBatch,
  admitTask,
  claimTaskLease,
  popNextEligibleTask,
  popNextEligibleTaskWithCleanup,
  renewTaskLease,
  releaseTaskLease,
  startTaskValidation,
  completeTask,
  escalateTask,
  failTask,
  reclaimExpiredLeases,
  getQueueStats,
  listTaskQueue,
  pruneCompletedTasks,
  validateTaskQueueDag,
  type TaskQueueItem,
  type NewTaskQueueInput,
  type TaskQueueStats,
  type TaskQueueStatus,
  type TaskPriority,
  type TaskSourceType,
  type TaskLease,
} from "../tasks/queue/index.ts";

import { mindTaskDiscoveryCommand } from "./discovery-command.ts";

/**
 * CLI Command Handler: mind:self-evolve / mind-self-evolve
 * Executes a full self-evolution cycle in an idle Mind loop.
 */
export function mindSelfEvolveCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const run = textFlag(flags, "run", false);
  const charter = textFlag(flags, "charter", false);
  const feedbackQueue = textFlag(flags, "feedback-queue", false);
  const taskQueue = textFlag(flags, "task-queue", false);
  const historyPath = textFlag(flags, "history-file", false);
  const capsulesDir = textFlag(flags, "capsules-dir", false);
  const autoEnqueue = boolFlag(flags, "auto-enqueue") || true;
  const maxTasks = integerFlag(flags, "max-tasks") ?? 5;
  const actor = textFlag(flags, "actor", false) ?? "mind-self-evolution";
  const generation = integerFlag(flags, "generation") ?? 1;
  const cycleNumber = integerFlag(flags, "cycle") ?? 1;

  const result = runSelfEvolutionCycle({
    runRoot: run,
    charterPath: charter,
    feedbackQueuePath: feedbackQueue,
    taskQueuePath: taskQueue,
    historyPath,
    capsulesDir,
    autoEnqueue,
    maxTasksPerCycle: maxTasks,
    actor,
    generation,
    cycleNumber,
  });

  const brief = formatSelfEvolutionBrief(result);
  const formattedMarkdown = enforceLineLimit(brief, 30);

  return {
    markdown: formattedMarkdown,
    cycle_id: result.cycleId,
    generation: result.generation,
    cycle_number: result.cycleNumber,
    timestamp: result.timestamp,
    mode: result.mode,
    discoveries_count: result.discoveriesCount,
    synthesized_tasks: result.synthesizedTasks,
    candidate_proposals: result.candidateProposals,
    enqueued_tasks: result.enqueuedTasks,
    admitted_feedback_ids: result.admittedFeedbackIds,
    cadence_state: result.cadenceState,
    next_recommended_command: result.nextRecommendedCommand,
    summary: result.summary,
    duration_ms: result.durationMs,
  };
}

/**
 * CLI Command Handler: mind:strategic-cognition / mind:proactive-plan
 * Executes proactive strategic cognition during subordinate execution windows.
 */
export function mindStrategicCognitionCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const subordinateWindowHours = integerFlag(flags, "window-hours") ?? 2;
  const subordinateExecutionWindowMs = subordinateWindowHours * 3_600_000;
  const fleetId = textFlag(flags, "fleet-id", false);

  const result = executeProactiveMindCognition({
    subordinateExecutionWindowMs,
    fleetId,
  });

  const brief = formatStrategicCognitionBrief(result);
  const formattedMarkdown = enforceLineLimit(brief, 30);

  return {
    markdown: formattedMarkdown,
    altitude: result.altitude,
    window_hours: result.subordinateExecutionWindowHours,
    macro_dag: result.macroDag,
    backlog_grooming: result.backlogGrooming,
    candidate_admission: result.candidateAdmission,
    proactive_roadmap: result.proactiveRoadmap,
    strategic_summary: result.strategicSummary,
  };
}
