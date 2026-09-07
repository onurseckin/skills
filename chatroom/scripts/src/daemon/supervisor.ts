import { spawn, type SpawnOptions } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  appendAtomic,
  daemonHealthPath,
  daemonLockPath,
  daemonReclaimPath,
  daemonRespawnPath,
  isLockPayload,
  isProcessAlive,
  writeAtomic,
  type LockPayload,
} from "../core/index.ts";
import { resolvePolicy, type ChatroomPolicy } from "../policy/index.ts";
import { readHealthRecord, writeHealthRecord } from "./health.ts";

export interface SupervisorPorts {
  readonly now?: () => number;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly getStartTime?: (pid: number) => string | undefined;
  readonly getBootId?: () => string;
  readonly existsSync?: (path: string) => boolean;
  readonly readFileSync?: (path: string, encoding: string) => string;
  readonly writeFileSync?: (path: string, content: string) => void;
  readonly writeAtomic?: (path: string, content: string) => void;
  readonly spawnDetached?: (
    cmd: string,
    args: readonly string[],
    opts?: SpawnOptions,
  ) => number | null;
}

export interface LockAcquisitionResult {
  readonly acquired: boolean;
  readonly lockFd: number | null;
  readonly lockPath: string;
  readonly holderPid: number | null;
  readonly reason?: string;
}

export interface SupervisorOptions {
  readonly room: string;
  readonly reader: string;
  readonly foreground?: boolean;
  readonly pollIntervalMs?: number;
  readonly host?: string;
  readonly policy?: ChatroomPolicy;
  readonly ports?: SupervisorPorts;
  readonly isWatchdog?: boolean;
  readonly watchPid?: number;
  readonly gracePeriodMs?: number;
  readonly verifyAlive?: boolean;
}

export interface SupervisorResult {
  readonly status: "started" | "already_running" | "stopped" | "exhausted" | "ticked" | "failed";
  readonly pid?: number | null;
  readonly reason?: string;
  readonly already_running?: boolean;
}

function getSystemBootId(): string {
  const f = "/proc/sys/kernel/random/boot_id";
  try {
    return existsSync(f) ? readFileSync(f, "utf8").trim() : "system-boot-default";
  } catch {
    return "system-boot-default";
  }
}

export function parseDaemonLockPayload(raw: string): LockPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isLockPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getRecentRespawnTimestamps(
  respawnPath: string,
  windowStart: number,
  ports?: SupervisorPorts,
): string[] {
  const existsFn = ports?.existsSync ?? existsSync;
  if (!existsFn(respawnPath)) return [];
  try {
    const raw = (ports?.readFileSync ?? readFileSync)(respawnPath, "utf8");
    const parsed = JSON.parse(raw) as { timestamps?: unknown };
    return Array.isArray(parsed?.timestamps)
      ? parsed.timestamps.filter(
          (ts): ts is string => typeof ts === "string" && Date.parse(ts) >= windowStart,
        )
      : [];
  } catch {
    return [];
  }
}

export function checkRespawnBudget(
  roomId: string,
  readerId: string,
  maxPerHour = 20,
  ports: SupervisorPorts = {},
): { readonly allowed: boolean; readonly count: number } {
  const respawnPath = daemonRespawnPath(roomId, readerId);
  const now = ports.now?.() ?? Date.now();
  const recent = getRecentRespawnTimestamps(respawnPath, now - 3600000, ports);
  return { allowed: recent.length < maxPerHour, count: recent.length };
}

export function recordRespawn(roomId: string, readerId: string, ports: SupervisorPorts = {}): void {
  const respawnPath = daemonRespawnPath(roomId, readerId);
  const now = ports.now?.() ?? Date.now();
  const recent = getRecentRespawnTimestamps(respawnPath, now - 3600000, ports);
  recent.push(new Date(now).toISOString());
  const writeFn = ports.writeAtomic ?? ports.writeFileSync ?? writeAtomic;
  writeFn(respawnPath, JSON.stringify({ timestamps: recent }, null, 2) + "\n");
}

