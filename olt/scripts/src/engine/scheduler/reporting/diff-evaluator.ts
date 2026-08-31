import { isRecord } from "../../../requirements/predicates.ts";
import type { QuotaBudgetBadgeItem } from "../diagnostics/ascii-badges.ts";
import type {
  SchedulerAgentSummary,
  SchedulerProgressDiff,
  SchedulerProgressSnapshot,
  SchedulerTaskSummary,
  SchedulerWaveGroupSummary,
} from "./types.ts";

function isCompletedStatus(status: string): boolean {
  return (
    status === "completed" ||
    status === "done" ||
    status === "passed" ||
    status === "verified" ||
    status === "submitted"
  );
}

function isLeasedStatus(status: string): boolean {
  return status === "leased" || status === "running" || status === "validating";
}

function isFailedStatus(status: string): boolean {
  return status === "failed" || status === "rejected" || status === "stale" || status === "dead";
}

export function extractSchedulerSnapshot(
  state: Record<string, unknown>,
  options?:
    | {
        readonly runRoot?: string | undefined;
        readonly nowMs?: number | undefined;
        readonly budget?: QuotaBudgetBadgeItem | undefined;
      }
    | undefined,
): SchedulerProgressSnapshot {
  const capturedAt = new Date(options?.nowMs ?? Date.now()).toISOString();
  const runRoot = options?.runRoot ?? (typeof state.run_id === "string" ? state.run_id : "unknown");

  const taskMap = isRecord(state.tasks) ? (state.tasks as Record<string, unknown>) : {};
  const planningBuffer = Array.isArray(state.planning_buffer)
    ? (state.planning_buffer as readonly unknown[])
    : [];

  const rawTasks: {
    id: string;
    status: string;
    deps: readonly string[];
    effort: number;
    assignedAgent: string | null;
    role: string | null;
    writeScope: readonly string[];
  }[] = [];

  const isCompiled = isRecord(state.graph) || Object.keys(taskMap).length > 0;

  if (isCompiled && Object.keys(taskMap).length > 0) {
    for (const [id, t] of Object.entries(taskMap)) {
      if (!isRecord(t)) continue;
      const status = typeof t.status === "string" ? t.status : "proposed";
      const deps = Array.isArray(t.dependencies)
        ? t.dependencies.filter((d): d is string => typeof d === "string")
        : Array.isArray(t.deps)
          ? t.deps.filter((d): d is string => typeof d === "string")
          : [];
      const effort = typeof t.effort === "number" ? t.effort : 1;
      const lease = isRecord(t.lease) ? t.lease : null;
      const assignedAgent = lease
        ? typeof lease.agent_id === "string" && lease.agent_id.trim().length > 0
          ? lease.agent_id.trim()
          : typeof lease.agent === "string" && lease.agent.trim().length > 0
            ? lease.agent.trim()
            : null
        : typeof t.assignedAgent === "string"
          ? t.assignedAgent
          : null;
      const role = lease && typeof lease.role === "string" ? lease.role : null;
      const writeScope = Array.isArray(t.write_scope)
        ? t.write_scope.filter((w): w is string => typeof w === "string")
        : [];
      rawTasks.push({ id, status, deps, effort, assignedAgent, role, writeScope });
    }
  } else if (planningBuffer.length > 0) {
    for (const item of planningBuffer) {
      if (!isRecord(item)) continue;
      const id = typeof item.id === "string" ? item.id : "task";
      const deps = Array.isArray(item.deps)
        ? item.deps.filter((d): d is string => typeof d === "string")
        : [];
      const effort = typeof item.effort === "number" ? item.effort : 1;
      const writeScope = Array.isArray(item.write_scope)
        ? item.write_scope.filter((w): w is string => typeof w === "string")
        : Array.isArray(item.writeScope)
          ? item.writeScope.filter((w): w is string => typeof w === "string")
          : [];
      rawTasks.push({
        id,
        status: "draft",
        deps,
        effort,
        assignedAgent: null,
        role: null,
        writeScope,
      });
    }
  }

  // Compute topological wave map
  const waveMap = new Map<string, number>();
  const depMap = new Map<string, Set<string>>();
  for (const t of rawTasks) {
    depMap.set(t.id, new Set(t.deps));
  }

  let curWave = 1;
  const processed = new Set<string>();
  while (processed.size < rawTasks.length) {
    const readyInWave: string[] = [];
    for (const t of rawTasks) {
      if (processed.has(t.id)) continue;
      const prereqs = depMap.get(t.id) ?? new Set<string>();
      if ([...prereqs].every((p) => waveMap.has(p))) {
        readyInWave.push(t.id);
      }
    }
    if (readyInWave.length === 0) {
      for (const t of rawTasks) {
        if (!processed.has(t.id)) {
          waveMap.set(t.id, curWave);
          processed.add(t.id);
        }
      }
      break;
    }
    for (const id of readyInWave) {
      waveMap.set(id, curWave);
      processed.add(id);
    }
    curWave++;
  }

  const totalWaves = Math.max(1, curWave - 1);

  // Group into lane indexed tasks
  const waveLaneCounters = new Map<number, number>();
  const tasks: SchedulerTaskSummary[] = rawTasks.map((t) => {
    const wave = waveMap.get(t.id) ?? 1;
    const curLane = (waveLaneCounters.get(wave) ?? 0) + 1;
    waveLaneCounters.set(wave, curLane);
    return {
      id: t.id,
      status: t.status,
      effort: t.effort,
      dependencies: t.deps,
      assignedAgent: t.assignedAgent,
      role: t.role,
      wave,
      lane: curLane,
      writeScope: t.writeScope,
    };
  });

  // Extract active agents
  const rawAgents = Array.isArray(state.agents)
    ? (state.agents as readonly Record<string, unknown>[])
    : [];
  const activeAgents: SchedulerAgentSummary[] = [];
  for (const a of rawAgents) {
    if (!isRecord(a)) continue;
    if (a.status === undefined || a.status === "active") {
      const id = typeof a.id === "string" ? a.id : "unknown";
      const role = typeof a.role === "string" ? a.role : "agent";
      const host = typeof a.host === "string" ? a.host : "unknown";
      const parentTaskId = typeof a.parent_task_id === "string" ? a.parent_task_id : null;
      const assignedTask = tasks.find((t) => t.assignedAgent === id) ?? null;
      const taskId = assignedTask ? assignedTask.id : parentTaskId;
      activeAgents.push({
        id,
        role,
        host,
        status: "active",
        task_id: taskId,
      });
    }
  }

  // Group wave summaries
  const waveGroups: SchedulerWaveGroupSummary[] = [];
  for (let w = 1; w <= totalWaves; w++) {
    const tasksInWave = tasks.filter((t) => t.wave === w);
    if (tasksInWave.length > 0) {
      const statusSet = new Set(tasksInWave.map((t) => t.status));
      const isActive = tasksInWave.some((t) => isLeasedStatus(t.status));
      waveGroups.push({
        wave: w,
        laneCount: tasksInWave.length,
        status: [...statusSet].join("/"),
        isActive,
        taskIds: tasksInWave.map((t) => t.id),
      });
    }
  }

  const completedTasks = tasks.filter((t) => isCompletedStatus(t.status)).length;
  const leasedTasks = tasks.filter((t) => isLeasedStatus(t.status)).length;
  const readyTasks = tasks.filter((t) => t.status === "ready").length;
  const proposedTasks = tasks.filter((t) => t.status === "proposed" || t.status === "draft").length;
  const failedTasks = tasks.filter((t) => isFailedStatus(t.status)).length;

  let activeWave: number | null = null;
  for (let w = 1; w <= totalWaves; w++) {
    const waveTasks = tasks.filter((t) => t.wave === w);
    if (waveTasks.some((t) => !isCompletedStatus(t.status))) {
      activeWave = w;
      break;
    }
  }

  const quotaUsedToday =
    typeof options?.budget?.pulsesToday === "number" ? options.budget.pulsesToday : 0;
  const quotaLimitToday =
    options?.budget?.pulsesPerDay === null || options?.budget?.pulsesPerDay === undefined
      ? null
      : options.budget.pulsesPerDay;
  const wallClockMsToday =
    typeof options?.budget?.wallClockMsToday === "number" ? options.budget.wallClockMsToday : 0;

  return {
    capturedAt,
    runRoot,
    totalTasks: tasks.length,
    completedTasks,
    leasedTasks,
    readyTasks,
    proposedTasks,
    failedTasks,
    tasks,
    activeAgents,
    waves: waveGroups,
    activeWave,
    totalWaves,
    quotaUsedToday,
    quotaLimitToday,
    wallClockMsToday,
  };
}

