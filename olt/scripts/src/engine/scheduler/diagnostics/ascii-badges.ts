import { isRecord } from "../../../requirements/predicates.ts";
import { statusGlyph } from "../../../summary/graph/index.ts";

export interface TaskBadgeItem {
  readonly id: string;
  readonly status: string;
  readonly deps?: readonly string[] | undefined;
  readonly assignedAgent?: string | null | undefined;
  readonly role?: string | null | undefined;
  readonly wave?: number | null | undefined;
  readonly lane?: number | null | undefined;
}

export interface AgentBadgeItem {
  readonly id: string;
  readonly role: string;
  readonly host?: string | undefined;
  readonly status?: string | undefined;
  readonly task_id?: string | null | undefined;
}

export interface QuotaBudgetBadgeItem {
  readonly pulsesToday?: number | undefined;
  readonly pulsesPerDay?: number | null | undefined;
  readonly wallClockMsToday?: number | undefined;
  readonly wallClockMsPerDay?: number | null | undefined;
  readonly remainingQuotaPercent?: number | null | undefined;
}

export interface WaveLaneBadgeItem {
  readonly wave: number;
  readonly lane_count: number;
  readonly status: string;
  readonly is_active: boolean;
}

function normalizeStatus(status: string): string {
  const s = status.toLowerCase().trim();
  if (s === "completed" || s === "passed" || s === "verified" || s === "submitted") return "done";
  return s;
}

export function generateTaskStateBadge(task: TaskBadgeItem): string {
  const hasDeps = Array.isArray(task.deps) && task.deps.length > 0;
  const glyph = statusGlyph(normalizeStatus(task.status), hasDeps);
  const wavePrefix =
    typeof task.wave === "number" && typeof task.lane === "number"
      ? `W${task.wave}:L${task.lane} `
      : typeof task.wave === "number"
        ? `W${task.wave} `
        : "";

  if (
    task.assignedAgent &&
    (task.status === "leased" || task.status === "running" || task.status === "validating")
  ) {
    const roleStr = task.role ? ` (${task.role})` : "";
    return `[${wavePrefix}${glyph} ${task.assignedAgent}${roleStr} @ ${task.id}]`;
  }
  return `[${wavePrefix}${glyph} ${task.id}]`;
}

export function generateAgentStatusBadge(agents: readonly AgentBadgeItem[]): string {
  const activeAgents = agents.filter((a) => a.status === undefined || a.status === "active");
  if (activeAgents.length === 0) {
    return "[🤖 Agents: 0 active]";
  }
  const summary = activeAgents
    .map((a) => {
      const taskSuffix = a.task_id ? ` @ ${a.task_id}` : "";
      return `${a.id} (${a.role}${taskSuffix})`;
    })
    .join(", ");
  return `[🤖 Agents (${activeAgents.length}): ${summary}]`;
}

export function generateQuotaBudgetBadge(budget: QuotaBudgetBadgeItem): string {
  const pulsesToday = typeof budget.pulsesToday === "number" ? budget.pulsesToday : 0;
  const pulsesLimitStr =
    budget.pulsesPerDay === null || budget.pulsesPerDay === undefined
      ? "∞"
      : String(budget.pulsesPerDay);
  const parts = [`${pulsesToday}/${pulsesLimitStr} pulses`];

  if (typeof budget.remainingQuotaPercent === "number") {
    const pct = Math.max(0, Math.min(100, budget.remainingQuotaPercent)).toFixed(0);
    parts.push(`${pct}% headroom`);
  }

  if (typeof budget.wallClockMsToday === "number") {
    const mins = Math.round(budget.wallClockMsToday / 60000);
    if (typeof budget.wallClockMsPerDay === "number" && budget.wallClockMsPerDay > 0) {
      const limitMins = Math.round(budget.wallClockMsPerDay / 60000);
      parts.push(`${mins}m/${limitMins}m wall-clock`);
    } else {
      parts.push(`${mins}m wall-clock`);
    }
  }

  return `[⏳ Quota: ${parts.join(" | ")}]`;
}

export function generateWaveLaneBadges(waveLanes: readonly WaveLaneBadgeItem[]): readonly string[] {
  return waveLanes.map((w) => {
    const activeMark = w.is_active ? " ⚡" : "";
    return `[Wave ${w.wave}: ${w.lane_count} lane(s) (${w.status})${activeMark}]`;
  });
}

