import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { computeDaemonState, readHealthRecord, type DaemonLivenessState } from "../daemon/index.ts";
import {
  checkProcessAlive,
  inspectLocks,
  inspectManifest,
  inspectMembers,
  inspectProvisioning,
  inspectQuarantined,
  readJsonSafely,
  resolveDataDir,
  resolveHeadSeq,
} from "./inspectors.ts";
import type {
  DoctorInspectOptions,
  DoctorInspectionResult,
  LeaseInfo,
  ReaderHealthReport,
  RoomHealthReport,
} from "./types.ts";

export type {
  DaemonLivenessState,
  DoctorInspectOptions,
  DoctorInspectionResult,
  LeaseInfo,
  LockReport,
  ManifestReport,
  ProvisionReport,
  ReaderHealthReport,
  RoomHealthReport,
} from "./types.ts";

const MAX_SPOOL_BYTES = 33554432;
const MAX_SPOOL_LINES = 20000;

function inspectReaders(
  roomDir: string,
  members: readonly string[],
  headSeq: number,
  nowMs: number,
  aliveCheck: (pid: number) => boolean,
  filter?: string,
): readonly ReaderHealthReport[] {
  const readerNames = new Set<string>();
  for (const m of members) {
    readerNames.add(m);
  }
  const dir = join(roomDir, "readers");
  if (existsSync(dir)) {
    for (const n of readdirSync(dir)) {
      if (n.endsWith(".cursor.json") && !n.endsWith(".spool.cursor.json")) {
        readerNames.add(n.slice(0, -".cursor.json".length));
      }
    }
  }
  const daemonDir = join(roomDir, "daemon");
  if (existsSync(daemonDir)) {
    for (const n of readdirSync(daemonDir)) {
      if (n.endsWith(".health.json")) {
        readerNames.add(n.slice(0, -".health.json".length));
      }
    }
  }
  const daemonLocksDir = join(roomDir, "locks", "daemon");
  if (existsSync(daemonLocksDir)) {
    for (const n of readdirSync(daemonLocksDir)) {
      if (n.endsWith(".lock")) {
        readerNames.add(n.slice(0, -".lock".length));
      }
    }
  }

  const reports: ReaderHealthReport[] = [];
  for (const reader of readerNames) {
    if (filter !== undefined && filter.length > 0 && reader !== filter) continue;
    const curPath = join(dir, `${reader}.cursor.json`);
    const cur = existsSync(curPath) ? readJsonSafely(curPath) : null;
    const contiguousSeq =
      cur !== null && typeof cur["contiguous_seq"] === "number" ? cur["contiguous_seq"] : 0;
    const lag = Math.max(0, headSeq - contiguousSeq);
    const rawHeld = cur !== null && Array.isArray(cur["held"]) ? cur["held"] : [];
    const held: LeaseInfo[] = [];
    const expired: LeaseInfo[] = [];
    for (const item of rawHeld) {
      if (typeof item === "object" && item !== null) {
        const h = item as Record<string, unknown>;
        const expMs = typeof h["expires_at"] === "string" ? new Date(h["expires_at"]).getTime() : 0;
        const isExp = expMs > 0 && expMs <= nowMs;
        const info: LeaseInfo = {
          lease: typeof h["lease"] === "string" ? h["lease"] : "",
          from: typeof h["from"] === "number" ? h["from"] : 0,
          to: typeof h["to"] === "number" ? h["to"] : 0,
          issued_at: typeof h["issued_at"] === "string" ? h["issued_at"] : "",
          expires_at: typeof h["expires_at"] === "string" ? h["expires_at"] : "",
          attempt: typeof h["attempt"] === "number" ? h["attempt"] : 1,
          is_expired: isExp,
        };
        held.push(info);
        if (isExp) expired.push(info);
      }
    }
    const hp = join(roomDir, "daemon", `${reader}.health.json`);
    const health = readHealthRecord(hp);
    let pid = health !== null ? health.pid : null;
    if (pid === null) {
      const lp = join(roomDir, "locks", "daemon", `${reader}.lock`);
      if (existsSync(lp)) {
        try {
          const raw = readFileSync(lp, "utf-8");
          const parsed: unknown = JSON.parse(raw);
          if (
            parsed &&
            typeof parsed === "object" &&
            "pid" in parsed &&
            typeof (parsed as { pid: unknown }).pid === "number"
          ) {
            pid = (parsed as { pid: number }).pid;
          }
        } catch {}
      }
    }
    let lastHeartbeat: string | null = null;
    let heartbeatAgeMs: number | null = null;
    if (health !== null) {
      lastHeartbeat = health.last_wake_at;
      const lastWakeMs = Date.parse(health.last_wake_at);
      if (!Number.isNaN(lastWakeMs)) {
        heartbeatAgeMs = Math.max(0, nowMs - lastWakeMs);
      }
    } else if (existsSync(hp)) {
      heartbeatAgeMs = Math.max(0, nowMs - statSync(hp).mtimeMs);
    }
    const isAlive = pid !== null ? aliveCheck(pid) : false;
    const sp = join(roomDir, "daemon", `${reader}.out.jsonl`);
    let spoolBytes = 0;
    let spoolLines = 0;
    if (existsSync(sp)) {
      spoolBytes = statSync(sp).size;
      try {
        spoolLines = readFileSync(sp, "utf-8")
          .split("\n")
          .filter((l) => l.trim().length > 0).length;
      } catch {
        spoolLines = 0;
      }
    }
    const isBackpressured = spoolBytes >= MAX_SPOOL_BYTES || spoolLines >= MAX_SPOOL_LINES;
    let daemonState: DaemonLivenessState = "STOPPED";
    if (health !== null && isAlive) {
      const lagStuck =
        health.state === "WEDGED"
          ? 0
          : health.consumer_lag_ms > 0
            ? nowMs - health.consumer_lag_ms
            : null;
      daemonState = computeDaemonState(
        { ...health, room_head_seq: headSeq, last_delivered_seq: contiguousSeq, lag_seqs: lag },
        nowMs,
        {
          isProcessAlive: aliveCheck,
          isExplicitlyStopped: health.state === "STOPPED",
          isBackpressured,
          ...(lagStuck !== null ? { lagStuckSinceMs: lagStuck } : {}),
        },
      );
    }
    reports.push({
      reader,
      contiguous_seq: contiguousSeq,
      head_seq: headSeq,
      lag,
      held_leases: held,
      expired_leases: expired,
      daemon_state: daemonState,
      daemon_pid: pid,
      is_daemon_alive: isAlive,
      last_heartbeat: lastHeartbeat,
      heartbeat_age_ms: heartbeatAgeMs,
      spool_bytes: spoolBytes,
      spool_lines: spoolLines,
      is_orphan: !members.includes(reader),
      watch_active: health !== null ? health.watch_active : false,
    });
  }

  return reports;
}

