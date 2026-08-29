import { computeDefectDiscriminator } from "../mind/defects/core/index.ts";
import type {
  AggregatedDefect,
  DefectCategory,
  DefectKeyOptions,
  DefectOccurrence,
  DefectRecordInput,
  DefectStatus,
} from "../mind/defects/core/index.ts";
import type { LiveDeduplicationOptions } from "./types.ts";

export const SEVERITY_WEIGHTS: Readonly<Record<string, number>> = {
  critical: 5,
  high: 4,
  warning: 3,
  low: 2,
  info: 1,
};

export function pickHigherSeverity(sevA: string, sevB: string): string {
  const weightA = SEVERITY_WEIGHTS[sevA.toLowerCase()] ?? 0;
  const weightB = SEVERITY_WEIGHTS[sevB.toLowerCase()] ?? 0;
  return weightB > weightA ? sevB.toLowerCase() : sevA.toLowerCase();
}

export function mergeStatus(
  statusA: DefectStatus | string | undefined,
  statusB: DefectStatus | string | undefined,
): DefectStatus {
  const normA = typeof statusA === "string" ? statusA.toLowerCase().trim() : "";
  const normB = typeof statusB === "string" ? statusB.toLowerCase().trim() : "";
  if (normA === "resolved" || normB === "resolved") return "resolved";
  if (
    normA === "wontfix" ||
    normB === "wontfix" ||
    normA === "wont_fix" ||
    normB === "wont_fix" ||
    normA === "wont-fix" ||
    normB === "wont-fix"
  ) {
    return "wontfix";
  }
  return "open";
}

export function parseIsoMs(iso: string | undefined): number {
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
  return Math.abs(parseIsoMs(timestampA) - parseIsoMs(timestampB)) <= windowMs;
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
        : rawCat === "documentation"
          ? "documentation"
          : rawCat === "security_risk"
            ? "security_risk"
            : rawCat === "modularity_violation"
              ? "modularity_violation"
              : "code_defect";

  const rawStat = typeof input.status === "string" ? input.status.toLowerCase().trim() : "open";
  const status: DefectStatus =
    rawStat === "resolved"
      ? "resolved"
      : rawStat === "wontfix" || rawStat === "wont_fix" || rawStat === "wont-fix"
        ? "wontfix"
        : "open";

  const observation = input.observation ?? input.message ?? "";
  const initialOccurrence: DefectOccurrence = {
    timestamp,
    ...(input.pid !== undefined ? { pid: input.pid } : {}),
    ...(input.agent_id !== undefined ? { agent_id: input.agent_id } : {}),
    ...(observation ? { observation } : {}),
  };

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
    remediation: input.remediation ?? "",
    ...(input.message !== undefined ? { message: input.message } : {}),
    ...(input.agent_id !== undefined ? { agent_id: input.agent_id } : {}),
    ...(input.pid !== undefined ? { pid: input.pid } : {}),
    ...(input.context !== undefined ? { context: input.context } : {}),
    occurrences: [initialOccurrence],
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
  const inCount = typeof incoming.count === "number" && incoming.count > 0 ? incoming.count : 1;
  const inTs = incoming.timestamp ?? new Date().toISOString();
  const inFirst = incoming.first_seen_at ?? inTs;
  const inLast = incoming.last_seen_at ?? inTs;

  const firstSeen =
    parseIsoMs(inFirst) < parseIsoMs(target.first_seen_at) ? inFirst : target.first_seen_at;
  const lastSeen =
    parseIsoMs(inLast) > parseIsoMs(target.last_seen_at) ? inLast : target.last_seen_at;

  const inSev =
    typeof incoming.severity === "string" && incoming.severity.length > 0
      ? incoming.severity
      : "warning";
  const targetSev = typeof target.severity === "string" ? target.severity : "warning";
  const severity = pickHigherSeverity(targetSev, inSev);
  const status = mergeStatus(target.status, incoming.status);
  const resolution = incoming.resolution ?? target.resolution;

  const newOccurrence: DefectOccurrence = {
    timestamp: inTs,
    ...(incoming.pid !== undefined ? { pid: incoming.pid } : {}),
    ...(incoming.agent_id !== undefined ? { agent_id: incoming.agent_id } : {}),
    ...(incoming.observation ? { observation: incoming.observation } : {}),
  };

  const occurrences = [...(target.occurrences ?? []), newOccurrence].slice(-maxOccurrences);
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
    count: target.count + inCount,
    occurrences,
    ...(mergedContext !== undefined ? { context: mergedContext } : {}),
    ...(resolution !== undefined ? { resolution } : {}),
  };
}

