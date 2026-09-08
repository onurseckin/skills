import { spawn, type SpawnOptions } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
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
import { releaseDaemonLock } from "./lock.ts";
import { dispatchRespawnNotification, type ExecuteNotifyOptions } from "./notify.ts";

export interface SupervisorPorts {
  readonly now?: () => number;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly getStartTime?: (pid: number) => string | undefined;
  readonly getBootId?: () => string;
  readonly existsSync?: (path: string) => boolean;
  readonly readFileSync?: (path: string, encoding: string) => string;
  readonly writeFileSync?: (path: string, content: string) => void;
  readonly writeAtomic?: (path: string, content: string) => void;
  readonly daemonRespawnPath?: (roomId: string, readerId: string) => string;
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
  readonly notifyCommand?: string | undefined;
  readonly isRespawn?: boolean;
  readonly notifyOptions?: ExecuteNotifyOptions;
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

function readLockPid(path: string): number | null {
  try {
    return existsSync(path)
      ? (parseDaemonLockPayload(readFileSync(path, "utf8"))?.pid ?? null)
      : null;
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
  const respawnPath =
    ports.daemonRespawnPath?.(roomId, readerId) ?? daemonRespawnPath(roomId, readerId);
  const now = ports.now?.() ?? Date.now();
  const recent = getRecentRespawnTimestamps(respawnPath, now - 3600000, ports);
  return { allowed: recent.length < maxPerHour, count: recent.length };
}

export function recordRespawn(roomId: string, readerId: string, ports: SupervisorPorts = {}): void {
  const respawnPath =
    ports.daemonRespawnPath?.(roomId, readerId) ?? daemonRespawnPath(roomId, readerId);
  const now = ports.now?.() ?? Date.now();
  const recent = [
    ...getRecentRespawnTimestamps(respawnPath, now - 3600000, ports),
    new Date(now).toISOString(),
  ];
  const writeFn = ports.writeAtomic ?? ports.writeFileSync ?? writeAtomic;
  writeFn(respawnPath, JSON.stringify({ timestamps: recent }, null, 2) + "\n");
}

export function reclaimStaleLock(
  roomId: string,
  readerId: string,
  prior: LockPayload,
  reason: string,
  evidence: string,
  ports: SupervisorPorts = {},
): void {
  const reclaimed_at = new Date(ports.now?.() ?? Date.now()).toISOString();
  appendAtomic(
    daemonReclaimPath(roomId, readerId),
    JSON.stringify({
      reclaimed_at,
      prior_pid: prior.pid,
      prior_start_time: prior.start_time,
      prior_boot_id: prior.boot_id,
      reason,
      evidence,
    }) + "\n",
  );
  releaseDaemonLock(roomId, readerId, null);
}

export function acquireDaemonLock(
  roomId: string,
  readerId: string,
  host: string = "unknown",
  ports: SupervisorPorts = {},
  _policy?: ChatroomPolicy,
): LockAcquisitionResult {
  const lockPath = daemonLockPath(roomId, readerId);
  const now = ports.now?.() ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const checkAlive = ports.isProcessAlive ?? isProcessAlive;
  const bootId = ports.getBootId?.() ?? getSystemBootId();

  mkdirSync(dirname(lockPath), { recursive: true });

  if (existsSync(lockPath)) {
    let existingPayload: LockPayload | null = null;
    try {
      existingPayload = parseDaemonLockPayload(readFileSync(lockPath, "utf8"));
    } catch {}

    if (existingPayload !== null) {
      if (checkAlive(existingPayload.pid)) {
        const isReused =
          Boolean(existingPayload.boot_id && existingPayload.boot_id !== bootId) ||
          Boolean(
            ports.getStartTime &&
            existingPayload.start_time &&
            ports.getStartTime(existingPayload.pid) !== undefined &&
            ports.getStartTime(existingPayload.pid) !== existingPayload.start_time,
          );

        if (isReused) {
          reclaimStaleLock(
            roomId,
            readerId,
            existingPayload,
            "pid_reused",
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
      return {
        acquired: false,
        lockFd: null,
        lockPath,
        holderPid: readLockPid(lockPath),
        reason: "already_running",
      };
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

  const lockPid = readLockPid(daemonLockPath(room, reader));
  if (lockPid !== null && checkAlive(lockPid)) {
    return { status: "already_running", pid: lockPid, already_running: true };
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
  const isRespawn =
    options.isRespawn ??
    (existingHealth !== null &&
      (!checkAlive(existingHealth.pid) || existingHealth.state === "STOPPED"));
  const notifyCmd = options.notifyCommand ?? resolved.notify_command;
  if (isRespawn && notifyCmd) {
    dispatchRespawnNotification(
      notifyCmd,
      {
        reason: "respawn",
        room,
        reader,
        ts: new Date(ports.now?.() ?? Date.now()).toISOString(),
        message: "daemon respawned, run chatroom mine to recover context",
      },
      options.notifyOptions,
    ).catch(() => {});
  }
  const command = resolved.runtime_command;
  const daemonTarget = resolved.cli_path ?? resolved.harness_path;
  const baseArgs = `${daemonTarget} daemon --room ${room} --as ${reader} --foreground`.split(" ");
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

  const fail = (reason: string): SupervisorResult => ({ status: "failed", pid, reason });
  if (pid === null) return fail("spawn_failed");

  const graceMs = options.gracePeriodMs ?? 2000;
  const nowFn = ports.now ?? Date.now;
  const deadline = nowFn() + graceMs;

  let heartbeatExists = false;
  while (nowFn() <= deadline) {
    if (!checkAlive(pid)) return fail(`daemon process ${pid} exited prematurely`);
    if (existsSync(healthPath)) {
      heartbeatExists = true;
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }

  if (!checkAlive(pid)) return fail(`daemon process ${pid} exited prematurely`);

  const requireHeartbeat = options.verifyAlive ?? !ports.spawnDetached;
  if (!heartbeatExists && requireHeartbeat) return fail(`daemon process ${pid} wrote no heartbeat`);

  return { status: "started", pid };
}

export function stopDaemon(options: SupervisorOptions): SupervisorResult {
  const { room, reader } = options;
  const ports = options.ports ?? {};
  const checkAlive = ports.isProcessAlive ?? isProcessAlive;
  const pid = readLockPid(daemonLockPath(room, reader));

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
