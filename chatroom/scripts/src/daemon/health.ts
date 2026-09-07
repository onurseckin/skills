import { existsSync, readFileSync } from "node:fs";
import {
  ChatError,
  daemonHealthPath,
  isProcessAlive,
  resolveActiveConsumerCursorPath,
  writeAtomic,
} from "../core/index.ts";

export type DaemonLivenessState = "LIVE" | "IDLE" | "BACKPRESSURED" | "WEDGED" | "STOPPED";

export type DaemonWakesBySource = {
  readonly watch: number;
  readonly poll: number;
  readonly tick: number;
  readonly token: number;
};

export interface DaemonHealthRecord {
  readonly v: 1;
  readonly room: string;
  readonly reader: string;
  readonly pid: number;
  readonly start_time: string;
  readonly boot_id: string;
  readonly state: DaemonLivenessState;
  readonly last_wake_at: string;
  readonly last_wake_source: string;
  readonly last_delivered_seq: number;
  readonly room_head_seq: number;
  readonly lag_seqs: number;
  readonly watch_active: boolean;
  readonly watch_failures: number;
  readonly poll_interval_ms: number;
  readonly wakes_by_source?: DaemonWakesBySource;
  readonly spool_bytes: number;
  readonly spool_lines: number;
  readonly consumer_last_ack_at: string | null;
  readonly consumer_last_delivered_seq?: number | null;
  readonly consumer_lag_ms: number;
  readonly respawns_this_hour: number;
  readonly errors_recent: readonly string[];
  readonly updated_at?: string;
}

export type CursorAckProvenance = {
  readonly last_ack_at: string | null;
  readonly last_ack_kind: "spooled" | "explicit" | null;
};

export interface HealthComputeOptions {
  readonly wedgeAfterMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly lagStuckSinceMs?: number | null;
  readonly isExplicitlyStopped?: boolean;
  readonly isBackpressured?: boolean;
  readonly cursor?: CursorAckProvenance | null;
}

export function deriveConsumerLastAckAt(
  cursor?: CursorAckProvenance | null,
  existingAckAt: string | null = null,
): string | null {
  return cursor?.last_ack_kind === "explicit" ? cursor.last_ack_at : existingAckAt;
}

const STATES = new Set("LIVE,IDLE,BACKPRESSURED,WEDGED,STOPPED".split(","));

export function isDaemonHealthRecord(value: unknown): value is DaemonHealthRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (c.v !== 1 || !STATES.has(String(c.state)) || !Number.isInteger(c.pid)) return false;
  if (typeof c.watch_active !== "boolean" || !Array.isArray(c.errors_recent)) return false;
  if (c.consumer_last_ack_at !== null && typeof c.consumer_last_ack_at !== "string") return false;
  const seq = c.consumer_last_delivered_seq;
  if (seq !== undefined && seq !== null && typeof seq !== "number") return false;
  for (const k of "room,reader,start_time,boot_id,last_wake_at,last_wake_source".split(",")) {
    if (typeof c[k] !== "string" || !c[k]) return false;
  }
  for (const k of "pid,last_delivered_seq,room_head_seq,lag_seqs,watch_failures,poll_interval_ms,spool_bytes,spool_lines,consumer_lag_ms,respawns_this_hour".split(
    ",",
  )) {
    if (typeof c[k] !== "number") return false;
  }
  const w = c.wakes_by_source as Record<string, unknown> | undefined;
  if (
    w &&
    (typeof w !== "object" ||
      Array.isArray(w) ||
      "watch,poll,tick,token".split(",").some((k) => typeof w[k] !== "number"))
  )
    return false;
  return true;
}

export interface HealthPorts {
  readonly existsSync?: (path: string) => boolean;
  readonly readFileSync?: (path: string, encoding: string) => string;
  readonly writeAtomic?: (path: string, content: string) => void;
  readonly writeFileSync?: (path: string, content: string) => void;
  readonly fs?: { readonly existsSync?: (path: string) => boolean };
  readonly isProcessAlive?: (pid: number) => boolean;
}

