import { createHash } from "node:crypto";
import type {
  AggregatedDefect,
  DefectCategory,
  DefectEntry,
  DefectKeyOptions,
  DefectOccurrence,
  DefectRecordInput,
  DefectStatus,
  LiveDeduplicationOptions,
} from "./types.ts";

export const SEVERITY_WEIGHTS: Readonly<Record<string, number>> = {
  critical: 5,
  high: 4,
  warning: 3,
  low: 2,
  info: 1,
};
export function pickHigherSeverity(sA: string, sB: string): string {
  const wA = SEVERITY_WEIGHTS[sA.toLowerCase()] ?? 0,
    wB = SEVERITY_WEIGHTS[sB.toLowerCase()] ?? 0;
  return wB > wA ? sB.toLowerCase() : sA.toLowerCase();
}
export function mergeStatus(
  sA: DefectStatus | string | undefined,
  sB: DefectStatus | string | undefined,
): DefectStatus {
  const nA = typeof sA === "string" ? sA.toLowerCase().trim() : "",
    nB = typeof sB === "string" ? sB.toLowerCase().trim() : "";
  if (nA === "resolved" || nB === "resolved" || nA === "completed" || nB === "completed")
    return "resolved";
  if (
    ["wontfix", "wont_fix", "wont-fix"].includes(nA) ||
    ["wontfix", "wont_fix", "wont-fix"].includes(nB)
  )
    return "wontfix";
  return "open";
}