export function reclaimStaleLock(
  roomId: string,
  readerId: string,
  priorPayload: LockPayload,
  reason: string,
  evidence: string,
  ports: SupervisorPorts = {},
): void {
  const reclaimed_at = new Date(ports.now?.() ?? Date.now()).toISOString();
  const entry = {
    reclaimed_at,
    prior_pid: priorPayload.pid,
    prior_start_time: priorPayload.start_time,
    prior_boot_id: priorPayload.boot_id,
    reason,
    evidence,
  };
  appendAtomic(daemonReclaimPath(roomId, readerId), JSON.stringify(entry) + "\n");
  releaseDaemonLock(roomId, readerId, null);
}

export function acquireDaemonLock(
  roomId: string,
  readerId: string,
  host: string = "unknown",
  ports: SupervisorPorts = {},
  policy?: ChatroomPolicy,
): LockAcquisitionResult {
  const lockPath = daemonLockPath(roomId, readerId);
  const healthPath = daemonHealthPath(roomId, readerId);
  const now = ports.now?.() ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const checkAlive = ports.isProcessAlive ?? isProcessAlive;
  const bootId = ports.getBootId?.() ?? getSystemBootId();
  const staleThreshold = policy?.stale_after_ms ?? 30000;
  const heartbeatInterval = policy?.heartbeat_interval_ms ?? 5000;

  mkdirSync(dirname(lockPath), { recursive: true });

  if (existsSync(lockPath)) {
    let existingPayload: LockPayload | null = null;
    try {
      existingPayload = parseDaemonLockPayload(readFileSync(lockPath, "utf8"));
    } catch {}

    if (existingPayload !== null) {
      if (checkAlive(existingPayload.pid)) {
        const isReused =
          (existingPayload.boot_id && existingPayload.boot_id !== bootId) ||
          (ports.getStartTime &&
            existingPayload.start_time &&
            ports.getStartTime(existingPayload.pid) !== undefined &&
            ports.getStartTime(existingPayload.pid) !== existingPayload.start_time);

        const health = readHealthRecord(healthPath);
        const lastWake = health ? Date.parse(health.last_wake_at) : NaN;
        const isHeartbeatStale = !Number.isNaN(lastWake) && now - lastWake > heartbeatInterval * 2;
        let lockMtimeStale = false;
        try {
          if (now - statSync(lockPath).mtimeMs > staleThreshold) lockMtimeStale = true;
        } catch {}

        if ((isReused || isHeartbeatStale) && lockMtimeStale) {
          reclaimStaleLock(
            roomId,
            readerId,
            existingPayload,
            isReused ? "pid_reused" : "heartbeat_stale",
            "stale lock holder",
            ports,
          );
        } else {
          return {
            acquired: false,
            lockFd: null,
            lockPath,
            holderPid: existingPayload.pid,
            reason: "already_running",
          };
        }
      } else {
        reclaimStaleLock(
          roomId,
          readerId,
          existingPayload,
          "pid_dead",
          `pid ${existingPayload.pid} dead`,
          ports,
        );
      }
    } else {
      try {
        unlinkSync(lockPath);
      } catch {}
    }
  }

  let fd: number;
  try {
    fd = openSync(lockPath, "wx", 0o644);
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { readonly code?: string }).code
        : undefined;
    if (code === "EEXIST") {
      let holderPid: number | null = null;
      try {
        const payload = parseDaemonLockPayload(readFileSync(lockPath, "utf8"));
        if (payload) holderPid = payload.pid;
      } catch {}
      return { acquired: false, lockFd: null, lockPath, holderPid, reason: "already_running" };
    }
    throw error;
  }
  const myPayload: LockPayload = {
    pid: process.pid,
    start_time: nowIso,
    boot_id: bootId,
    holder: `daemon:${roomId}:${readerId}`,
    host,
    created_at: nowIso,
  };

  try {
    const buffer = Buffer.from(JSON.stringify(myPayload, null, 2) + "\n", "utf8");
    writeSync(fd, buffer, 0, buffer.byteLength);
    fsyncSync(fd);
    return { acquired: true, lockFd: fd, lockPath, holderPid: process.pid };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

export function releaseDaemonLock(roomId: string, readerId: string, lockFd: number | null): void {
  try {
    if (lockFd !== null) closeSync(lockFd);
  } catch {}
  try {
    const lockPath = daemonLockPath(roomId, readerId);
    if (existsSync(lockPath)) unlinkSync(lockPath);
  } catch {}
}

export function startDaemon(options: SupervisorOptions): SupervisorResult {
  const { room, reader } = options;
  const resolved = options.policy ?? resolvePolicy();
  const ports = options.ports ?? {};
  const checkAlive = ports.isProcessAlive ?? isProcessAlive;

  const healthPath = daemonHealthPath(room, reader);
  const existingHealth = readHealthRecord(healthPath, ports);
  if (existingHealth !== null && checkAlive(existingHealth.pid)) {
    return { status: "already_running", pid: existingHealth.pid, already_running: true };
  }

  const lockCheck = daemonLockPath(room, reader);
  if (existsSync(lockCheck)) {
    let payload: LockPayload | null = null;
    try {
      payload = parseDaemonLockPayload(readFileSync(lockCheck, "utf8"));
    } catch {}
    if (payload !== null && checkAlive(payload.pid)) {
      return { status: "already_running", pid: payload.pid, already_running: true };
    }
  }

  const budget = checkRespawnBudget(room, reader, resolved.respawn_budget_per_hour, ports);
  if (!budget.allowed) {
    if (existingHealth) {
      const nowIso = new Date().toISOString();
      const errors_recent = [
        ...existingHealth.errors_recent,
        `respawn_budget_exhausted at ${nowIso}`,
      ].slice(-20);
      writeHealthRecord(healthPath, { ...existingHealth, state: "STOPPED", errors_recent }, ports);
    }
    return { status: "exhausted", reason: "respawn_budget_exhausted" };
  }

  recordRespawn(room, reader, ports);
  const command = resolved.runtime_command;
  const baseArgs =
    `${resolved.harness_path} daemon --room ${room} --as ${reader} --foreground`.split(" ");
  const args =
    options.pollIntervalMs !== undefined
      ? [...baseArgs, "--poll-interval", String(options.pollIntervalMs)]
      : baseArgs;

  const pid = ports.spawnDetached
    ? ports.spawnDetached(command, args, { detached: true, stdio: "ignore" })
    : (() => {
        const child = spawn(command, args, { detached: true, stdio: "ignore" });
        child.unref();
        return child.pid ?? null;
      })();

  if (pid === null) return { status: "failed", reason: "spawn_failed" };

  const graceMs = options.gracePeriodMs ?? 2000;
  const nowFn = ports.now ?? Date.now;
  const deadline = nowFn() + graceMs;

  let heartbeatExists = false;
  while (nowFn() <= deadline) {
    if (!checkAlive(pid)) {
      return { status: "failed", pid, reason: `daemon process ${pid} exited prematurely` };
    }
    if (existsSync(healthPath)) {
      heartbeatExists = true;
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }

  if (!checkAlive(pid)) {
    return { status: "failed", pid, reason: `daemon process ${pid} exited prematurely` };
  }

  const requireHeartbeat = options.verifyAlive ?? !ports.spawnDetached;
  if (!heartbeatExists && requireHeartbeat) {
    return { status: "failed", pid, reason: `daemon process ${pid} wrote no heartbeat` };
  }

  return { status: "started", pid };
}

export function stopDaemon(options: SupervisorOptions): SupervisorResult {
  const { room, reader } = options;
  const ports = options.ports ?? {};
  const lockPath = daemonLockPath(room, reader);
  const checkAlive = ports.isProcessAlive ?? isProcessAlive;

  let pid: number | null = null;
  if (existsSync(lockPath)) {
    try {
      const payload = parseDaemonLockPayload(readFileSync(lockPath, "utf8"));
      if (payload) pid = payload.pid;
    } catch {}
  }

  const hPath = daemonHealthPath(room, reader);
  const existingHealth = readHealthRecord(hPath, ports);
  if (existingHealth) {
    writeHealthRecord(hPath, { ...existingHealth, state: "STOPPED", watch_active: false }, ports);
  }

  if (pid !== null && checkAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }

  releaseDaemonLock(room, reader, null);
  return { status: "stopped", pid };
}
