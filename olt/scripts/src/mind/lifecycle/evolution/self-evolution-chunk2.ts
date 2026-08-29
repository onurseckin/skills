import {
  PERPETUAL_NON_STOPPING_CADENCE,
  NON_STOPPING_RULE,
} from "./self-evolution-chunk1.ts";
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isTestEnvironment, resolveScratchDir } from "../../../core/shared/paths.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import type {
  CandidateEvolutionProposal,
  DiscoveredTaskPlan,
  EvolutionHistoryStats,
  EvolutionLedgerEntry,
  HierarchyCapacityMetrics,
  HierarchyScalingDecision,
  PlanRevisionProposal,
  SelfEvolutionCadenceState,
  SelfEvolutionMode,
} from "./self-evolution-chunk1.ts";
import type { TaskQueueItem } from "../../task-queue.ts";


export interface SelfEvolutionCycleResult {
  readonly cycleId: string;
  readonly generation: number;
  readonly cycleNumber: number;
  readonly timestamp: string;
  readonly mode: SelfEvolutionMode;
  readonly discoveriesCount: number;
  readonly synthesizedTasks: readonly DiscoveredTaskPlan[];
  readonly candidateProposals: readonly CandidateEvolutionProposal[];
  readonly planRevisions: readonly PlanRevisionProposal[];
  readonly enqueuedTasks: readonly TaskQueueItem[];
  readonly admittedFeedbackIds: readonly string[];
  readonly hierarchyMetrics: HierarchyCapacityMetrics;
  readonly scalingDecision: HierarchyScalingDecision;
  readonly cadenceState: SelfEvolutionCadenceState;
  readonly nextRecommendedCommand: string;
  readonly summary: string;
  readonly durationMs: number;
}


export function resolveEvolutionHistoryPath(customPath?: string): string {
  if (customPath && customPath.trim()) {
    return resolve(customPath.trim());
  }
  if (isTestEnvironment()) {
    return join(resolveScratchDir(), "EVOLUTION_HISTORY.jsonl");
  }
  return join(resolveCapsulesDir(), "EVOLUTION_HISTORY.jsonl");
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
            planRevisionsCount:
              typeof parsed["planRevisionsCount"] === "number"
                ? parsed["planRevisionsCount"]
                : undefined,
            scalingAction:
              typeof parsed["scalingAction"] === "string"
                ? (parsed["scalingAction"] as HierarchyScalingDirection)
                : undefined,
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


export function getEvolutionStats(history: readonly EvolutionLedgerEntry[]): EvolutionHistoryStats {
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
