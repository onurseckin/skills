import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { daemonHealthPath, isProcessAlive, writeAtomic } from "../core/index.ts";

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
  readonly spool_bytes: number;
  readonly spool_lines: number;
  readonly consumer_last_ack_at: string | null;
  readonly consumer_lag_ms: number;
  readonly respawns_this_hour: number;
  readonly errors_recent: readonly string[];
  readonly updated_at?: string;
}

export interface HealthComputeOptions {
  readonly wedgeAfterMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly lagStuckSinceMs?: number | null;
  readonly isExplicitlyStopped?: boolean;
  readonly isBackpressured?: boolean;
}

export function isDaemonHealthRecord(value: unknown): value is DaemonHealthRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.v !== 1) return false;
  if (typeof candidate.room !== "string" || candidate.room.length === 0) return false;
  if (typeof candidate.reader !== "string" || candidate.reader.length === 0) return false;
  if (typeof candidate.pid !== "number" || !Number.isInteger(candidate.pid)) return false;
  if (typeof candidate.start_time !== "string") return false;
  if (typeof candidate.boot_id !== "string") return false;
  if (
    candidate.state !== "LIVE" &&
    candidate.state !== "IDLE" &&
    candidate.state !== "BACKPRESSURED" &&
    candidate.state !== "WEDGED" &&
    candidate.state !== "STOPPED"
  ) {
    return false;
  }
  if (typeof candidate.last_wake_at !== "string") return false;
  if (typeof candidate.last_wake_source !== "string") return false;
  if (typeof candidate.last_delivered_seq !== "number") return false;
  if (typeof candidate.room_head_seq !== "number") return false;
  if (typeof candidate.lag_seqs !== "number") return false;
  if (typeof candidate.watch_active !== "boolean") return false;
  if (typeof candidate.watch_failures !== "number") return false;
  if (typeof candidate.poll_interval_ms !== "number") return false;
  if (typeof candidate.spool_bytes !== "number") return false;
  if (typeof candidate.spool_lines !== "number") return false;
  if (
    candidate.consumer_last_ack_at !== null &&
    typeof candidate.consumer_last_ack_at !== "string"
  ) {
    return false;
  }
  if (typeof candidate.consumer_lag_ms !== "number") return false;
  if (typeof candidate.respawns_this_hour !== "number") return false;
  if (!Array.isArray(candidate.errors_recent)) return false;
  return true;
}

export interface HealthPorts {
  readonly existsSync?: (path: string) => boolean;
  readonly readFileSync?: (path: string, encoding: string) => string;
  readonly writeAtomic?: (path: string, content: string) => void;
  readonly writeFileSync?: (path: string, content: string) => void;
}

export function readHealthRecord(
  healthPath: string,
  ports?: HealthPorts,
): DaemonHealthRecord | null {
  const existsFn = ports?.existsSync ?? existsSync;
  const readFn = ports?.readFileSync ?? readFileSync;
  if (!existsFn(healthPath)) {
    return null;
  }
  try {
    const raw = readFn(healthPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isDaemonHealthRecord(parsed)) {
      return parsed;
    }
    return null;
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
    const heartbeatPath = join(dirname(healthPath), "heartbeat.json");
    writeFn(heartbeatPath, serialized);
  } catch {}
}

export function computeDaemonState(
  record: DaemonHealthRecord,
  nowMs: number,
  options: HealthComputeOptions = {},
): DaemonLivenessState {
  if (options.isExplicitlyStopped) {
    return "STOPPED";
  }

  const checkAlive = options.isProcessAlive ?? isProcessAlive;
  if (!checkAlive(record.pid)) {
    return "STOPPED";
  }

  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5000;
  const lastWakeMs = Date.parse(record.last_wake_at);
  if (!Number.isNaN(lastWakeMs) && nowMs - lastWakeMs > heartbeatIntervalMs * 2) {
    return "STOPPED";
  }

  if (options.isBackpressured || record.state === "BACKPRESSURED") {
    return "BACKPRESSURED";
  }

  if (record.lag_seqs > 0) {
    const wedgeAfterMs = options.wedgeAfterMs ?? 60000;
    const stuckSince = options.lagStuckSinceMs ?? lastWakeMs;
    if (!Number.isNaN(stuckSince) && nowMs - stuckSince > wedgeAfterMs) {
      return "WEDGED";
    }
    return "LIVE";
  }

  if (record.room_head_seq === record.last_delivered_seq) {
    return "IDLE";
  }

  return "LIVE";
}

export function writeDerivedHealthRecord(
  healthPath: string,
  record: DaemonHealthRecord,
  nowMs: number,
  options: HealthComputeOptions = {},
  ports?: HealthPorts,
): DaemonHealthRecord {
  const derived: DaemonHealthRecord = {
    ...record,
    state: computeDaemonState(record, nowMs, options),
  };
  writeHealthRecord(healthPath, derived, ports);
  return derived;
}

export interface HealthSyncInput {
  readonly healthPath: string;
  readonly nowIso: string;
  readonly metrics: Pick<
    DaemonHealthRecord,
    "watch_active" | "watch_failures" | "poll_interval_ms"
  >;
  readonly source?: string;
  readonly compute?: HealthComputeOptions;
  readonly ports?: HealthPorts;
}

export function syncDaemonHealth(input: HealthSyncInput): DaemonHealthRecord | null {
  const existing = readHealthRecord(input.healthPath, input.ports);
  if (existing === null) {
    return null;
  }
  const merged: DaemonHealthRecord = {
    ...existing,
    watch_active: input.metrics.watch_active,
    watch_failures: input.metrics.watch_failures,
    poll_interval_ms: input.metrics.poll_interval_ms,
    updated_at: input.nowIso,
    ...(input.source !== undefined
      ? { last_wake_at: input.nowIso, last_wake_source: input.source }
      : {}),
  };
  return writeDerivedHealthRecord(
    input.healthPath,
    merged,
    Date.parse(input.nowIso),
    input.compute ?? {},
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
    spool_bytes: 0,
    spool_lines: 0,
    consumer_last_ack_at: null,
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
  if (record.pid === pid) {
    return false;
  }
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
    updated_at: options.startTime,
  };
  writeHealthRecord(healthPath, claimed, ports);
  return claimed;
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
    return {
      room,
      reader,
      state: "STOPPED",
      health: null,
      watch_active: false,
    };
  }
  const state = computeDaemonState(health, Date.now(), options);
  return {
    room,
    reader,
    state,
    health,
    watch_active: health.watch_active,
  };
}