export function parseIsoMs(iso: string | undefined): number {
  if (!iso) return Date.now();
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function withinDeduplicationWindow(tA: string, tB: string, windowMs: number): boolean {
  return windowMs <= 0 || Math.abs(parseIsoMs(tA) - parseIsoMs(tB)) <= windowMs;
}

export function normalizeObservationSignature(obs?: string): string {
  if (!obs) return "";
  return obs
    .toLowerCase()
    .trim()
    .replace(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z?/gi, "<time>")
    .replace(/\b[0-9a-fA-F]{16,64}\b/g, "<hash>")
    .replace(/0x[0-9a-fA-F]+/g, "<addr>")
    .replace(/pid\s*[:=]?\s*\d+/gi, "pid=<pid>")
    .replace(/line\s*[:=]?\s*\d+/gi, "line=<num>")
    .replace(/(?:\/[^/\s]+)*\/\.capsules\/[^\s/]+/g, "<capsule_path>")
    .replace(/defect-\d+-[a-zA-Z0-9]+/g, "defect-<id>")
    .replace(/\s+/g, " ");
}

export function createFnv1aHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createSha256Hash(str: string): string {
  return createHash("sha256").update(str).digest("hex");
}

export function createDefectContentHash(
  d: DefectRecordInput,
  alg: "fnv1a" | "sha256" = "sha256",
): string {
  const role = (d as { role?: string }).role || (d as { actor?: string }).actor;
  const cat = d.category || (role ? `role:${role}` : ""),
    typ = d.type || d.message || "";
  const obs = normalizeObservationSignature(d.observation || d.message || "");
  return alg === "fnv1a"
    ? createFnv1aHash(`${cat}::${typ}::${obs}`)
    : createSha256Hash(`${cat}::${typ}::${obs}`);
}

export function categorizeDefect(
  d: DefectEntry | DefectRecordInput | Record<string, unknown>,
): DefectCategory {
  const item = d as Record<string, unknown>;
  const explicit = String(item["category"] || "")
    .toLowerCase()
    .trim();
  if (["boundary_violation", "role_confusion", "confinement_breach", "leak"].includes(explicit))
    return "boundary_violation";
  if (["model_reasoning_error", "hallucination", "reasoning_drift", "drift"].includes(explicit))
    return "model_reasoning_error";
  if (["code_defect", "syntax_error", "type_error"].includes(explicit)) return "code_defect";
  if (["documentation", "security_risk", "modularity_violation"].includes(explicit))
    return explicit as DefectCategory;
  const text =
    `${String(item["id"] || "")} ${String(item["type"] || item["error_code"] || "")} ${String(item["observation"] || item["description"] || item["message"] || "")} ${String(item["remediation"] || item["prescribed_remediation"] || "")}`
      .toLowerCase()
      .replace(/[_-]/g, " ");
  if (
    [
      "boundary",
      "confusion",
      "leak",
      "unauthorized",
      "restraint",
      "escalation",
      "breach",
      "tier escaped",
      "permission denied",
      "direct execution",
      "direct file",
      "without subagent",
      "human shell",
      "thread restraint",
      "sandbox escape",
      "role amnesia",
      "identity and role",
      "spillover",
      "whoami",
      "non implementation",
      "write scope",
    ].some((k) => text.includes(k))
  )
    return "boundary_violation";
  if (
    [
      "hallucination",
      "drift",
      "self critique",
      "context loss",
      "paralysis",
      "idle death",
      "incorrect premise",
      "wrong premise",
      "illogical",
      "logic inconsistency",
      "invalid assumption",
      "passive inertia",
      "self termination",
      "sleep loop",
      "consciousness",
      "reasoning error",
      "reasoning",
    ].some((k) => text.includes(k))
  )
    return "model_reasoning_error";
  return "code_defect";
}

export function computeDefectDiscriminator(
  d: DefectRecordInput,
  opts: DefectKeyOptions = {},
): string {
  if (d.dedup_key && !opts.customDiscriminator) return d.dedup_key;
  if (opts.customDiscriminator) return opts.customDiscriminator(d);
  const cat =
    opts.includeCategory === false ? "any" : (d.category || "code_defect").toLowerCase().trim();
  const typ =
    opts.includeType === false ? "any" : (d.type || "unknown_defect").toLowerCase().trim();
  let agentId = "all";
  if (opts.includeAgentId !== false) {
    if (d.agent_id) agentId = d.agent_id.toLowerCase().trim();
    else {
      const role = (d as { role?: string }).role || (d as { actor?: string }).actor;
      if (role) agentId = `role:${role}`.toLowerCase().trim();
    }
  }
  if (opts.useContentHash)
    return `${cat}::${typ}::${agentId}::${createDefectContentHash(d, opts.hashAlgorithm || "fnv1a")}`;
  const sig =
    opts.normalizeObservation === false
      ? d.observation || d.message || typ
      : normalizeObservationSignature(d.observation || d.message || typ);
  return `${cat}::${typ}::${agentId}::${sig}`;
}
export const computeDefectDedupKey = computeDefectDiscriminator;

export function toAggregatedDefect(
  inp: DefectRecordInput,
  opts: { readonly keyOptions?: DefectKeyOptions | undefined } = {},
): AggregatedDefect {
  const dedupKey = computeDefectDiscriminator(inp, opts.keyOptions),
    timestamp = inp.timestamp ?? new Date().toISOString();
  const id = inp.id ?? `defect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    count = typeof inp.count === "number" && inp.count > 0 ? inp.count : 1;
  const category = categorizeDefect(inp),
    rawStat = typeof inp.status === "string" ? inp.status.toLowerCase().trim() : "open";
  const status: DefectStatus =
    rawStat === "resolved" || rawStat === "completed"
      ? "resolved"
      : ["wontfix", "wont_fix", "wont-fix"].includes(rawStat)
        ? "wontfix"
        : "open";
  const obs = inp.observation ?? inp.message ?? "",
    rem = inp.remediation ?? inp.prescribed_remediation ?? "";
  const occurrences: DefectOccurrence[] =
    Array.isArray(inp.occurrences) && inp.occurrences.length > 0
      ? inp.occurrences.map((o) => (typeof o === "string" ? { timestamp: o } : o))
      : [
          {
            timestamp,
            ...(inp.pid !== undefined ? { pid: inp.pid } : {}),
            ...(inp.agent_id !== undefined ? { agent_id: inp.agent_id } : {}),
            ...(obs ? { observation: obs } : {}),
          },
        ];
  return {
    id,
    dedup_key: dedupKey,
    type: typeof inp.type === "string" && inp.type.length > 0 ? inp.type : "unspecified_defect",
    severity: inp.severity ? inp.severity.toLowerCase() : "warning",
    category,
    status,
    timestamp,
    first_seen_at: inp.first_seen_at ?? timestamp,
    last_seen_at: inp.last_seen_at ?? timestamp,
    count,
    observation: obs,
    remediation: rem,
    ...(inp.message !== undefined ? { message: inp.message } : {}),
    ...(inp.agent_id !== undefined ? { agent_id: inp.agent_id } : {}),
    ...(inp.pid !== undefined ? { pid: inp.pid } : {}),
    ...(inp.context !== undefined ? { context: inp.context } : {}),
    occurrences,
    ...(inp.resolution !== undefined ? { resolution: inp.resolution } : {}),
    ...(inp.capsule_root !== undefined ? { capsule_root: inp.capsule_root } : {}),
  };
}

export function aggregateDefectEntries(
  target: AggregatedDefect,
  incoming: DefectRecordInput,
  opts: { readonly maxOccurrences?: number | undefined; readonly runId?: string | undefined } = {},
): AggregatedDefect {
  const maxOccurrences = opts.maxOccurrences ?? 50,
    inCount = typeof incoming.count === "number" && incoming.count > 0 ? incoming.count : 1;
  const inTs = incoming.timestamp ?? new Date().toISOString(),
    inFirst = incoming.first_seen_at ?? inTs,
    inLast = incoming.last_seen_at ?? inTs;
  const firstSeen =
    parseIsoMs(inFirst) < parseIsoMs(target.first_seen_at) ? inFirst : target.first_seen_at;
  const lastSeen =
    parseIsoMs(inLast) > parseIsoMs(target.last_seen_at) ? inLast : target.last_seen_at;
  const inSev =
    typeof incoming.severity === "string" && incoming.severity.length > 0
      ? incoming.severity
      : "warning";
  const severity = pickHigherSeverity(
    typeof target.severity === "string" ? target.severity : "warning",
    inSev,
  );
  const status = mergeStatus(target.status, incoming.status),
    resolution = incoming.resolution ?? target.resolution;
  const newOccurrence: DefectOccurrence = {
    timestamp: inTs,
    ...(incoming.pid !== undefined ? { pid: incoming.pid } : {}),
    ...(incoming.agent_id !== undefined ? { agent_id: incoming.agent_id } : {}),
    ...(incoming.observation ? { observation: incoming.observation } : {}),
    ...(opts.runId ? { metadata: { run_id: opts.runId } } : {}),
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

export function mergeDuplicateDefect(
  existing: AggregatedDefect,
  incoming: DefectRecordInput,
  runId?: string,
): AggregatedDefect {
  return aggregateDefectEntries(existing, incoming, { runId });
}

export function deduplicateDefectLog(
  defects: readonly DefectRecordInput[],
  opts: LiveDeduplicationOptions = {},
): AggregatedDefect[] {
  if (!Array.isArray(defects) || defects.length === 0) return [];
  const strat = opts.strategy ?? "aggregate_synchronous",
    winMs = opts.windowMs ?? 60_000,
    maxOcc = opts.maxOccurrencesTracked ?? opts.maxOccurrences ?? 50;
  if (strat === "exact_dedup") {
    const seen = new Set<string>(),
      res: AggregatedDefect[] = [];
    for (const b of defects) {
      if (!b) continue;
      const key = computeDefectDiscriminator(b, opts.keyOptions);
      if (!seen.has(key)) {
        seen.add(key);
        res.push(
          toAggregatedDefect(
            b,
            opts.keyOptions !== undefined ? { keyOptions: opts.keyOptions } : {},
          ),
        );
      }
    }
    return res;
  }
  if (strat === "windowed" || strat === "sliding_window_hash") {
    const keyOpts =
      strat === "sliding_window_hash"
        ? { ...(opts.keyOptions ?? {}), useContentHash: true }
        : opts.keyOptions;
    const res: AggregatedDefect[] = [];
    for (const b of defects) {
      if (!b) continue;
      const key = computeDefectDiscriminator(b, keyOpts),
        inTs = b.timestamp ?? new Date().toISOString();
      const existingIdx = res.findLastIndex((e) => e.dedup_key === key);
      if (existingIdx >= 0) {
        const existing = res[existingIdx];
        if (existing && withinDeduplicationWindow(existing.last_seen_at, inTs, winMs)) {
          const updated = aggregateDefectEntries(existing, b, { maxOccurrences: maxOcc });
          res[existingIdx] = updated;
          opts.onDefectDeduplicated?.(updated, b);
          continue;
        }
      }
      const created = toAggregatedDefect(b, keyOpts !== undefined ? { keyOptions: keyOpts } : {});
      res.push(created);
      opts.onNewDefect?.(created);
    }
    return res;
  }
  const map = new Map<string, AggregatedDefect>();
  for (const b of defects) {
    if (!b) continue;
    const key = computeDefectDiscriminator(b, opts.keyOptions),
      existing = map.get(key);
    if (!existing) {
      const created = toAggregatedDefect(
        b,
        opts.keyOptions !== undefined ? { keyOptions: opts.keyOptions } : {},
      );
      map.set(key, created);
      opts.onNewDefect?.(created);
    } else {
      const updated = aggregateDefectEntries(existing, b, { maxOccurrences: maxOcc });
      map.set(key, updated);
      opts.onDefectDeduplicated?.(updated, b);
    }
  }
  return Array.from(map.values());
}
