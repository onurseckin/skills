import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { daemonHealthPath, isProcessAlive, readerCursorPath, writeAtomic } from "../core/index.ts";

export type DaemonLivenessState = "LIVE" | "IDLE" | "BACKPRESSURED" | "WEDGED" | "STOPPED";

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
  readonly wakes_by_source?: {
    readonly watch: number;
    readonly poll: number;
    readonly tick: number;
    readonly token: number;
  };
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
  if (!cursor || cursor.last_ack_kind !== "explicit") return existingAckAt;
  return cursor.last_ack_at;
}

export function isDaemonHealthRecord(value: unknown): value is DaemonHealthRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (c.v !== 1) return false;
  if (typeof c.room !== "string" || c.room.length === 0) return false;
  if (typeof c.reader !== "string" || c.reader.length === 0) return false;
  if (typeof c.pid !== "number" || !Number.isInteger(c.pid)) return false;
  if (typeof c.start_time !== "string" || typeof c.boot_id !== "string") return false;
  const s = c.state;
  if (s !== "LIVE" && s !== "IDLE" && s !== "BACKPRESSURED" && s !== "WEDGED" && s !== "STOPPED")
    return false;
  if (typeof c.last_wake_at !== "string" || typeof c.last_wake_source !== "string") return false;
  if (
    typeof c.last_delivered_seq !== "number" ||
    typeof c.room_head_seq !== "number" ||
    typeof c.lag_seqs !== "number"
  )
    return false;
  if (
    typeof c.watch_active !== "boolean" ||
    typeof c.watch_failures !== "number" ||
    typeof c.poll_interval_ms !== "number"
  )
    return false;
  if (c.wakes_by_source !== undefined) {
    if (
      typeof c.wakes_by_source !== "object" ||
      c.wakes_by_source === null ||
      Array.isArray(c.wakes_by_source)
    )
      return false;
    const w = c.wakes_by_source as Record<string, unknown>;
    if (
      typeof w.watch !== "number" ||
      typeof w.poll !== "number" ||
      typeof w.tick !== "number" ||
      typeof w.token !== "number"
    )
      return false;
  }
  if (typeof c.spool_bytes !== "number" || typeof c.spool_lines !== "number") return false;
  if (c.consumer_last_ack_at !== null && typeof c.consumer_last_ack_at !== "string") return false;
  const seq = c.consumer_last_delivered_seq;
  if (seq !== undefined && seq !== null && typeof seq !== "number") return false;
  if (typeof c.consumer_lag_ms !== "number" || typeof c.respawns_this_hour !== "number")
    return false;
  return Array.isArray(c.errors_recent);
}

export interface HealthPorts {
  readonly existsSync?: (path: string) => boolean;
  readonly readFileSync?: (path: string, encoding: string) => string;
  readonly writeAtomic?: (path: string, content: string) => void;
  readonly writeFileSync?: (path: string, content: string) => void;
  readonly fs?: { readonly existsSync?: (path: string) => boolean };
}

