import { existsSync, readFileSync } from "node:fs";
import { isProcessAlive, writeAtomic } from "../core/index.ts";

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

export function readHealthRecord(healthPath: string): DaemonHealthRecord | null {
  if (!existsSync(healthPath)) {
    return null;
  }
  try {
    const raw = readFileSync(healthPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isDaemonHealthRecord(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeHealthRecord(healthPath: string, record: DaemonHealthRecord): void {
  const serialized = JSON.stringify(record, null, 2) + "\n";
  writeAtomic(healthPath, serialized, { mode: 0o644 });
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
