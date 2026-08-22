import { categorizeBlunder } from "../mind/blunders.ts";
import { computeBlunderDiscriminator } from "./discriminator.ts";
import type {
  AggregatedBlunder,
  BlunderCategory,
  BlunderKeyOptions,
  BlunderOccurrence,
  BlunderRecordInput,
  BlunderStatus,
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
  statusA: BlunderStatus,
  statusB: BlunderStatus | string | undefined,
): BlunderStatus {
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

export function toAggregatedBlunder(
  input: BlunderRecordInput,
  options: { readonly keyOptions?: BlunderKeyOptions | undefined } = {},
): AggregatedBlunder {
  const dedupKey = computeBlunderDiscriminator(input, options.keyOptions);
  const timestamp = input.timestamp ?? new Date().toISOString();
  const id = input.id ?? `blunder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const count = typeof input.count === "number" && input.count > 0 ? input.count : 1;
  const firstSeen = input.first_seen_at ?? timestamp;
  const lastSeen = input.last_seen_at ?? timestamp;

  const rawCat = typeof input.category === "string" ? input.category.toLowerCase().trim() : "";
  const category: BlunderCategory =
    rawCat === "boundary_violation" || rawCat === "role_confusion"
      ? "boundary_violation"
      : rawCat === "model_reasoning_error"
        ? "model_reasoning_error"
        : rawCat === "code_defect"
          ? "code_defect"
          : categorizeBlunder(input as unknown as Record<string, unknown>);

  const rawStat = typeof input.status === "string" ? input.status.toLowerCase().trim() : "open";
  const status: BlunderStatus =
    rawStat === "resolved"
      ? "resolved"
      : rawStat === "wontfix" || rawStat === "wont_fix" || rawStat === "wont-fix"
        ? "wontfix"
        : "open";

  const observation = input.observation ?? input.message ?? "";
  const remediation = input.remediation ?? input.prescribed_remediation ?? "";
  const initialOccurrence: BlunderOccurrence = {
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
    type: typeof input.type === "string" && input.type.length > 0 ? input.type : "unspecified_blunder",
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

export function aggregateBlunderEntries(
  target: AggregatedBlunder,
  incoming: BlunderRecordInput,
  options: { readonly maxOccurrences?: number | undefined } = {},
): AggregatedBlunder {
  const maxOccurrences = options.maxOccurrences ?? 50;
  const incomingCount =
    typeof incoming.count === "number" && incoming.count > 0 ? incoming.count : 1;
  const newCount = target.count + incomingCount;

  const inTs = incoming.timestamp ?? new Date().toISOString();
  const inFirst = incoming.first_seen_at ?? inTs;
  const inLast = incoming.last_seen_at ?? inTs;

  const firstSeen = parseIsoMs(inFirst) < parseIsoMs(target.first_seen_at)
    ? inFirst
    : target.first_seen_at;
  const lastSeen = parseIsoMs(inLast) > parseIsoMs(target.last_seen_at) ? inLast : target.last_seen_at;

  const incomingSev =
    typeof incoming.severity === "string" && incoming.severity.length > 0
      ? incoming.severity
      : "warning";
  const severity = pickHigherSeverity(target.severity, incomingSev);
  const status = mergeStatus(target.status, incoming.status);
  const resolution = incoming.resolution ?? target.resolution ?? null;

  const newOccurrence: BlunderOccurrence = {
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
