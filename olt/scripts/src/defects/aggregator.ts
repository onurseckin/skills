import { categorizeDefect } from "../mind/defects.ts";
import {
  calculateDefectSimilarity,
  computeDefectDiscriminator,
  normalizeObservationSignature,
} from "./discriminator.ts";
import type {
  AggregatedDefect,
  DefectAggregateMetrics,
  DefectCategory,
  DefectKeyOptions,
  DefectOccurrence,
  DefectRecordInput,
  DefectStatus,
  LiveDeduplicationOptions,
} from "./types.ts";

const SEVERITY_WEIGHTS: Readonly<Record<string, number>> = {
  critical: 5,
  high: 4,
  warning: 3,
  low: 2,
  info: 1,
};

function pickHigherSeverity(sevA: string, sevB: string): string {
  const weightA = SEVERITY_WEIGHTS[sevA.toLowerCase()] ?? 0;
  const weightB = SEVERITY_WEIGHTS[sevB.toLowerCase()] ?? 0;
  return weightB > weightA ? sevB.toLowerCase() : sevA.toLowerCase();
}

function mergeStatus(
  statusA: DefectStatus,
  statusB: DefectStatus | string | undefined,
): DefectStatus {
  const normB = typeof statusB === "string" ? statusB.toLowerCase().trim() : "";
  if (statusA === "resolved" || normB === "resolved") {
    return "resolved";
  }
  if (
    statusA === "wontfix" ||
    normB === "wontfix" ||
    normB === "wont_fix" ||
    normB === "wont-fix"
  ) {
    return "wontfix";
  }
  return "open";
}

