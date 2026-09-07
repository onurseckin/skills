import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { inspectRoom, type RoomHealthReport } from "./inspect.ts";

export interface StaleLockRepair {
  readonly path: string;
  readonly pid: number | null;
  readonly reclaimed: boolean;
  readonly error: string | null;
}

export interface TornSpoolRepair {
  readonly reader: string;
  readonly spool_path: string;
  readonly original_bytes: number;
  readonly repaired_bytes: number;
  readonly truncated_bytes: number;
  readonly valid_lines: number;
  readonly repaired: boolean;
}

export interface DaemonRestartRepair {
  readonly reader: string;
  readonly restarted: boolean;
  readonly error: string | null;
}

export interface RoomRepairReport {
  readonly room: string;
  readonly reclaimed_locks: readonly StaleLockRepair[];
  readonly repaired_spools: readonly TornSpoolRepair[];
  readonly restarted_daemons: readonly DaemonRestartRepair[];
  readonly total_repairs: number;
  readonly success: boolean;
}

export interface DoctorRepairOptions {
  readonly room?: string;
  readonly as?: string;
  readonly reader?: string;
  readonly baseDir?: string;
  readonly now?: () => number;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly ensureDaemon?: (room: string, reader: string) => Promise<unknown> | unknown;
}

export interface DoctorRepairResult {
  readonly reports: readonly RoomRepairReport[];
  readonly total_repairs: number;
  readonly success: boolean;
  readonly summary: string;
}

function checkProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return typeof err === "object" && err !== null && "code" in err && err.code === "EPERM";
  }
}

function resolveDataDir(override?: string): string {
  if (override !== undefined && override.length > 0) return override;
  const envHome = process.env["CHATROOM_HOME"];
  if (envHome !== undefined && envHome.length > 0) return envHome;
  const envDir = process.env["CHATROOM_DIR"];
  return envDir !== undefined && envDir.length > 0
    ? envDir
    : join(homedir(), ".agents", "chatroom");
}

function readJsonSafely(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const res = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return typeof res === "object" && res !== null ? (res as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function recordReclaimAudit(
  roomDir: string,
  lockPath: string,
  pid: number | null,
  nowMs: number,
): void {
  try {
    const daemonDir = join(roomDir, "daemon");
    if (!existsSync(daemonDir)) mkdirSync(daemonDir, { recursive: true });
    const auditFile = join(daemonDir, "reclaim.jsonl");
    const entry =
      JSON.stringify({
        ts: new Date(nowMs).toISOString(),
        lock_path: lockPath,
        pid,
        reason: "dead_process",
      }) + "\n";
    appendFileSync(auditFile, entry);
  } catch {
    return;
  }
}

function reclaimStaleLocks(
  roomDir: string,
  nowMs: number,
  aliveCheck: (pid: number) => boolean,
): readonly StaleLockRepair[] {
  const locksDir = join(roomDir, "locks");
  if (!existsSync(locksDir)) return [];
  const results: StaleLockRepair[] = [];
  function scan(dir: string): void {
    for (const item of readdirSync(dir)) {
      const full = join(dir, item);
      const st = statSync(full);
      if (st.isDirectory()) {
        scan(full);
      } else if (item.endsWith(".lock")) {
        const parsed = readJsonSafely(full);
        const pid = parsed !== null && typeof parsed["pid"] === "number" ? parsed["pid"] : null;
        let shouldReclaim = false;
        if (pid !== null && !aliveCheck(pid)) {
          shouldReclaim = true;
        } else if (nowMs - st.mtimeMs > 30000 && parsed === null) {
          shouldReclaim = true;
        }
        if (shouldReclaim) {
          try {
            unlinkSync(full);
            recordReclaimAudit(roomDir, full, pid, nowMs);
            results.push({ path: full, pid, reclaimed: true, error: null });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            results.push({ path: full, pid, reclaimed: false, error: msg });
          }
        }
      }
    }
  }
  scan(locksDir);
  return results;
}

function repairSpoolFile(spoolPath: string, reader: string): TornSpoolRepair {
  if (!existsSync(spoolPath)) {
    return {
      reader,
      spool_path: spoolPath,
      original_bytes: 0,
      repaired_bytes: 0,
      truncated_bytes: 0,
      valid_lines: 0,
      repaired: false,
    };
  }
  const originalBytes = statSync(spoolPath).size;
  const content = readFileSync(spoolPath, "utf-8");
  const rawLines = content.split("\n");
  const validLines: string[] = [];
  let hasTorn = false;
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line === undefined) continue;
    if (i === rawLines.length - 1 && line.trim().length === 0) continue;
    if (line.trim().length === 0) continue;
    try {
      JSON.parse(line);
      validLines.push(line);
    } catch {
      hasTorn = true;
      break;
    }
  }
  if (!hasTorn) {
    return {
      reader,
      spool_path: spoolPath,
      original_bytes: originalBytes,
      repaired_bytes: originalBytes,
      truncated_bytes: 0,
      valid_lines: validLines.length,
      repaired: false,
    };
  }
  const repairedContent = validLines.length > 0 ? validLines.join("\n") + "\n" : "";
  writeFileSync(spoolPath, repairedContent, "utf-8");
  const repairedBytes = Buffer.byteLength(repairedContent, "utf-8");
  return {
    reader,
    spool_path: spoolPath,
    original_bytes: originalBytes,
    repaired_bytes: repairedBytes,
    truncated_bytes: Math.max(0, originalBytes - repairedBytes),
    valid_lines: validLines.length,
    repaired: true,
  };
}

