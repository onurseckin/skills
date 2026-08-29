import { isRecord } from "../../../requirements/predicates.ts";
import { statusGlyph } from "../../../summary/graph/index.ts";

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

    const glyph = statusGlyph(t.status, t.deps.length > 0);
    if (
      t.assignedAgent &&
      (t.status === "leased" || t.status === "running" || t.status === "validating")
    ) {
      const roleStr = t.role ? ` (${t.role})` : "";
      badges.push(`[W${wave}:L${curLane} ${glyph} ${t.assignedAgent}${roleStr} @ ${t.id}]`);
    } else {
      badges.push(`[W${wave}:L${curLane} ${glyph} ${t.id}]`);
    }
  }

  return badges;
}
