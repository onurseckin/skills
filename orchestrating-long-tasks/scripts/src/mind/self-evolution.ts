import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";
import { drainPendingFeedbacks, readFeedbackQueue, type FeedbackItem } from "./feedback-queue.ts";
import {
  applyIntervalJitter,
  calculateExponentialBackoff,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
} from "./interval.ts";
import {
  discoverTasks,
  type DiscoveredTaskPlan,
  type TaskDiscoveryOptions,
  type TaskDiscoveryResult,
} from "./task-discovery.ts";
import {
  enqueueTasksBatch,
  getQueueStats,
  readTaskQueue,
  type NewTaskQueueInput,
  type TaskPriority,
  type TaskQueueItem,
  type TaskQueueStats,
} from "./task-queue.ts";

export const PERPETUAL_NON_STOPPING_CADENCE = "infinite_autonomous" as const;
export const NON_STOPPING_RULE =
  "Autonomous perpetual Mind loops never terminate when idle; self-evolution engine continuously synthesizes improvement tasks" as const;
export const CLOSING_FORBIDDEN_IDLE_MIND =
  "Mind loop cannot be closed or terminated when idle; self-evolution engine must engage" as const;

export const DEFAULT_EVOLUTION_BASE_INTERVAL_MS = 900_000; // 15 minutes
export const DEFAULT_EVOLUTION_MAX_INTERVAL_MS = 14_400_000; // 4 hours

export type SelfEvolutionMode =
  | "MODE_A_AUTONOMIC_DISCOVERY"
  | "MODE_B_FEEDBACK_INTAKE"
  | "MODE_C_INVARIANT_HARDENING"
  | "QUEUE_ACTIVE";

export type CadencePhase =
  | "IDLE"
  | "DISCOVERING"
  | "SYNTHESIZING"
  | "ENQUEUING"
  | "EVOLVING"
  | "EVALUATING"
  | "PERPETUAL_REST";

export interface SelfEvolutionCadenceState {
  readonly generation: number;
  readonly cycle: number;
  readonly phase: CadencePhase;
  readonly lastCycleAt: string | null;
  readonly consecutiveIdlePulses: number;
  readonly totalTasksSynthesized: number;
  readonly totalTasksCompleted: number;
  readonly quiescenceStreak: number;
  readonly currentIntervalMs: number;
  readonly nextWakeAt: string;
  readonly infiniteCadenceEnforced: true;
}

export interface PerpetualCadenceEvaluation {
  readonly cadence: typeof PERPETUAL_NON_STOPPING_CADENCE;
  readonly mode: SelfEvolutionMode;
  readonly canEvolve: boolean;
  readonly reason: string;
  readonly queueActive: boolean;
  readonly pendingFeedbackCount: number;
  readonly activeTasksCount: number;
  readonly nextWakeAt: string;
  readonly nextIntervalMs: number;
  readonly nextInstruction: string;
  readonly closing_permitted: false;
}

export interface EvolutionLedgerEntry {
  readonly cycleId: string;
  readonly generation: number;
  readonly cycleNumber: number;
  readonly timestamp: string;
  readonly mode: SelfEvolutionMode;
  readonly discoveriesCount: number;
  readonly taskIds: readonly string[];
  readonly feedbackIds: readonly string[];
  readonly durationMs: number;
  readonly summary: string;
}

export interface EvolutionHistoryStats {
  readonly totalCycles: number;
  readonly totalTasks: number;
  readonly totalFeedbackIngested: number;
  readonly cyclesByMode: Readonly<Record<SelfEvolutionMode, number>>;
}

export interface SelfEvolutionCycleOptions {
  readonly runRoot?: string | undefined;
  readonly actor?: string | undefined;
  readonly generation?: number | undefined;
  readonly cycleNumber?: number | undefined;
  readonly taskQueuePath?: string | undefined;
  readonly feedbackQueuePath?: string | undefined;
  readonly charterPath?: string | undefined;
  readonly historyPath?: string | undefined;
  readonly maxTasksPerCycle?: number | undefined;
  readonly autoEnqueue?: boolean | undefined;
  readonly baseIntervalMs?: number | undefined;
  readonly maxIntervalMs?: number | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly sourceRoots?: readonly string[] | undefined;
  readonly testRoots?: readonly string[] | undefined;
  readonly capsulesDir?: string | undefined;
  readonly now?: string | number | Date | undefined;
}