export function inspectRoom(room: string, options: DoctorInspectOptions = {}): RoomHealthReport {
  const baseDir = resolveDataDir(options.baseDir);
  const roomDir = join(baseDir, "rooms", room);
  const nowMs = options.now ? options.now() : Date.now();
  const aliveCheck = options.isProcessAlive ?? checkProcessAlive;
  const issues: string[] = [];
  if (!existsSync(roomDir)) {
    return {
      room,
      room_dir: roomDir,
      manifest: {
        exists: false,
        is_valid: false,
        id: null,
        title: null,
        visibility: null,
        key_fingerprint: null,
        created_at: null,
        errors: ["room directory does not exist"],
      },
      head_seq: 0,
      members: [],
      readers: [],
      locks: [],
      quarantined: 0,
      quarantined_lines: [],
      quarantined_count: 0,
      orphan_cursors: [],
      orphan_members: [],
      provisioning: [],
      provisioning_drift: false,
      has_corrupt_layout: false,
      is_healthy: false,
      issues: ["Room directory not found"],
    };
  }
  const manifest = inspectManifest(roomDir);
  if (!manifest.is_valid) issues.push(...manifest.errors);
  const hasCorruptLayout = existsSync(join(roomDir, "cursor.json"));
  if (hasCorruptLayout) issues.push("CORRUPT_LAYOUT: cursor.json exists at room root");
  const headSeq = resolveHeadSeq(roomDir);
  const members = inspectMembers(roomDir);
  const readers = inspectReaders(roomDir, members, headSeq, nowMs, aliveCheck, options.reader);
  const locks = inspectLocks(roomDir, nowMs, aliveCheck);
  for (const l of locks) {
    if (l.is_stale) issues.push(`Stale lock: ${l.path} (${l.reason ?? "unknown"})`);
  }
  const quarantinedLines = inspectQuarantined(roomDir);
  if (quarantinedLines.length > 0) issues.push(`Quarantined envelopes: ${quarantinedLines.length}`);
  const orphanCursors = readers.filter((r) => r.is_orphan).map((r) => r.reader);
  if (orphanCursors.length > 0) issues.push(`Orphan cursors: ${orphanCursors.join(", ")}`);
  const orphanMembers = members.filter((m) => !readers.some((r) => r.reader === m));
  const provisioning = inspectProvisioning(roomDir, readers);
  const provisioningDrift = provisioning.some((p) => p.drift_detected);
  if (provisioningDrift) issues.push("Provisioning drift detected");
  for (const r of readers) {
    if (r.expired_leases.length > 0)
      issues.push(`Reader ${r.reader} has ${r.expired_leases.length} expired lease(s)`);
    if (r.daemon_state === "STOPPED") issues.push(`Reader ${r.reader} daemon is STOPPED`);
    else if (r.daemon_state === "WEDGED")
      issues.push(`Reader ${r.reader} daemon is WEDGED (lag ${r.lag})`);
  }
  return {
    room,
    room_dir: roomDir,
    manifest,
    head_seq: headSeq,
    members,
    readers,
    locks,
    quarantined: quarantinedLines.length,
    quarantined_lines: quarantinedLines,
    quarantined_count: quarantinedLines.length,
    orphan_cursors: orphanCursors,
    orphan_members: orphanMembers,
    provisioning,
    provisioning_drift: provisioningDrift,
    has_corrupt_layout: hasCorruptLayout,
    is_healthy: issues.length === 0,
    issues,
  };
}

export function inspectAllRooms(options: DoctorInspectOptions = {}): DoctorInspectionResult {
  const baseDir = resolveDataDir(options.baseDir);
  const roomsDir = join(baseDir, "rooms");
  let roomNames: string[] = [];
  if (options.room !== undefined && options.room.length > 0) {
    roomNames = [options.room];
  } else if (existsSync(roomsDir)) {
    roomNames = readdirSync(roomsDir).filter((name) => {
      try {
        return statSync(join(roomsDir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  }
  if (options.as !== undefined && options.as.length > 0) {
    const targetMember = options.as;
    roomNames = roomNames.filter((r) =>
      existsSync(join(roomsDir, r, "members", `${targetMember}.json`)),
    );
  }
  const reports = roomNames.map((r) => inspectRoom(r, options));
  const totalIssues = reports.reduce((acc, r) => acc + r.issues.length, 0);
  const isHealthy = reports.every((r) => r.is_healthy);
  const summary = isHealthy
    ? `All ${reports.length} room(s) healthy.`
    : `Doctor found ${totalIssues} issue(s) across ${reports.length} room(s).`;
  return { rooms: reports, is_healthy: isHealthy, total_issues: totalIssues, summary };
}