function parseIsoMs(iso: string | undefined): number {
  if (typeof iso !== "string" || !iso) return Date.now();
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function withinDeduplicationWindow(
  timestampA: string,
  timestampB: string,
  windowMs: number,
): boolean {
  if (windowMs <= 0) return true;
  const msA = parseIsoMs(timestampA);
  const msB = parseIsoMs(timestampB);
  return Math.abs(msA - msB) <= windowMs;
}

export function toAggregatedDefect(
  input: DefectRecordInput,
  options: { readonly keyOptions?: DefectKeyOptions | undefined } = {},
): AggregatedDefect {
  const dedupKey = computeDefectDiscriminator(input, options.keyOptions);
  const timestamp = input.timestamp ?? new Date().toISOString();
  const id = input.id ?? `defect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const count = typeof input.count === "number" && input.count > 0 ? input.count : 1;
  const firstSeen = input.first_seen_at ?? timestamp;
  const lastSeen = input.last_seen_at ?? timestamp;

  const rawCat = typeof input.category === "string" ? input.category.toLowerCase().trim() : "";
  const category: DefectCategory =
    rawCat === "boundary_violation" || rawCat === "role_confusion"
      ? "boundary_violation"
      : rawCat === "model_reasoning_error"
        ? "model_reasoning_error"
        : rawCat === "code_defect"
          ? "code_defect"
          : categorizeDefect(input as unknown as Record<string, unknown>);

  const rawStat = typeof input.status === "string" ? input.status.toLowerCase().trim() : "open";
  const status: DefectStatus =
    rawStat === "resolved"
      ? "resolved"
      : rawStat === "wontfix" || rawStat === "wont_fix" || rawStat === "wont-fix"
        ? "wontfix"
        : "open";

  const observation = input.observation ?? input.message ?? "";
  const remediation = input.remediation ?? input.prescribed_remediation ?? "";
  const initialOccurrence: DefectOccurrence = {
    timestamp,
    ...(input.pid !== undefined ? { pid: input.pid } : {}),
    ...(input.ppid !== undefined ? { ppid: input.ppid } : {}),
    ...(input.agent_id !== undefined ? { agent_id: input.agent_id } : {}),
    ...(observation ? { detail: observation } : {}),
  };

  const occurrences =
    Array.isArray(input.occurrences) && input.occurrences.length > 0
      ? input.occurrences
      : [initialOccurrence];

  return {
    id,
    dedup_key: dedupKey,
    type:
      typeof input.type === "string" && input.type.length > 0 ? input.type : "unspecified_defect",
    severity: input.severity ? input.severity.toLowerCase() : "warning",
    category,
    status,
    timestamp,
    first_seen_at: firstSeen,
    last_seen_at: lastSeen,
    count,
    observation,
    remediation,
    ...(input.message !== undefined ? { message: input.message } : {}),
    ...(input.prescribed_remediation !== undefined
      ? { prescribed_remediation: input.prescribed_remediation }
      : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.agent_id !== undefined ? { agent_id: input.agent_id } : {}),
    ...(input.pid !== undefined ? { pid: input.pid } : {}),
    ...(input.ppid !== undefined ? { ppid: input.ppid } : {}),
    ...(input.context !== undefined ? { context: input.context } : {}),
    occurrences,
    ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
    ...(input.capsule_root !== undefined ? { capsule_root: input.capsule_root } : {}),
  };
}

export function aggregateDefectEntries(
  target: AggregatedDefect,
  incoming: DefectRecordInput,
  options: { readonly maxOccurrences?: number | undefined } = {},
): AggregatedDefect {
  const maxOccurrences = options.maxOccurrences ?? 50;
  const incomingCount =
    typeof incoming.count === "number" && incoming.count > 0 ? incoming.count : 1;
  const newCount = target.count + incomingCount;

  const inTs = incoming.timestamp ?? new Date().toISOString();
  const inFirst = incoming.first_seen_at ?? inTs;
  const inLast = incoming.last_seen_at ?? inTs;

  const firstSeen =
    parseIsoMs(inFirst) < parseIsoMs(target.first_seen_at) ? inFirst : target.first_seen_at;
  const lastSeen =
    parseIsoMs(inLast) > parseIsoMs(target.last_seen_at) ? inLast : target.last_seen_at;

  const incomingSev =
    typeof incoming.severity === "string" && incoming.severity.length > 0
      ? incoming.severity
      : "warning";
  const severity = pickHigherSeverity(target.severity, incomingSev);
  const status = mergeStatus(target.status, incoming.status);
  const resolution = incoming.resolution ?? target.resolution ?? null;

  const newOccurrence: DefectOccurrence = {
    timestamp: inTs,
    ...(incoming.pid !== undefined ? { pid: incoming.pid } : {}),
    ...(incoming.ppid !== undefined ? { ppid: incoming.ppid } : {}),
    ...(incoming.agent_id !== undefined ? { agent_id: incoming.agent_id } : {}),
    ...(incoming.observation ? { detail: incoming.observation } : {}),
  };

  const incomingOccurrences = Array.isArray(incoming.occurrences)
    ? incoming.occurrences
    : [newOccurrence];
  const combinedOccurrences = [...(target.occurrences ?? []), ...incomingOccurrences].slice(
    -maxOccurrences,
  );

  const mergedContext =
    target.context || incoming.context
      ? { ...(target.context ?? {}), ...(incoming.context ?? {}) }
      : undefined;

  return {
    ...target,
    severity,
    status,
    timestamp: inTs,
    first_seen_at: firstSeen,
    last_seen_at: lastSeen,
    count: newCount,
    occurrences: combinedOccurrences,
    ...(mergedContext !== undefined ? { context: mergedContext } : {}),
    ...(resolution ? { resolution } : {}),
  };
}

/**
 * Merges two collections of defects into a single deduplicated list.
 */
export function mergeDefectSets(
  primary: readonly AggregatedDefect[],
  incoming: readonly (AggregatedDefect | DefectRecordInput)[],
  options: LiveDeduplicationOptions = {},
): AggregatedDefect[] {
  const map = new Map<string, AggregatedDefect>();
  const maxOccurrences = options.maxOccurrencesTracked ?? 50;

  for (const b of primary) {
    if (!b) continue;
    map.set(b.dedup_key, b);
  }

  for (const item of incoming) {
    if (!item) continue;
    const key = computeDefectDiscriminator(item, options.keyOptions);
    const existing = map.get(key);
    if (!existing) {
      map.set(
        key,
        toAggregatedDefect(
          item,
          options.keyOptions !== undefined ? { keyOptions: options.keyOptions } : {},
        ),
      );
    } else {
      map.set(key, aggregateDefectEntries(existing, item, { maxOccurrences }));
    }
  }

  return Array.from(map.values());
}

/**
 * Computes statistical aggregate metrics over a collection of defect records.
 */
export function calculateDefectAggregateMetrics(
  defects: readonly (AggregatedDefect | DefectRecordInput)[],
): DefectAggregateMetrics {
  let totalRecorded = 0;
  let openCount = 0;
  let resolvedCount = 0;
  let wontfixCount = 0;
  let recurrenceCount = 0;

  const categoryCounts: Record<DefectCategory, number> = {
    code_defect: 0,
    model_reasoning_error: 0,
    boundary_violation: 0,
  };

  const severityCounts: Record<string, number> = {};
  let totalResolutionTimeMs = 0;
  let resolvedWithTimeCount = 0;

  for (const b of defects) {
    if (!b) continue;
    const count = typeof b.count === "number" && b.count > 0 ? b.count : 1;
    totalRecorded += count;
    if (count > 1) {
      recurrenceCount += count - 1;
    }

    const normStatus = typeof b.status === "string" ? b.status.toLowerCase().trim() : "open";
    if (normStatus === "resolved") {
      resolvedCount += 1;
      if (b.resolution && b.resolution.resolved_at && b.first_seen_at) {
        const start = parseIsoMs(b.first_seen_at);
        const end = parseIsoMs(b.resolution.resolved_at);
        if (end >= start) {
          totalResolutionTimeMs += end - start;
          resolvedWithTimeCount += 1;
        }
      }
    } else if (normStatus === "wontfix" || normStatus === "wont_fix") {
      wontfixCount += 1;
    } else {
      openCount += 1;
    }

    const rawCat = typeof b.category === "string" ? b.category.toLowerCase().trim() : "";
    const cat: DefectCategory =
      rawCat === "boundary_violation" || rawCat === "role_confusion"
        ? "boundary_violation"
        : rawCat === "model_reasoning_error"
          ? "model_reasoning_error"
          : rawCat === "code_defect"
            ? "code_defect"
            : categorizeDefect(b as unknown as Record<string, unknown>);

    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;

    const sev = typeof b.severity === "string" ? b.severity.toLowerCase().trim() : "warning";
    severityCounts[sev] = (severityCounts[sev] ?? 0) + 1;
  }

  const uniqueCount = defects.length;
  const recurrenceRate = totalRecorded > 0 ? recurrenceCount / totalRecorded : 0;
  const meanTimeToResolutionMs =
    resolvedWithTimeCount > 0 ? totalResolutionTimeMs / resolvedWithTimeCount : null;

  return {
    total_recorded: totalRecorded,
    unique_defects: uniqueCount,
    open_count: openCount,
    resolved_count: resolvedCount,
    wontfix_count: wontfixCount,
    recurrence_count: recurrenceCount,
    recurrence_rate: recurrenceRate,
    by_category: categoryCounts,
    by_severity: severityCounts,
    mean_time_to_resolution_ms: meanTimeToResolutionMs,
  };
}

/**
 * Clusters an array of aggregated defects based on semantic similarity of their observations.
 */
export function clusterDefectsBySimilarity(
  defects: readonly AggregatedDefect[],
  similarityThreshold: number = 0.5,
): ReadonlyArray<readonly AggregatedDefect[]> {
  const clusters: AggregatedDefect[][] = [];

  for (const defect of defects) {
    if (!defect) continue;
    let placed = false;

    const sig = normalizeObservationSignature(defect.observation || defect.type);
    for (const cluster of clusters) {
      const representative = cluster[0];
      if (representative) {
        const repSig = normalizeObservationSignature(
          representative.observation || representative.type,
        );
        const sim = calculateDefectSimilarity(sig, repSig);
        if (sim >= similarityThreshold && defect.category === representative.category) {
          cluster.push(defect);
          placed = true;
          break;
        }
      }
    }

    if (!placed) {
      clusters.push([defect]);
    }
  }

  return clusters;
}