export interface SelfEvolutionCycleResult {
  readonly cycleId: string;
  readonly generation: number;
  readonly cycleNumber: number;
  readonly timestamp: string;
  readonly mode: SelfEvolutionMode;
  readonly discoveriesCount: number;
  readonly synthesizedTasks: readonly DiscoveredTaskPlan[];
  readonly enqueuedTasks: readonly TaskQueueItem[];
  readonly admittedFeedbackIds: readonly string[];
  readonly cadenceState: SelfEvolutionCadenceState;
  readonly nextRecommendedCommand: string;
  readonly summary: string;
  readonly durationMs: number;
}

const DEFAULT_HISTORY_FILE = ".capsules/EVOLUTION_HISTORY.jsonl";

export function resolveEvolutionHistoryPath(customPath?: string): string {
  if (customPath && customPath.trim()) {
    return resolve(customPath.trim());
  }
  const cwd = process.cwd();
  if (existsSync(join(cwd, ".capsules"))) {
    return join(cwd, DEFAULT_HISTORY_FILE);
  }
  return resolve(cwd, DEFAULT_HISTORY_FILE);
}

export function readEvolutionHistory(customPath?: string): readonly EvolutionLedgerEntry[] {
  const filePath = resolveEvolutionHistoryPath(customPath);
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const entries: EvolutionLedgerEntry[] = [];

    for (const line of lines) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (typeof parsed["cycleId"] === "string" && typeof parsed["mode"] === "string") {
          entries.push({
            cycleId: String(parsed["cycleId"]),
            generation: typeof parsed["generation"] === "number" ? parsed["generation"] : 1,
            cycleNumber: typeof parsed["cycleNumber"] === "number" ? parsed["cycleNumber"] : 1,
            timestamp:
              typeof parsed["timestamp"] === "string"
                ? parsed["timestamp"]
                : new Date().toISOString(),
            mode: parsed["mode"] as SelfEvolutionMode,
            discoveriesCount:
              typeof parsed["discoveriesCount"] === "number" ? parsed["discoveriesCount"] : 0,
            taskIds: Array.isArray(parsed["taskIds"])
              ? (parsed["taskIds"] as readonly string[])
              : [],
            feedbackIds: Array.isArray(parsed["feedbackIds"])
              ? (parsed["feedbackIds"] as readonly string[])
              : [],
            durationMs: typeof parsed["durationMs"] === "number" ? parsed["durationMs"] : 0,
            summary: typeof parsed["summary"] === "string" ? parsed["summary"] : "",
          });
        }
      } catch {
        // Skip malformed log line
      }
    }

    return entries;
  } catch {
    return [];
  }
}

export function recordEvolutionCycle(entry: EvolutionLedgerEntry, customPath?: string): void {
  const filePath = resolveEvolutionHistoryPath(customPath);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const line = JSON.stringify(entry) + "\n";
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  writeFileSync(filePath, existing + line, "utf8");
}

export function getEvolutionStats(
  history: readonly EvolutionLedgerEntry[],
): EvolutionHistoryStats {
  const cyclesByMode: Record<SelfEvolutionMode, number> = {
    MODE_A_AUTONOMIC_DISCOVERY: 0,
    MODE_B_FEEDBACK_INTAKE: 0,
    MODE_C_INVARIANT_HARDENING: 0,
    QUEUE_ACTIVE: 0,
  };

  let totalTasks = 0;
  let totalFeedback = 0;

  for (const entry of history) {
    if (cyclesByMode[entry.mode] !== undefined) {
      cyclesByMode[entry.mode]++;
    }
    totalTasks += entry.taskIds.length;
    totalFeedback += entry.feedbackIds.length;
  }

  return {
    totalCycles: history.length,
    totalTasks,
    totalFeedbackIngested: totalFeedback,
    cyclesByMode,
  };
}