export function generateStagnationBadge(
  zeroValueStreak: number,
  isStagnating?: boolean | undefined,
): string {
  if (isStagnating || zeroValueStreak >= 3) {
    return `[🚨 Stagnation Warning: streak ${zeroValueStreak}]`;
  }
  if (zeroValueStreak > 0) {
    return `[⚠️ Idling: streak ${zeroValueStreak}]`;
  }
  return "[✨ Flowing: active progress]";
}

export interface TelemetryBannerParams {
  readonly dagBadges?: readonly string[] | undefined;
  readonly agentBadge?: string | undefined;
  readonly waveBadge?: string | undefined;
  readonly quotaBadge?: string | undefined;
  readonly stagnationBadge?: string | undefined;
}

export function generateSchedulerTelemetryBanner(params: TelemetryBannerParams): string {
  const parts: string[] = [];
  if (params.stagnationBadge) parts.push(params.stagnationBadge);
  if (params.quotaBadge) parts.push(params.quotaBadge);
  if (params.agentBadge) parts.push(params.agentBadge);
  if (params.waveBadge) parts.push(params.waveBadge);
  if (params.dagBadges && params.dagBadges.length > 0) {
    parts.push(params.dagBadges.join(" "));
  }
  return parts.join(" | ");
}

export function generateAsciiDagBadges(
  stateOrTasks: unknown,
  providedWaveMap?: ReadonlyMap<string, number>,
): readonly string[] {
  const badges: string[] = [];

  let rawTasks: {
    id: string;
    status: string;
    deps: readonly string[];
    assignedAgent: string | null;
    role: string | null;
  }[] = [];

  if (Array.isArray(stateOrTasks)) {
    rawTasks = stateOrTasks.map((t) => {
      if (isRecord(t)) {
        const id = typeof t.id === "string" ? t.id : "unknown";
        const status = typeof t.status === "string" ? t.status : "proposed";
        const deps = Array.isArray(t.dependencies)
          ? t.dependencies.filter((d): d is string => typeof d === "string")
          : Array.isArray(t.deps)
            ? t.deps.filter((d): d is string => typeof d === "string")
            : [];
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
        return { id, status, deps, assignedAgent, role };
      }
      return { id: String(t), status: "proposed", deps: [], assignedAgent: null, role: null };
    });
  } else if (isRecord(stateOrTasks) && isRecord(stateOrTasks.tasks)) {
    for (const [id, t] of Object.entries(stateOrTasks.tasks)) {
      if (isRecord(t)) {
        const status = typeof t.status === "string" ? t.status : "proposed";
        const deps = Array.isArray(t.dependencies)
          ? t.dependencies.filter((d): d is string => typeof d === "string")
          : [];
        const lease = isRecord(t.lease) ? t.lease : null;
        const assignedAgent = lease
          ? typeof lease.agent_id === "string" && lease.agent_id.trim().length > 0
            ? lease.agent_id.trim()
            : typeof lease.agent === "string" && lease.agent.trim().length > 0
              ? lease.agent.trim()
              : null
          : null;
        const role = lease && typeof lease.role === "string" ? lease.role : null;
        rawTasks.push({ id, status, deps, assignedAgent, role });
      }
    }
  }

  if (rawTasks.length === 0) {
    return [];
  }

  // Compute wave map if not provided
  const waveMap = new Map<string, number>();
  if (providedWaveMap) {
    for (const [k, v] of providedWaveMap) {
      waveMap.set(k, v);
    }
  } else {
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
  }

  // Assign lane index per wave
  const waveLaneCounters = new Map<number, number>();
  for (const t of rawTasks) {
    const wave = waveMap.get(t.id) ?? 1;
    const curLane = (waveLaneCounters.get(wave) ?? 0) + 1;
    waveLaneCounters.set(wave, curLane);

    const badge = generateTaskStateBadge({
      id: t.id,
      status: t.status,
      deps: t.deps,
      assignedAgent: t.assignedAgent,
      role: t.role,
      wave,
      lane: curLane,
    });
    badges.push(badge);
  }

  return badges;
}
