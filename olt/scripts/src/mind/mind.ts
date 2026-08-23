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
} from "../cli/options.ts";
import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  requiredFlag,
  type CommandSpec,
  type FlagSpec,
} from "../cli/registry/types.ts";
import { enforceLineLimit } from "../cli/formatters/line-limiter.ts";
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
} from "./task-discovery.ts";
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
} from "./self-evolution.ts";
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
} from "./strategic-purpose.ts";
import {
  CANONICAL_COGNITIVE_MEMORY_FILE,
  TODO_COGNITIVE_MEMORY_FILE,
  LEGACY_COGNITIVE_MEMORY_FILE,
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
} from "./smart-task-manager.ts";
import {
  CANONICAL_TASK_QUEUE_FILE,
  TODO_TASK_QUEUE_FILE,
  LEGACY_TASK_QUEUE_FILE,
  LEGACY_LOWER_TASK_QUEUE_FILE,
  DEFAULT_TASK_QUEUE_FILE,
  resolveCanonicalTaskQueuePath,
  resolveTaskQueuePath,
  migrateTaskQueue,
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
} from "./task-queue.ts";

// Re-export cognitive task discovery
export {
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
};

// Re-export perpetual self-evolution loop
export {
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
};

// Re-export strategic purpose and proactive cognition
export {
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
};

// Re-export persistent cognitive memory and smart task manager
export {
  CANONICAL_COGNITIVE_MEMORY_FILE,
  TODO_COGNITIVE_MEMORY_FILE,
  LEGACY_COGNITIVE_MEMORY_FILE,
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
};

// Re-export canonical task queue facilities
export {
  CANONICAL_TASK_QUEUE_FILE,
  TODO_TASK_QUEUE_FILE,
  LEGACY_TASK_QUEUE_FILE,
  LEGACY_LOWER_TASK_QUEUE_FILE,
  DEFAULT_TASK_QUEUE_FILE,
  resolveCanonicalTaskQueuePath,
  resolveTaskQueuePath,
  migrateTaskQueue,
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
 * test coverage deficits, dormant criteria, pending feedback, and blunder logs.
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

export const MIND_TASK_DISCOVERY_COMMAND_SPEC: CommandSpec = {
  name: "mind:task-discovery",
  aliases: ["mind-task-discovery", "task:discover"],
  domain: "mind",
  summary: "Autonomously scan workspace for cognitive gaps, quality issues, and dormant criteria.",
  description:
    "Runs cognitive task discovery across source modules, unit tests, charter goals, feedback queue, and blunder logs to identify gaps and synthesize anti-batched self-evolution tasks.",
  flags: [
    optionalFlag("run", "string", "Mind capsule run root or workspace directory."),
    optionalFlag("source-root", "string", "Source directory to scan; repeat for multiple."),
    optionalFlag("test-root", "string", "Test directory to scan; repeat for multiple."),
    optionalFlag("charter", "string", "Custom path to CHARTER.md."),
    optionalFlag("feedback-queue", "string", "Custom path to FEEDBACK_QUEUE.jsonl."),
    optionalFlag("task-queue", "string", "Custom path to TASK_QUEUE.jsonl."),
    optionalFlag("capsules-dir", "string", "Capsules root directory."),
    optionalFlag(
      "auto-enqueue",
      "bool",
      "Automatically enqueue synthesized tasks into task queue.",
    ),
    optionalFlag("max-tasks", "int", "Maximum tasks to synthesize (default: 5).", 5),
    optionalFlag("actor", "string", "Acting agent identifier.", "mind-task-discovery"),
    optionalFlag("json", "bool", "Output structured JSON."),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    "bun harness.ts mind:task-discovery",
    "bun harness.ts mind:task-discovery --auto-enqueue --max-tasks 3",
  ],
  handler: mindTaskDiscoveryCommand,
};

export const MIND_SELF_EVOLVE_COMMAND_SPEC: CommandSpec = {
  name: "mind:self-evolve",
  aliases: ["mind-self-evolve", "mind:evolve"],
  domain: "mind",
  summary: "Execute an autonomous self-evolution cycle in an idle Mind loop.",
  description:
    "Performs an autonomous self-evolution cycle: evaluates perpetual cadence, drains feedback or scans cognitive gaps, synthesizes tasks, enqueues work, and records cycle in evolution ledger.",
  flags: [
    optionalFlag("run", "string", "Mind capsule run root."),
    optionalFlag("charter", "string", "Custom path to CHARTER.md."),
    optionalFlag("feedback-queue", "string", "Custom path to FEEDBACK_QUEUE.jsonl."),
    optionalFlag("task-queue", "string", "Custom path to TASK_QUEUE.jsonl."),
    optionalFlag("history-file", "string", "Custom path to EVOLUTION_HISTORY.jsonl."),
    optionalFlag("capsules-dir", "string", "Capsules root directory."),
    optionalFlag("auto-enqueue", "bool", "Automatically enqueue tasks.", true),
    optionalFlag("max-tasks", "int", "Maximum tasks to synthesize (default: 5).", 5),
    optionalFlag("actor", "string", "Acting agent identifier.", "mind-self-evolution"),
    optionalFlag("generation", "int", "Current mind generation.", 1),
    optionalFlag("cycle", "int", "Current evolution cycle number.", 1),
    optionalFlag("json", "bool", "Output structured JSON."),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    "bun harness.ts mind:self-evolve",
    "bun harness.ts mind:self-evolve --generation 1 --cycle 2",
  ],
  handler: mindSelfEvolveCommand,
};

export const MIND_STRATEGIC_COGNITION_COMMAND_SPEC: CommandSpec = {
  name: "mind:strategic-cognition",
  aliases: ["mind-strategic-cognition", "mind:proactive-plan"],
  domain: "mind",
  summary: "Execute proactive strategic cognition during subordinate execution windows.",
  description:
    "Channels Mind cognitive bandwidth at 30,000 feet into macro DAG diagnostics (P = W/S), backlog grooming, candidate admission, and proactive roadmap planning for future fleets.",
  flags: [
    optionalFlag(
      "window-hours",
      "int",
      "Subordinate execution window duration in hours (default: 2).",
      2,
    ),
    optionalFlag("fleet-id", "string", "Target fleet identifier for proactive roadmap."),
    optionalFlag("json", "bool", "Output structured JSON."),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    "bun harness.ts mind:strategic-cognition",
    "bun harness.ts mind:strategic-cognition --window-hours 3 --fleet-id fleet-gen-5",
  ],
  handler: mindStrategicCognitionCommand,
};