/**
 * Enforces the perpetual non-stopping cadence invariant for the Mind loop.
 * Guarantees that no agent or process can terminate or close an idle Mind loop.
 */
export function enforcePerpetualNonStoppingCadence(params: {
  readonly actor: string;
  readonly runRoot?: string | undefined;
  readonly isTerminal?: boolean | undefined;
}): {
  readonly cadence: typeof PERPETUAL_NON_STOPPING_CADENCE;
  readonly allowed: boolean;
  readonly nextInstruction: string;
  readonly message: string;
  readonly closing_permitted: false;
} {
  const runArg = params.runRoot ? ` --run ${params.runRoot}` : "";
  const nextInstruction = `bun harness.ts mind:wake${runArg}`;

  return {
    cadence: PERPETUAL_NON_STOPPING_CADENCE,
    allowed: true,
    nextInstruction,
    message: NON_STOPPING_RULE,
    closing_permitted: false,
  };
}

/**
 * Evaluates current Mind cadence state to decide whether self-evolution should engage:
 * - If active tasks exist in queue -> Mode: QUEUE_ACTIVE
 * - If pending feedback exists -> Mode: MODE_B_FEEDBACK_INTAKE
 * - If task queue is empty and feedback queue is empty -> Mode: MODE_A_AUTONOMIC_DISCOVERY
 */
export function evaluatePerpetualCadence(params: {
  readonly taskQueuePath?: string | undefined;
  readonly feedbackQueuePath?: string | undefined;
  readonly state?: Partial<SelfEvolutionCadenceState> | undefined;
  readonly baseIntervalMs?: number | undefined;
  readonly maxIntervalMs?: number | undefined;
  readonly now?: string | number | Date | undefined;
  readonly runRoot?: string | undefined;
}): PerpetualCadenceEvaluation {
  const nowMs = params.now !== undefined ? new Date(params.now).getTime() : Date.now();
  const queueItems = readTaskQueue(params.taskQueuePath);
  const activeTasks = queueItems.filter(
    (t) => t.status === "PENDING" || t.status === "ADMITTED" || t.status === "IN_PROGRESS" || t.status === "RUNNING",
  );

  const feedbacks = readFeedbackQueue(params.feedbackQueuePath);
  const pendingFeedbacks = feedbacks.filter((f) => f.status === "PENDING");

  const baseInterval = params.baseIntervalMs ?? DEFAULT_EVOLUTION_BASE_INTERVAL_MS;
  const maxInterval = params.maxIntervalMs ?? DEFAULT_EVOLUTION_MAX_INTERVAL_MS;
  const streak = params.state?.quiescenceStreak ?? 0;

  const rawBackoff = calculateExponentialBackoff(baseInterval, maxInterval, streak);
  const nextIntervalMs = applyIntervalJitter(rawBackoff);
  const nextWakeAt = new Date(nowMs + nextIntervalMs).toISOString();
  const runArg = params.runRoot ? ` --run ${params.runRoot}` : "";

  if (activeTasks.length > 0) {
    return {
      cadence: PERPETUAL_NON_STOPPING_CADENCE,
      mode: "QUEUE_ACTIVE",
      canEvolve: false,
      reason: `Queue has ${activeTasks.length} active task(s) in progress; proceeding with task execution`,
      queueActive: true,
      pendingFeedbackCount: pendingFeedbacks.length,
      activeTasksCount: activeTasks.length,
      nextWakeAt,
      nextIntervalMs,
      nextInstruction: `bun harness.ts queue:wave${runArg}`,
      closing_permitted: false,
    };
  }

  if (pendingFeedbacks.length > 0) {
    return {
      cadence: PERPETUAL_NON_STOPPING_CADENCE,
      mode: "MODE_B_FEEDBACK_INTAKE",
      canEvolve: true,
      reason: `Found ${pendingFeedbacks.length} pending feedback item(s); initiating Mode B feedback intake`,
      queueActive: false,
      pendingFeedbackCount: pendingFeedbacks.length,
      activeTasksCount: 0,
      nextWakeAt,
      nextIntervalMs,
      nextInstruction: `bun harness.ts mind:self-evolve${runArg}`,
      closing_permitted: false,
    };
  }

  return {
    cadence: PERPETUAL_NON_STOPPING_CADENCE,
    mode: "MODE_A_AUTONOMIC_DISCOVERY",
    canEvolve: true,
    reason: "Task and feedback queues are clear; engaging Mode A autonomic task discovery",
    queueActive: false,
    pendingFeedbackCount: 0,
    activeTasksCount: 0,
    nextWakeAt,
    nextIntervalMs,
    nextInstruction: `bun harness.ts mind:self-evolve${runArg}`,
    closing_permitted: false,
  };
}

