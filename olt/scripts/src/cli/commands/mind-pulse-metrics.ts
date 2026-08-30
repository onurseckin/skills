export interface MindPulseWorkSpanMetrics {
  readonly total_work: number;
  readonly span: number;
  readonly parallelism_factor: number;
  readonly optimal_concurrency: number;
  readonly active_concurrency: number;
}

export interface MindPulseActiveAgentCoordinate {
  readonly agent_id: string;
  readonly role: string;
  readonly host: string;
  readonly task_id: string | null;
  readonly wave: number | null;
  readonly lane: number | null;
  readonly coordinate_badge: string;
}

export interface MindPulseWaveLaneInfo {
  readonly wave: number;
  readonly lane_count: number;
  readonly status: string;
  readonly is_active: boolean;
}

export interface MindCognitiveTelemetry {
  readonly workSpan: MindPulseWorkSpanMetrics;
  readonly activeAgents: readonly MindPulseActiveAgentCoordinate[];
  readonly waveLanes: readonly MindPulseWaveLaneInfo[];
}

export function computeMindCognitiveTelemetry(
  state: Record<string, unknown>,
): MindCognitiveTelemetry {
  const taskMap = (state.tasks && typeof state.tasks === "object" ? state.tasks : {}) as Record<
    string,
    unknown
  >;
  const planningBuffer = Array.isArray(state.planning_buffer)
    ? (state.planning_buffer as readonly Record<string, unknown>[])
    : [];

  const rawTasks: {
    readonly id: string;
    readonly deps: readonly string[];
    readonly effort: number;
    readonly status: string;
    readonly assignedAgent: string | null;
    readonly assignedRole: string | null;
  }[] = [];

  const isCompiled = state.graph !== undefined && state.graph !== null;

  if (isCompiled && Object.keys(taskMap).length > 0) {
    for (const [id, t] of Object.entries(taskMap)) {
      if (!t || typeof t !== "object") continue;
      const tRecord = t as Record<string, unknown>;
      const status = typeof tRecord.status === "string" ? tRecord.status : "proposed";
      const deps = Array.isArray(tRecord.dependencies)
        ? tRecord.dependencies.filter((d): d is string => typeof d === "string")
        : [];
      const effort = typeof tRecord.effort === "number" ? tRecord.effort : 1;
      const lease =
        tRecord.lease && typeof tRecord.lease === "object"
          ? (tRecord.lease as Record<string, unknown>)
          : null;
      const assignedAgent =
        lease && typeof lease.agent_id === "string" && lease.agent_id.trim().length > 0
          ? lease.agent_id.trim()
          : lease && typeof lease.agent === "string" && lease.agent.trim().length > 0
            ? lease.agent.trim()
            : null;
      const assignedRole =
        lease && typeof lease.role === "string" ? lease.role : assignedAgent ? "implementer" : null;

      rawTasks.push({
        id,
        deps,
        effort,
        status,
        assignedAgent,
        assignedRole,
      });
    }
  } else if (planningBuffer.length > 0) {
    for (const item of planningBuffer) {
      if (!item || typeof item !== "object") continue;
      const id = typeof item.id === "string" ? item.id : "task";
      const deps = Array.isArray(item.deps)
        ? item.deps.filter((d): d is string => typeof d === "string")
        : [];
      const effort = typeof item.effort === "number" ? item.effort : 1;
      rawTasks.push({
        id,
        deps,
        effort,
        status: "draft",
        assignedAgent: null,
        assignedRole: null,
      });
    }
  }

  const waveMap = new Map<string, number>();
  const depMap = new Map<string, Set<string>>();
  for (const t of rawTasks) {
    depMap.set(t.id, new Set(t.deps));
  }

  let currentWave = 1;
  const processed = new Set<string>();
  while (processed.size < rawTasks.length) {
    const readyInThisWave: string[] = [];
    for (const t of rawTasks) {
      if (processed.has(t.id)) continue;
      const prereqs = depMap.get(t.id) ?? new Set<string>();
      const allDone = [...prereqs].every((p) => waveMap.has(p));
      if (allDone) {
        readyInThisWave.push(t.id);
      }
    }

    if (readyInThisWave.length === 0) {
      for (const t of rawTasks) {
        if (!processed.has(t.id)) {
          waveMap.set(t.id, currentWave);
          processed.add(t.id);
        }
      }
      break;
    }

    for (const id of readyInThisWave) {
      waveMap.set(id, currentWave);
      processed.add(id);
    }
    currentWave += 1;
  }

  const maxWave = Math.max(1, currentWave - 1);

  const waveGroups: {
    wave: number;
    tasks: {
      id: string;
      status: string;
      effort: number;
      assignedAgent: string | null;
      assignedRole: string | null;
      lane: number;
    }[];
  }[] = [];

  for (let w = 1; w <= maxWave; w++) {
    const tasksInW = rawTasks.filter((t) => (waveMap.get(t.id) ?? 1) === w);
    if (tasksInW.length > 0) {
      waveGroups.push({
        wave: w,
        tasks: tasksInW.map((t, idx) => ({ ...t, lane: idx + 1 })),
      });
    }
  }

  const totalWork = rawTasks.reduce((acc, t) => acc + t.effort, 0);
  const span = rawTasks.length > 0 ? maxWave : 1;
  const parallelismFactor = span > 0 && totalWork > 0 ? Number((totalWork / span).toFixed(2)) : 1;
  const optimalConcurrency = Math.max(1, Math.min(8, Math.ceil(totalWork / span)));

  const rawAgents = (Array.isArray(state.agents) ? state.agents : []) as readonly Record<
    string,
    unknown
  >[];
  const activeAgents: MindPulseActiveAgentCoordinate[] = [];

  for (const a of rawAgents) {
    if (!a || typeof a !== "object") continue;
    if (a.status === "active") {
      const agentId = typeof a.id === "string" ? a.id : "unknown";
      const role = typeof a.role === "string" ? a.role : "agent";
      const host = typeof a.host === "string" ? a.host : "unknown";

      let assignedTask: { id: string; wave: number; lane: number; status: string } | null = null;
      for (const wg of waveGroups) {
        for (const t of wg.tasks) {
          if (t.assignedAgent === agentId) {
            assignedTask = { id: t.id, wave: wg.wave, lane: t.lane, status: t.status };
            break;
          }
        }
        if (assignedTask) break;
      }

      if (!assignedTask && typeof a.parent_task_id === "string") {
        const pId = a.parent_task_id;
        for (const wg of waveGroups) {
          for (const t of wg.tasks) {
            if (t.id === pId) {
              assignedTask = { id: t.id, wave: wg.wave, lane: t.lane, status: t.status };
              break;
            }
          }
          if (assignedTask) break;
        }
      }

      let coordBadge: string;
      if (assignedTask) {
        const actionPrefix = assignedTask.status === "validating" ? "VALIDATING" : "LEASED";
        coordBadge = `[⚡ ${actionPrefix}: ${agentId} (${role}) @ ${assignedTask.id} [W${assignedTask.wave}:L${assignedTask.lane}]]`;
      } else {
        coordBadge = `[● ${role.toUpperCase()}: ${agentId}]`;
      }

      activeAgents.push({
        agent_id: agentId,
        role,
        host,
        task_id: assignedTask?.id ?? null,
        wave: assignedTask?.wave ?? null,
        lane: assignedTask?.lane ?? null,
        coordinate_badge: coordBadge,
      });
    }
  }

  const waveLanes: MindPulseWaveLaneInfo[] = waveGroups.map((wg) => ({
    wave: wg.wave,
    lane_count: wg.tasks.length,
    status: [...new Set(wg.tasks.map((t) => t.status))].join("/"),
    is_active: wg.tasks.some(
      (t) => t.status === "leased" || t.status === "running" || t.status === "validating",
    ),
  }));

  const workSpan: MindPulseWorkSpanMetrics = {
    total_work: totalWork,
    span,
    parallelism_factor: parallelismFactor,
    optimal_concurrency: optimalConcurrency,
    active_concurrency: activeAgents.length,
  };

  return {
    workSpan,
    activeAgents,
    waveLanes,
  };
}
