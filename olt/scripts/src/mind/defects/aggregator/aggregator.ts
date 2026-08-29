import { computeDefectDiscriminator } from "../core/discriminator.ts";
import { categorizeDefect } from "../core/sanitizer.ts";
import type {
  AggregatedDefect,
  DefectOccurrence,
  DefectRecordInput,
  DefectSeverity,
  DefectStatus,
  LiveDeduplicationOptions,
} from "../core/types.ts";

const SEVERITY_LEVELS: Record<DefectSeverity, number> = {
  low: 1,
  info: 1,
  warning: 2,
  medium: 2,
  high: 3,
  critical: 4,
};

export function pickHigherSeverity(
  s1?: DefectSeverity | string,
  s2?: DefectSeverity | string,
): DefectSeverity {
  const norm1 = (s1 || "warning").toLowerCase() as DefectSeverity;
  const norm2 = (s2 || "warning").toLowerCase() as DefectSeverity;
  const rank1 = SEVERITY_LEVELS[norm1] ?? 2;
  const rank2 = SEVERITY_LEVELS[norm2] ?? 2;
  return rank1 >= rank2 ? norm1 : norm2;
}

export function normalizeStatus(status?: string): DefectStatus {
  if (!status) return "open";
  const s = status.toLowerCase().trim();
  if (s === "wont_fix" || s === "wont-fix" || s === "wontfix") return "wontfix";
  if (s === "resolved" || s === "completed") return "resolved";
  return "open";
}

export function withinDeduplicationWindow(
  prevTimestamp: string | undefined,
  currTimestamp: string | undefined,
  windowMs: number,
): boolean {
  if (windowMs <= 0) return true;
  if (!prevTimestamp || !currTimestamp) return true;
  const t1 = Date.parse(prevTimestamp);
  const t2 = Date.parse(currTimestamp);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return true;
  return Math.abs(t2 - t1) <= windowMs;
}

export function toAggregatedDefect(input: DefectRecordInput): AggregatedDefect {
  const timestamp = input.timestamp || new Date().toISOString();
  const firstSeen = input.first_seen_at || timestamp;
  const lastSeen = input.last_seen_at || timestamp;
  const id = input.id || `defect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dedupKey = input.dedup_key || computeDefectDiscriminator(input);
  const rawSev = input.severity || "warning";
  const severity = rawSev.toLowerCase().trim() as DefectSeverity;
  const category = categorizeDefect(input);
  const status = normalizeStatus(input.status);
  const remediation = input.remediation || input.prescribed_remediation || undefined;

  let occurrences: DefectOccurrence[] = [];
  if (Array.isArray(input.occurrences) && input.occurrences.length > 0) {
    occurrences = [...input.occurrences];
  } else {
    occurrences = [
      {
        timestamp,
        ...(input.pid !== undefined ? { pid: input.pid } : {}),
        ...(input.agent_id !== undefined ? { agent_id: input.agent_id } : {}),
        ...(input.context !== undefined ? { context: input.context } : {}),
      },
    ];
  }

  return {
    id,
    dedup_key: dedupKey,
    type: input.type || "unknown_defect",
    category,
    severity,
    status,
    observation: input.observation || input.message || "",
    count: input.count ?? occurrences.length,
    first_seen_at: firstSeen,
    last_seen_at: lastSeen,
    occurrences,
    ...(remediation !== undefined ? { remediation } : {}),
    ...(input.agent_id !== undefined ? { agent_id: input.agent_id } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
    ...(input.capsule_root !== undefined ? { capsule_root: input.capsule_root } : {}),
    ...(input.context !== undefined ? { context: input.context } : {}),
  };
}

export function aggregateDefectEntries(
  target: AggregatedDefect,
  incoming: DefectRecordInput,
  options: LiveDeduplicationOptions = {},
): AggregatedDefect {
  const maxOccurrences = options.maxOccurrences ?? 50;
  const incomingTs = incoming.timestamp || new Date().toISOString();
  const lastSeen =
    Date.parse(incomingTs) > Date.parse(target.last_seen_at) ? incomingTs : target.last_seen_at;

  const incFirst = incoming.first_seen_at || incoming.timestamp || incomingTs;
  const firstSeen =
    Date.parse(incFirst) < Date.parse(target.first_seen_at) ? incFirst : target.first_seen_at;
  const newCount = target.count + (incoming.count ?? 1);
  const severity = pickHigherSeverity(
    (target.severity || "warning") as DefectSeverity,
    (incoming.severity || "warning") as DefectSeverity,
  );

  let status = target.status;
  if (incoming.status) {
    const incStatus = normalizeStatus(incoming.status);
    if (target.status === "open" && incStatus !== "open") status = incStatus;
    else if (target.status !== "resolved" && incStatus === "resolved") status = "resolved";
    else if (incStatus === "wontfix") status = "wontfix";
  }

  const newOccurrences: DefectOccurrence[] = [...target.occurrences];
  if (Array.isArray(incoming.occurrences) && incoming.occurrences.length > 0) {
    newOccurrences.push(...incoming.occurrences);
  } else {
    newOccurrences.push({
      timestamp: incomingTs,
      ...(incoming.pid !== undefined ? { pid: incoming.pid } : {}),
      ...(incoming.agent_id !== undefined ? { agent_id: incoming.agent_id } : {}),
      ...(incoming.context !== undefined ? { context: incoming.context } : {}),
    });
  }

  const boundedOccurrences = newOccurrences.slice(-maxOccurrences);

  const context = incoming.context
    ? { ...(target.context || {}), ...incoming.context }
    : target.context;
  return {
    ...target,
    severity,
    status,
    count: newCount,
    first_seen_at: firstSeen,
    last_seen_at: lastSeen,
    occurrences: boundedOccurrences,
    ...(incoming.remediation ? { remediation: incoming.remediation } : {}),
    ...(incoming.resolution ? { resolution: incoming.resolution } : {}),
    ...(context !== undefined ? { context } : {}),
  };
}

export function mergeDefectSets(
  setA: readonly AggregatedDefect[],
  setB: readonly AggregatedDefect[],
  options: LiveDeduplicationOptions = {},
): AggregatedDefect[] {
  const map = new Map<string, AggregatedDefect>();
  for (const item of setA) {
    const key = item.dedup_key || computeDefectDiscriminator(item);
    map.set(key, item);
  }
  for (const item of setB) {
    const key = item.dedup_key || computeDefectDiscriminator(item);
    const existing = map.get(key);
    if (existing) {
      map.set(key, aggregateDefectEntries(existing, item, options));
    } else {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}