/**
 * Executes a full self-evolution cycle in an idle Mind loop:
 * 1. Evaluates perpetual cadence.
 * 2. If pending feedback exists, drains and admits feedback into tasks (Mode B).
 * 3. If idle, runs task-discovery engine scanning code quality, test coverage, dormant criteria (Mode A).
 * 4. Ensures Anti-Batching compliance and 1:1 implementer-validator separation.
 * 5. Enqueues synthesized tasks into the task queue.
 * 6. Records the evolution cycle in the evolution ledger.
 * 7. Returns structured cycle results and next perpetual instruction.
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
  });

  let mode: SelfEvolutionMode = evaluation.mode;
  let synthesizedTasks: readonly DiscoveredTaskPlan[] = [];
  let enqueuedTasks: readonly TaskQueueItem[] = [];
  const admittedFeedbackIds: string[] = [];
  let discoveriesCount = 0;

  if (mode === "MODE_B_FEEDBACK_INTAKE") {
    // Mode B: Discover tasks from pending feedback first, auto-enqueue if requested, then drain
    const discoveryResult = discoverTasks({
      feedbackQueuePath: options.feedbackQueuePath,
      taskQueuePath: options.taskQueuePath,
      enableCodeQualityScan: false,
      enableTestCoverageScan: false,
      enableDormantCriteriaScan: false,
      enableFeedbackQueueScan: true,
      enableBlunderScan: false,
      maxTasks,
      autoEnqueue: options.autoEnqueue !== false,
      actor: options.actor,
    });

    synthesizedTasks = discoveryResult.synthesizedPlans;
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
    // Mode A: Autonomic task discovery across code quality, test suites, dormant criteria
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
      enableDormantCriteriaScan: true,
      enableFeedbackQueueScan: false,
      enableBlunderScan: true,
      maxTasks,
      autoEnqueue: options.autoEnqueue !== false,
      actor: options.actor,
    });

    synthesizedTasks = discoveryResult.synthesizedPlans;
    enqueuedTasks = discoveryResult.enqueuedTasks;
    discoveriesCount = discoveryResult.discoveries.length;
    if (discoveryResult.discoveries.length === 0) {
      mode = "MODE_C_INVARIANT_HARDENING";
    }
  }

  const durationMs = Date.now() - startTime;
  const runArg = options.runRoot ? ` --run ${options.runRoot}` : "";
  const nextRecommendedCommand =
    enqueuedTasks.length > 0
      ? `bun harness.ts queue:wave${runArg}`
      : `bun harness.ts mind:wake${runArg}`;

  const summary = `Self-Evolution Cycle ${cycleId} (${mode}): synthesized ${synthesizedTasks.length} task(s), enqueued ${enqueuedTasks.length} into queue, ingested ${admittedFeedbackIds.length} feedback item(s) in ${durationMs}ms.`;

  // Update cadence state
  const cadenceState: SelfEvolutionCadenceState = {
    generation,
    cycle: cycleNumber,
    phase: enqueuedTasks.length > 0 ? "EVOLVING" : "PERPETUAL_REST",
    lastCycleAt: nowIso,
    consecutiveIdlePulses: enqueuedTasks.length === 0 ? (evaluation.activeTasksCount === 0 ? 1 : 0) : 0,
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
    enqueuedTasks,
    admittedFeedbackIds,
    cadenceState,
    nextRecommendedCommand,
    summary,
    durationMs,
  };
}

export const executeSelfEvolutionStep = runSelfEvolutionCycle;