export function evaluateProgressDiff(
  current: SchedulerProgressSnapshot,
  previous?: SchedulerProgressSnapshot | null,
  previousStreak: number = 0,
): SchedulerProgressDiff {
  if (!previous) {
    return {
      hasPrevious: false,
      completedDelta: 0,
      newlyCompletedTaskIds: [],
      newlyLeasedTaskIds: [],
      newlyFailedTaskIds: [],
      newlyReadyTaskIds: [],
      agentDelta: current.activeAgents.length,
      activeWaveChanged: false,
      previousActiveWave: null,
      currentActiveWave: current.activeWave,
      isZeroProgress: false,
      consecutiveZeroProgressTicks: 0,
      summary: `Initial snapshot: ${current.completedTasks}/${current.totalTasks} tasks done, ${current.leasedTasks} leased, ${current.activeAgents.length} active agents across ${current.totalWaves} waves.`,
    };
  }

  const prevTaskMap = new Map(previous.tasks.map((t) => [t.id, t]));
  const newlyCompletedTaskIds: string[] = [];
  const newlyLeasedTaskIds: string[] = [];
  const newlyFailedTaskIds: string[] = [];
  const newlyReadyTaskIds: string[] = [];

  for (const t of current.tasks) {
    const prev = prevTaskMap.get(t.id);
    if (!prev) {
      if (isCompletedStatus(t.status)) newlyCompletedTaskIds.push(t.id);
      if (isLeasedStatus(t.status)) newlyLeasedTaskIds.push(t.id);
      if (isFailedStatus(t.status)) newlyFailedTaskIds.push(t.id);
      if (t.status === "ready") newlyReadyTaskIds.push(t.id);
    } else {
      if (!isCompletedStatus(prev.status) && isCompletedStatus(t.status)) {
        newlyCompletedTaskIds.push(t.id);
      }
      if (!isLeasedStatus(prev.status) && isLeasedStatus(t.status)) {
        newlyLeasedTaskIds.push(t.id);
      }
      if (!isFailedStatus(prev.status) && isFailedStatus(t.status)) {
        newlyFailedTaskIds.push(t.id);
      }
      if (prev.status !== "ready" && t.status === "ready") {
        newlyReadyTaskIds.push(t.id);
      }
    }
  }

  const completedDelta = current.completedTasks - previous.completedTasks;
  const agentDelta = current.activeAgents.length - previous.activeAgents.length;
  const activeWaveChanged = current.activeWave !== previous.activeWave;

  const isZeroProgress =
    newlyCompletedTaskIds.length === 0 &&
    newlyLeasedTaskIds.length === 0 &&
    newlyFailedTaskIds.length === 0 &&
    newlyReadyTaskIds.length === 0 &&
    !activeWaveChanged;

  const consecutiveZeroProgressTicks = isZeroProgress ? previousStreak + 1 : 0;

  const summaryParts: string[] = [];
  if (newlyCompletedTaskIds.length > 0) {
    summaryParts.push(
      `+${newlyCompletedTaskIds.length} completed (${newlyCompletedTaskIds.join(", ")})`,
    );
  }
  if (newlyLeasedTaskIds.length > 0) {
    summaryParts.push(`+${newlyLeasedTaskIds.length} leased (${newlyLeasedTaskIds.join(", ")})`);
  }
  if (newlyReadyTaskIds.length > 0) {
    summaryParts.push(`+${newlyReadyTaskIds.length} ready (${newlyReadyTaskIds.join(", ")})`);
  }
  if (newlyFailedTaskIds.length > 0) {
    summaryParts.push(`!${newlyFailedTaskIds.length} failed (${newlyFailedTaskIds.join(", ")})`);
  }
  if (activeWaveChanged) {
    summaryParts.push(
      `Wave advanced: W${previous.activeWave ?? "?"} -> W${current.activeWave ?? "all complete"}`,
    );
  }
  if (agentDelta !== 0) {
    summaryParts.push(`${agentDelta > 0 ? `+${agentDelta}` : `${agentDelta}`} agents`);
  }

  const summary =
    summaryParts.length > 0
      ? summaryParts.join(" | ")
      : `No task transitions (streak: ${consecutiveZeroProgressTicks})`;

  return {
    hasPrevious: true,
    completedDelta,
    newlyCompletedTaskIds,
    newlyLeasedTaskIds,
    newlyFailedTaskIds,
    newlyReadyTaskIds,
    agentDelta,
    activeWaveChanged,
    previousActiveWave: previous.activeWave,
    currentActiveWave: current.activeWave,
    isZeroProgress,
    consecutiveZeroProgressTicks,
    summary,
  };
}