export function deduplicateDefectLog(
  defects: readonly DefectRecordInput[],
  options: LiveDeduplicationOptions = {},
): AggregatedDefect[] {
  if (!Array.isArray(defects) || defects.length === 0) return [];

  const strategy = options.strategy ?? "aggregate_synchronous";
  const windowMs = options.windowMs ?? 60_000;
  const maxOccurrences = options.maxOccurrencesTracked ?? options.maxOccurrences ?? 50;

  if (strategy === "exact_dedup") {
    const seen = new Set<string>();
    const result: AggregatedDefect[] = [];
    for (const b of defects) {
      if (!b) continue;
      const key = computeDefectDiscriminator(b, options.keyOptions);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(
          toAggregatedDefect(
            b,
            options.keyOptions !== undefined ? { keyOptions: options.keyOptions } : {},
          ),
        );
      }
    }
    return result;
  }

  if (strategy === "windowed" || strategy === "sliding_window_hash") {
    const keyOpts =
      strategy === "sliding_window_hash"
        ? { ...(options.keyOptions ?? {}), useContentHash: true }
        : options.keyOptions;

    const result: AggregatedDefect[] = [];
    for (const b of defects) {
      if (!b) continue;
      const key = computeDefectDiscriminator(b, keyOpts);
      const incomingTs = b.timestamp ?? new Date().toISOString();
      const existingIdx = result.findLastIndex((entry) => entry.dedup_key === key);

      if (existingIdx >= 0) {
        const existing = result[existingIdx];
        if (existing && withinDeduplicationWindow(existing.last_seen_at, incomingTs, windowMs)) {
          const updated = aggregateDefectEntries(existing, b, { maxOccurrences });
          result[existingIdx] = updated;
          options.onDefectDeduplicated?.(updated, b);
          continue;
        }
      }

      const created = toAggregatedDefect(b, keyOpts !== undefined ? { keyOptions: keyOpts } : {});
      result.push(created);
      options.onNewDefect?.(created);
    }
    return result;
  }

  const map = new Map<string, AggregatedDefect>();
  for (const b of defects) {
    if (!b) continue;
    const key = computeDefectDiscriminator(b, options.keyOptions);
    const existing = map.get(key);
    if (!existing) {
      const created = toAggregatedDefect(
        b,
        options.keyOptions !== undefined ? { keyOptions: options.keyOptions } : {},
      );
      map.set(key, created);
      options.onNewDefect?.(created);
    } else {
      const updated = aggregateDefectEntries(existing, b, { maxOccurrences });
      map.set(key, updated);
      options.onDefectDeduplicated?.(updated, b);
    }
  }

  return Array.from(map.values());
}

export function parseAndDeduplicateDefectJsonl(
  jsonlContent: string,
  options: LiveDeduplicationOptions = {},
): AggregatedDefect[] {
  if (typeof jsonlContent !== "string" || !jsonlContent.trim()) return [];

  const rawLines = jsonlContent.split("\n");
  const inputs: DefectRecordInput[] = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        inputs.push(parsed as DefectRecordInput);
      }
    } catch {
      // Ignore unparseable lines gracefully
    }
  }

  return deduplicateDefectLog(inputs, options);
}

export function serializeAggregatedDefectLog(defects: readonly AggregatedDefect[]): string {
  if (!Array.isArray(defects) || defects.length === 0) return "";
  return `${defects.map((b) => JSON.stringify(b)).join("\n")}\n`;
}
