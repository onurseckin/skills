import { calculateDefectSimilarity, normalizeObservationSignature } from "../core/discriminator.ts";
import { categorizeDefect } from "../core/sanitizer.ts";
import type {
  AggregatedDefect,
  DefectCategory,
  DefectEntry,
  DefectRecordInput,
} from "../core/types.ts";

export interface DefectMetricsResult {
  readonly total_recorded: number;
  readonly unique_defects: number;
  readonly open_count: number;
  readonly resolved_count: number;
  readonly wontfix_count: number;
  readonly recurrence_count: number;
  readonly recurrence_rate: number;
  readonly by_category: Readonly<Record<DefectCategory, number>>;
  readonly by_severity: Readonly<Record<string, number>>;
  readonly mean_time_to_resolution_ms: number | null;
}

function parseIsoMs(iso?: string): number {
  if (!iso || typeof iso !== "string") return 0;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function calculateDefectAggregateMetrics(
  defects: readonly (AggregatedDefect | DefectRecordInput | DefectEntry)[],
): DefectMetricsResult {
  let totalRecorded = 0;
  let openCount = 0;
  let resolvedCount = 0;
  let wontfixCount = 0;
  let recurrenceCount = 0;

  const categoryCounts: Record<DefectCategory, number> = {
    boundary_violation: 0,
    model_reasoning_error: 0,
    code_defect: 0,
    documentation: 0,
    security_risk: 0,
    modularity_violation: 0,
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
    if (normStatus === "resolved" || normStatus === "completed" || normStatus === "closed") {
      resolvedCount += 1;
      const res = b.resolution || b.resolution_proof;
      const resTime = res?.resolved_at;
      const firstSeen = b.first_seen_at || b.first_seen || b.timestamp;
      if (resTime && firstSeen) {
        const start = parseIsoMs(firstSeen);
        const end = parseIsoMs(resTime);
        if (end >= start && start > 0) {
          totalResolutionTimeMs += end - start;
          resolvedWithTimeCount += 1;
        }
      }
    } else if (normStatus === "wontfix" || normStatus === "wont_fix" || normStatus === "declined") {
      wontfixCount += 1;
    } else {
      openCount += 1;
    }

    const rawCat = typeof b.category === "string" ? b.category.toLowerCase().trim() : "";
    const cat: DefectCategory =
      rawCat === "boundary_violation"
        ? "boundary_violation"
        : rawCat === "model_reasoning_error"
          ? "model_reasoning_error"
          : rawCat === "code_defect"
            ? "code_defect"
            : categorizeDefect(b as DefectEntry);

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
        const repSig = normalizeObservationSignature(representative.observation || representative.type);
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