function repairTornSpools(roomDir: string, readers: readonly string[]): readonly TornSpoolRepair[] {
  const daemonDir = join(roomDir, "daemon");
  if (!existsSync(daemonDir)) return [];
  const results: TornSpoolRepair[] = [];
  const targetReaders = new Set<string>(readers);
  for (const item of readdirSync(daemonDir).filter((n) => n.endsWith(".out.jsonl"))) {
    const reader = item.slice(0, -".out.jsonl".length);
    if (targetReaders.size > 0 && !targetReaders.has(reader)) continue;
    const spoolPath = join(daemonDir, item);
    const repair = repairSpoolFile(spoolPath, reader);
    if (repair.repaired) results.push(repair);
  }
  return results;
}

async function restartStoppedDaemons(
  room: string,
  stoppedReaders: readonly string[],
  customEnsure?: (room: string, reader: string) => Promise<unknown> | unknown,
): Promise<readonly DaemonRestartRepair[]> {
  const results: DaemonRestartRepair[] = [];
  for (const reader of stoppedReaders) {
    if (customEnsure !== undefined) {
      try {
        await customEnsure(room, reader);
        results.push({ reader, restarted: true, error: null });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ reader, restarted: false, error: msg });
      }
      continue;
    }
    try {
      const daemonMod = (await import("../daemon/index.ts")) as Record<string, unknown>;
      if (typeof daemonMod["ensureDaemon"] === "function") {
        const fn = daemonMod["ensureDaemon"] as (r: string, rd: string) => Promise<unknown>;
        await fn(room, reader);
        results.push({ reader, restarted: true, error: null });
      } else {
        results.push({
          reader,
          restarted: false,
          error: "ensureDaemon not exported from daemon facade",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ reader, restarted: false, error: msg });
    }
  }
  return results;
}

export async function repairRoom(
  room: string,
  options: DoctorRepairOptions = {},
): Promise<RoomRepairReport> {
  const baseDir = resolveDataDir(options.baseDir);
  const roomDir = join(baseDir, "rooms", room);
  if (!existsSync(roomDir)) {
    return {
      room,
      reclaimed_locks: [],
      repaired_spools: [],
      restarted_daemons: [],
      total_repairs: 0,
      success: true,
    };
  }
  const nowMs = options.now ? options.now() : Date.now();
  const inspectOpts = {
    ...(options.baseDir !== undefined ? { baseDir: options.baseDir } : {}),
    ...(options.reader !== undefined ? { reader: options.reader } : {}),
    ...(options.as !== undefined ? { as: options.as } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.isProcessAlive !== undefined ? { isProcessAlive: options.isProcessAlive } : {}),
  };
  const inspection = inspectRoom(room, inspectOpts);
  const aliveCheck = options.isProcessAlive ?? checkProcessAlive;
  const reclaimedLocks = reclaimStaleLocks(roomDir, nowMs, aliveCheck);
  const readerNames = inspection.readers.map((r) => r.reader);
  const repairedSpools = repairTornSpools(roomDir, readerNames);
  const stoppedReaders = inspection.readers
    .filter((r) => r.daemon_state === "STOPPED")
    .map((r) => r.reader);
  const restartedDaemons = await restartStoppedDaemons(room, stoppedReaders, options.ensureDaemon);
  const totalRepairs =
    reclaimedLocks.filter((l) => l.reclaimed).length +
    repairedSpools.filter((s) => s.repaired).length +
    restartedDaemons.filter((d) => d.restarted).length;
  const success =
    reclaimedLocks.every((l) => l.error === null) &&
    restartedDaemons.every((d) => d.error === null);
  return {
    room,
    reclaimed_locks: reclaimedLocks,
    repaired_spools: repairedSpools,
    restarted_daemons: restartedDaemons,
    total_repairs: totalRepairs,
    success,
  };
}

export async function repairAllRooms(
  options: DoctorRepairOptions = {},
): Promise<DoctorRepairResult> {
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
  const reports: RoomRepairReport[] = [];
  for (const r of roomNames) {
    reports.push(await repairRoom(r, options));
  }
  const totalRepairs = reports.reduce((acc, rep) => acc + rep.total_repairs, 0);
  const success = reports.every((r) => r.success);
  const summary =
    totalRepairs === 0
      ? "No repairs needed."
      : `Completed ${totalRepairs} repair(s) across ${reports.length} room(s).`;
  return { reports, total_repairs: totalRepairs, success, summary };
}