export function readHealthRecord(
  healthPath: string,
  ports?: HealthPorts,
): DaemonHealthRecord | null {
  const existsFn = ports?.existsSync ?? existsSync;
  const readFn = ports?.readFileSync ?? readFileSync;
  if (!existsFn(healthPath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFn(healthPath, "utf8"));
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
  const serialized = JSON.stringify(record, null, 2) + "\n";
  const writeFn =
    ports?.writeAtomic ??
    ports?.writeFileSync ??
    ((target: string, content: string) => writeAtomic(target, content, { mode: 0o644 }));
  writeFn(healthPath, serialized);
  try {
    writeFn(join(dirname(healthPath), "heartbeat.json"), serialized);
  } catch {}
}

export function computeDaemonState(
  record: DaemonHealthRecord,
  nowMs: number,
  options: HealthComputeOptions = {},
): DaemonLivenessState {
  if (options.isExplicitlyStopped) return "STOPPED";
  const checkAlive = options.isProcessAlive ?? isProcessAlive;
  if (!checkAlive(record.pid)) return "STOPPED";
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5000;
  const lastWakeMs = Date.parse(record.last_wake_at);
  if (!Number.isNaN(lastWakeMs) && nowMs - lastWakeMs > heartbeatIntervalMs * 2) return "STOPPED";
  if (options.isBackpressured || record.state === "BACKPRESSURED") return "BACKPRESSURED";
  if (record.lag_seqs > 0) {
    const wedgeAfterMs = options.wedgeAfterMs ?? 60000;
    const stuckSince = options.lagStuckSinceMs ?? lastWakeMs;
    if (!Number.isNaN(stuckSince) && nowMs - stuckSince > wedgeAfterMs) return "WEDGED";
    return "LIVE";
  }
  return record.room_head_seq === record.last_delivered_seq ? "IDLE" : "LIVE";
}

export function writeDerivedHealthRecord(
  healthPath: string,
  record: DaemonHealthRecord,
  nowMs: number,
  options: HealthComputeOptions = {},
  ports?: HealthPorts,
): DaemonHealthRecord {
  const consumerLastAckAt =
    options.cursor !== undefined
      ? deriveConsumerLastAckAt(options.cursor, record.consumer_last_ack_at)
      : record.consumer_last_ack_at;
  const derived: DaemonHealthRecord = {
    ...record,
    state: computeDaemonState(record, nowMs, options),
    wakes_by_source: record.wakes_by_source ?? { watch: 0, poll: 0, tick: 0, token: 0 },
    consumer_last_ack_at: consumerLastAckAt,
  };
  writeHealthRecord(healthPath, derived, ports);
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
  const nowIso = new Date().toISOString();
  return {
    v: 1,
    room,
    reader,
    pid,
    start_time: startTime,
    boot_id: bootId,
    state: "LIVE",
    last_wake_at: nowIso,
    last_wake_source: "start",
    last_delivered_seq: 0,
    room_head_seq: 0,
    lag_seqs: 0,
    watch_active: false,
    watch_failures: 0,
    poll_interval_ms: pollIntervalMs,
    wakes_by_source: { watch: 0, poll: 0, tick: 0, token: 0 },
    spool_bytes: 0,
    spool_lines: 0,
    consumer_last_ack_at: null,
    consumer_last_delivered_seq: null,
    consumer_lag_ms: 0,
    respawns_this_hour: 0,
    errors_recent: [],
    updated_at: nowIso,
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

export function isHealthRecordOwnerStale(
  record: DaemonHealthRecord,
  pid: number,
  checkAlive: (candidate: number) => boolean,
): boolean {
  if (record.pid === pid) return false;
  return !checkAlive(record.pid);
}

export function claimHealthRecord(
  healthPath: string,
  options: HealthClaimOptions,
  ports?: HealthPorts,
): DaemonHealthRecord {
  const existing = readHealthRecord(healthPath, ports);
  const bootId = options.bootId ?? existing?.boot_id ?? "boot";
  const pollIntervalMs = options.pollIntervalMs ?? existing?.poll_interval_ms ?? 750;
  if (existing === null) {
    const created = createInitialHealthRecord(
      options.room,
      options.reader,
      options.pid,
      options.startTime,
      bootId,
      pollIntervalMs,
    );
    writeHealthRecord(healthPath, created, ports);
    return created;
  }
  const checkAlive = options.isProcessAlive ?? isProcessAlive;
  if (!isHealthRecordOwnerStale(existing, options.pid, checkAlive)) {
    return existing;
  }
  const claimed: DaemonHealthRecord = {
    ...existing,
    pid: options.pid,
    start_time: options.startTime,
    boot_id: bootId,
    state: "LIVE",
    last_wake_at: options.startTime,
    last_wake_source: "start",
    watch_active: false,
    watch_failures: 0,
    poll_interval_ms: pollIntervalMs,
    wakes_by_source: existing.wakes_by_source ?? { watch: 0, poll: 0, tick: 0, token: 0 },
    updated_at: options.startTime,
  };
  writeHealthRecord(healthPath, claimed, ports);
  return claimed;
}

export interface HealthSyncInput {
  readonly healthPath: string;
  readonly nowIso: string;
  readonly metrics: Pick<
    DaemonHealthRecord,
    "watch_active" | "watch_failures" | "poll_interval_ms"
  > & {
    readonly wakes_by_source?: DaemonHealthRecord["wakes_by_source"];
  };
  readonly source?: string;
  readonly claim: HealthClaimOptions;
  readonly compute?: HealthComputeOptions;
  readonly ports?: HealthPorts;
  readonly cursor?: CursorAckProvenance | null;
}

export function syncDaemonHealth(input: HealthSyncInput): DaemonHealthRecord | null {
  claimHealthRecord(input.healthPath, input.claim, input.ports);
  const existing = readHealthRecord(input.healthPath, input.ports);
  if (existing === null) {
    return null;
  }
  let cursorToUse = input.cursor ?? input.compute?.cursor;
  if (cursorToUse === undefined) {
    const cPath = readerCursorPath(input.claim.room, input.claim.reader);
    const existsFn = input.ports?.existsSync ?? existsSync;
    const readFn = input.ports?.readFileSync ?? readFileSync;
    if (existsFn(cPath)) {
      try {
        const raw = readFn(cPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          const kind =
            parsed.last_ack_kind === "explicit" || parsed.last_ack_kind === "spooled"
              ? parsed.last_ack_kind
              : null;
          cursorToUse = {
            last_ack_at: typeof parsed.last_ack_at === "string" ? parsed.last_ack_at : null,
            last_ack_kind: kind,
          };
        }
      } catch {}
    }
  }
  const consumerLastAckAt = deriveConsumerLastAckAt(cursorToUse, existing.consumer_last_ack_at);
  const merged: DaemonHealthRecord = {
    ...existing,
    watch_active: input.metrics.watch_active,
    watch_failures: input.metrics.watch_failures,
    poll_interval_ms: input.metrics.poll_interval_ms,
    wakes_by_source: input.metrics.wakes_by_source ??
      existing.wakes_by_source ?? { watch: 0, poll: 0, tick: 0, token: 0 },
    consumer_last_ack_at: consumerLastAckAt,
    updated_at: input.nowIso,
    ...(input.source !== undefined
      ? { last_wake_at: input.nowIso, last_wake_source: input.source }
      : {}),
  };
  return writeDerivedHealthRecord(
    input.healthPath,
    merged,
    Date.parse(input.nowIso),
    { ...input.compute, ...(cursorToUse !== undefined ? { cursor: cursorToUse } : {}) },
    input.ports,
  );
}

export function stampStoppedIfOwned(
  healthPath: string,
  pid: number,
  nowIso: string,
  ports?: HealthPorts,
): boolean {
  const existing = readHealthRecord(healthPath, ports);
  if (existing === null || existing.pid !== pid) {
    return false;
  }
  writeHealthRecord(
    healthPath,
    { ...existing, watch_active: false, state: "STOPPED", updated_at: nowIso },
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
  const healthPath = daemonHealthPath(room, reader);
  const health = readHealthRecord(healthPath, ports);
  if (health === null) {
    return { room, reader, state: "STOPPED", health: null, watch_active: false };
  }
  const state = computeDaemonState(health, Date.now(), options);
  return { room, reader, state, health, watch_active: health.watch_active };
}
