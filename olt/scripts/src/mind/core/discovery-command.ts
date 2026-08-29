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

// Re-export canonical task queue facilities
export {
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
};

/**
 * CLI Command Handler: mind:task-discovery / mind-task-discovery
 * Autonomically scans the workspace for cognitive gaps, code quality defects,
 * test coverage deficits, dormant criteria, pending feedback, and defect logs.
 */
export function mindTaskDiscoveryCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const run = textFlag(flags, "run", false);
  const charter = textFlag(flags, "charter", false);
  const feedbackQueue = textFlag(flags, "feedback-queue", false);
  const taskQueue = textFlag(flags, "task-queue", false);
  const capsulesDir = textFlag(flags, "capsules-dir", false);
  const autoEnqueue = boolFlag(flags, "auto-enqueue");
  const maxTasks = integerFlag(flags, "max-tasks") ?? 5;
  const actor = textFlag(flags, "actor", false) ?? "mind-task-discovery";

  const rawSourceRoots = listFlag(flags, "source-root", false);
  const sourceRoots = rawSourceRoots ? [...rawSourceRoots] : undefined;

  const rawTestRoots = listFlag(flags, "test-root", false);
  const testRoots = rawTestRoots ? [...rawTestRoots] : undefined;

  const result = discoverTasks({
    workspaceRoot: run,
    sourceRoots,
    testRoots,
    charterPath: charter,
    feedbackQueuePath: feedbackQueue,
    taskQueuePath: taskQueue,
    capsulesDir,
    maxTasks,
    autoEnqueue,
    actor,
  });

  const brief = formatTaskDiscoveryBrief(result);
  const formattedMarkdown = enforceLineLimit(brief, 30);

  return {
    markdown: formattedMarkdown,
    scanned_at: result.scannedAt,
    findings: result.findings,
    discoveries: result.discoveries,
    candidate_proposals: result.candidateProposals,
    synthesized_plans: result.synthesizedPlans,
    enqueued_tasks: result.enqueuedTasks,
    stats: result.stats,
    summary: result.summary,
  };
}