export function readHealthRecord(
  healthPath: string,
  ports?: HealthPorts,
): DaemonHealthRecord | null {
  if (!(ports?.existsSync ?? existsSync)(healthPath)) return null;
  try {
    const parsed: unknown = JSON.parse((ports?.readFileSync ?? readFileSync)(healthPath, "utf8"));
    return isDaemonHealthRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeHealthRecord(
  healthPath: string,
  record: DaemonHealthRecord,
  ports?: HealthPorts,
): void {
  const existing = readHealthRecord(healthPath, ports);
  const alive = ports?.isProcessAlive ?? isProcessAlive;
  if (existing && existing.pid !== record.pid && alive(existing.pid)) {
    throw new ChatError(
      "PERMISSION_DENIED",
      `Cannot overwrite health record owned by live process ${existing.pid}`,
    );
  }
  const s = JSON.stringify(record, null, 2) + "\n";
  const w = ports?.writeAtomic ?? ports?.writeFileSync ?? writeAtomic;
  w(healthPath, s);
}

export function computeDaemonState(
  record: DaemonHealthRecord,
  nowMs: number,
  options: HealthComputeOptions = {},
): DaemonLivenessState {
  const isAlive = options.isProcessAlive ?? isProcessAlive;
  if (options.isExplicitlyStopped || !isAlive(record.pid)) return "STOPPED";
  const wake = Date.parse(record.last_wake_at);
  if (!Number.isNaN(wake) && nowMs - wake > (options.heartbeatIntervalMs ?? 5000) * 2)
    return "STOPPED";
  if (options.isBackpressured || record.state === "BACKPRESSURED") return "BACKPRESSURED";
  if (record.lag_seqs > 0) {
    const stuck = options.lagStuckSinceMs ?? wake;
    return !Number.isNaN(stuck) && nowMs - stuck > (options.wedgeAfterMs ?? 60000)
      ? "WEDGED"
      : "LIVE";
  }
  return record.room_head_seq === record.last_delivered_seq ? "IDLE" : "LIVE";
}

const ZERO_WAKES: DaemonWakesBySource = { watch: 0, poll: 0, tick: 0, token: 0 };
const getInitialMetrics = () =>
  JSON.parse(
    '{"last_delivered_seq":0,"room_head_seq":0,"lag_seqs":0,"watch_active":false,"watch_failures":0,"spool_bytes":0,"spool_lines":0,"consumer_last_ack_at":null,"consumer_last_delivered_seq":null,"consumer_lag_ms":0,"respawns_this_hour":0,"errors_recent":[]}',
  );

export function writeDerivedHealthRecord(
  healthPath: string,
  record: DaemonHealthRecord,
  nowMs: number,
  options: HealthComputeOptions = {},
  ports?: HealthPorts,
): DaemonHealthRecord {
  const p = {
    ...ports,
    isProcessAlive: options.isProcessAlive ?? ports?.isProcessAlive ?? isProcessAlive,
  };
  const ack =
    options.cursor !== undefined
      ? deriveConsumerLastAckAt(options.cursor, record.consumer_last_ack_at)
      : record.consumer_last_ack_at;
  const derived: DaemonHealthRecord = {
    ...record,
    state: computeDaemonState(record, nowMs, options),
    wakes_by_source: record.wakes_by_source ?? { ...ZERO_WAKES },
    consumer_last_ack_at: ack,
  };
  writeHealthRecord(healthPath, derived, p);
  return derived;
}

export function createInitialHealthRecord(
  room: string,
  reader: string,
  pid: number,
  startTime: string,
  bootId: string,
  pollIntervalMs: number = 750,
): DaemonHealthRecord {
  const now = new Date().toISOString();
  return {
    ...getInitialMetrics(),
    v: 1,
    room,
    reader,
    pid,
    start_time: startTime,
    boot_id: bootId,
    state: "LIVE",
    last_wake_at: now,
    last_wake_source: "start",
    poll_interval_ms: pollIntervalMs,
    wakes_by_source: { ...ZERO_WAKES },
    updated_at: now,
  };
}

export interface HealthClaimOptions {
  readonly room: string;
  readonly reader: string;
  readonly pid: number;
  readonly startTime: string;
  readonly bootId?: string;
  readonly pollIntervalMs?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
}

export const isHealthRecordOwnerStale = (
  record: DaemonHealthRecord,
  pid: number,
  checkAlive: (candidate: number) => boolean,
): boolean => record.pid !== pid && !checkAlive(record.pid);

export function claimHealthRecord(
  healthPath: string,
  options: HealthClaimOptions,
  ports?: HealthPorts,
): DaemonHealthRecord {
  const existing = readHealthRecord(healthPath, ports);
  const bootId = options.bootId ?? existing?.boot_id ?? "boot";
  const pollMs = options.pollIntervalMs ?? existing?.poll_interval_ms ?? 750;
  if (existing === null) {
    const { room, reader, pid, startTime } = options;
    const cr = createInitialHealthRecord(room, reader, pid, startTime, bootId, pollMs);
    writeHealthRecord(healthPath, cr, ports);
    return cr;
  }
  const checkAlive = options.isProcessAlive ?? ports?.isProcessAlive ?? isProcessAlive;
  if (existing.pid !== options.pid && !checkAlive(existing.pid)) {
    const claimed: DaemonHealthRecord = {
      ...existing,
      pid: options.pid,
      start_time: options.startTime,
      boot_id: bootId,
      state: "LIVE",
      last_wake_at: options.startTime,
      last_wake_source: "claim",
      watch_active: false,
      watch_failures: 0,
      poll_interval_ms: pollMs,
      wakes_by_source: existing.wakes_by_source ?? { ...ZERO_WAKES },
      updated_at: options.startTime,
    };
    writeHealthRecord(healthPath, claimed, { ...ports, isProcessAlive: checkAlive });
    return claimed;
  }
  return existing;
}

function parseCursorProvenance(raw: string): CursorAckProvenance | null {
  try {
    const p = JSON.parse(raw) as { last_ack_at?: unknown; last_ack_kind?: unknown };
    const k =
      p.last_ack_kind === "explicit" || p.last_ack_kind === "spooled" ? p.last_ack_kind : null;
    return {
      last_ack_at: typeof p.last_ack_at === "string" ? p.last_ack_at : null,
      last_ack_kind: k,
    };
  } catch {
    return null;
  }
}

export type HealthMetrics = Pick<
  DaemonHealthRecord,
  "watch_active" | "watch_failures" | "poll_interval_ms"
> & {
  readonly wakes_by_source?: DaemonWakesBySource;
};

export interface HealthSyncInput {
  readonly healthPath: string;
  readonly nowIso: string;
  readonly metrics: HealthMetrics;
  readonly source?: string;
  readonly claim: HealthClaimOptions;
  readonly compute?: HealthComputeOptions;
  readonly ports?: HealthPorts;
  readonly cursor?: CursorAckProvenance | null;
}

export function syncDaemonHealth(input: HealthSyncInput): DaemonHealthRecord | null {
  const isAlive =
    input.compute?.isProcessAlive ??
    input.claim.isProcessAlive ??
    input.ports?.isProcessAlive ??
    isProcessAlive;
  const p: HealthPorts = { ...input.ports, isProcessAlive: isAlive };
  const pre = readHealthRecord(input.healthPath, p);
  if (pre !== null && pre.pid !== input.claim.pid && isAlive(pre.pid)) return null;
  claimHealthRecord(input.healthPath, { ...input.claim, isProcessAlive: isAlive }, p);
  const existing = readHealthRecord(input.healthPath, p);
  if (existing === null || (existing.pid !== input.claim.pid && isAlive(existing.pid))) return null;
  let cur = input.cursor ?? input.compute?.cursor;
  if (cur === undefined) {
    const cp = resolveActiveConsumerCursorPath(
      input.claim.room,
      input.claim.reader,
      input.ports?.existsSync,
    );
    if ((p.existsSync ?? existsSync)(cp)) {
      cur = parseCursorProvenance((p.readFileSync ?? readFileSync)(cp, "utf8"));
    }
  }
  const wakeSrc =
    input.source !== undefined
      ? { last_wake_at: input.nowIso, last_wake_source: input.source }
      : {};
  const merged: DaemonHealthRecord = {
    ...existing,
    ...input.metrics,
    wakes_by_source: input.metrics.wakes_by_source ?? existing.wakes_by_source ?? { ...ZERO_WAKES },
    consumer_last_ack_at: deriveConsumerLastAckAt(cur, existing.consumer_last_ack_at),
    updated_at: input.nowIso,
    ...wakeSrc,
  };
  const opts = {
    ...input.compute,
    isProcessAlive: isAlive,
    ...(cur !== undefined ? { cursor: cur } : {}),
  };
  return writeDerivedHealthRecord(input.healthPath, merged, Date.parse(input.nowIso), opts, p);
}

export function stampStoppedIfOwned(
  healthPath: string,
  pid: number,
  nowIso: string,
  ports?: HealthPorts,
): boolean {
  const ex = readHealthRecord(healthPath, ports);
  if (ex === null || ex.pid !== pid) return false;
  writeHealthRecord(
    healthPath,
    { ...ex, watch_active: false, state: "STOPPED", updated_at: nowIso },
    ports,
  );
  return true;
}

export interface DaemonInspectionResult {
  readonly room: string;
  readonly reader: string;
  readonly state: DaemonLivenessState;
  readonly health: DaemonHealthRecord | null;
  readonly watch_active: boolean;
}

export function inspectDaemon(
  room: string,
  reader: string,
  options: HealthComputeOptions = {},
  ports?: HealthPorts,
): DaemonInspectionResult {
  const health = readHealthRecord(daemonHealthPath(room, reader), ports);
  if (health === null) return { room, reader, state: "STOPPED", health: null, watch_active: false };
  const opts = {
    ...options,
    isProcessAlive: options.isProcessAlive ?? ports?.isProcessAlive ?? isProcessAlive,
  };
  const state = computeDaemonState(health, Date.now(), opts);
  return { room, reader, state, health, watch_active: health.watch_active };
}
