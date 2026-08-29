/**
 * Dynamic DAG Builder
 */
import type { HarnessEvent } from "../../core/contracts/index.ts";
import { replayTelemetryEvent, type ReplayContext } from "./event-replayer.ts";
import type {
  ActiveAgentState,
  DynamicDagState,
  DynamicTaskState,
  SproutedRepairPair,
} from "./types.ts";

export { buildStepTraceEntries } from "./step-extractor.ts";
export { createSproutedRepairBranch } from "./sprout-builder.ts";
export { replayTelemetryEvent } from "./event-replayer.ts";

/**
 * Builds dynamic DAG expansion state by replaying capsule telemetry events.
 */
export function buildDynamicDagState(
  events: readonly HarnessEvent[],
  runId = "capsule-run",
): DynamicDagState {
  const taskMap = new Map<string, DynamicTaskState>();
  const agentMap = new Map<string, ActiveAgentState>();
  const branches = new Set<string>();
  const sproutedRepairPairs: SproutedRepairPair[] = [];

  const ctx: ReplayContext = {
    taskMap,
    agentMap,
    branches,
    sproutedRepairPairs,
    revision: 1,
    maxRoundReached: 1,
  };

  for (const ev of events) {
    replayTelemetryEvent(ev, ctx);
  }

  let staticCount = 0;
  let dynamicCount = 0;
  let repairBranchesCount = 0;
  for (const t of taskMap.values()) {
    if (t.origin === "static") staticCount += 1;
    else if (t.origin === "repair_branch") repairBranchesCount += 1;
    else dynamicCount += 1;
  }

  return {
    runId,
    revision: ctx.revision,
    totalTasks: taskMap.size,
    staticTasksCount: staticCount,
    dynamicTasksCount: dynamicCount + repairBranchesCount,
    repairBranchesCount,
    currentRound: ctx.maxRoundReached,
    tasks: taskMap,
    activeAgents: agentMap,
    activeBranches: [...branches],
    sproutedRepairPairs,
  };
}
