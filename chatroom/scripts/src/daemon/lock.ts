import { closeSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import {
  daemonHealthPath,
  daemonLockPath,
  isLockPayload,
  isProcessAlive,
  type LockPayload,
} from "../core/index.ts";

export interface DaemonLockPorts {
  readonly existsSync?: ((path: string) => boolean) | undefined;
  readonly readFileSync?: ((path: string, encoding: string) => string) | undefined;
  readonly unlinkSync?: ((path: string) => void) | undefined;
  readonly closeSync?: ((fd: number) => void) | undefined;
  readonly isProcessAlive?: ((pid: number) => boolean) | undefined;
  readonly now?: (() => number) | undefined;
}

export interface DaemonLockVerification {
  readonly valid: boolean;
  readonly holderPid: number | null;
  readonly reason?: "missing" | "stolen" | "corrupt";
}

export function parseDaemonLockPayload(raw: string): LockPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isLockPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readLockPid(lockPath: string, ports?: DaemonLockPorts): number | null {
  const existsFn = ports?.existsSync ?? existsSync;
  const readFn = ports?.readFileSync ?? readFileSync;
  try {
    return existsFn(lockPath)
      ? (parseDaemonLockPayload(readFn(lockPath, "utf8"))?.pid ?? null)
      : null;
  } catch {
    return null;
  }
}

export function releaseDaemonLock(
  roomId: string,
  readerId: string,
  lockFd: number | null,
  expectedPid?: number,
  ports?: DaemonLockPorts,
): void {
  const closeFn = ports?.closeSync ?? closeSync;
  const unlinkFn = ports?.unlinkSync ?? unlinkSync;
  const lockPath = daemonLockPath(roomId, readerId);
  try {
    if (lockFd !== null) closeFn(lockFd);
  } catch {}
  if (expectedPid !== undefined) {
    const currentPid = readLockPid(lockPath, ports);
    if (currentPid !== expectedPid) {
      return;
    }
  }
  try {
    unlinkFn(lockPath);
  } catch {}
}

export function verifyDaemonLock(
  room: string,
  reader: string,
  expectedPid: number,
  ports?: DaemonLockPorts,
): DaemonLockVerification {
  const lockPath = daemonLockPath(room, reader);
  const existsFn = ports?.existsSync ?? existsSync;
  const readFn = ports?.readFileSync ?? readFileSync;
  const checkAlive = ports?.isProcessAlive ?? isProcessAlive;

  if (!existsFn(lockPath)) {
    return { valid: false, holderPid: null, reason: "missing" };
  }

  let payload: LockPayload | null = null;
  try {
    payload = parseDaemonLockPayload(readFn(lockPath, "utf8"));
  } catch {}

  if (payload === null) {
    return { valid: false, holderPid: null, reason: "corrupt" };
  }

  if (payload.pid !== expectedPid) {
    return { valid: false, holderPid: payload.pid, reason: "stolen" };
  }

  if (!checkAlive(payload.pid)) {
    return { valid: false, holderPid: payload.pid, reason: "corrupt" };
  }

  return { valid: true, holderPid: payload.pid };
}

export function purgeStaleDaemonLockAndHealth(
  room: string,
  reader: string,
  ports?: DaemonLockPorts,
): boolean {
  const lockPath = daemonLockPath(room, reader);
  const healthPath = daemonHealthPath(room, reader);
  const existsFn = ports?.existsSync ?? existsSync;
  const readFn = ports?.readFileSync ?? readFileSync;
  const unlinkFn = ports?.unlinkSync ?? unlinkSync;
  const checkAlive = ports?.isProcessAlive ?? isProcessAlive;

  let purged = false;

  if (existsFn(lockPath)) {
    let payload: LockPayload | null = null;
    try {
      payload = parseDaemonLockPayload(readFn(lockPath, "utf8"));
    } catch {}

    if (payload === null || !checkAlive(payload.pid)) {
      try {
        unlinkFn(lockPath);
        purged = true;
      } catch {}
      if (existsFn(healthPath)) {
        try {
          unlinkFn(healthPath);
          purged = true;
        } catch {}
      }
      return purged;
    }
  }

  if (existsFn(healthPath)) {
    try {
      const raw = readFn(healthPath, "utf8");
      const healthData = JSON.parse(raw) as { pid?: unknown };
      if (typeof healthData?.pid === "number") {
        if (!checkAlive(healthData.pid)) {
          unlinkFn(healthPath);
          purged = true;
        }
      }
    } catch {}
  }

  return purged;
}

export interface CheckLockLossOptions {
  readonly room: string;
  readonly reader: string;
  readonly expectedPid: number;
  readonly ports?: DaemonLockPorts | undefined;
  readonly onLockLoss?: ((reason: "missing" | "stolen" | "corrupt") => void) | undefined;
  readonly onStop: () => void;
}

export interface LockLossOutcome {
  readonly valid: boolean;
  readonly reason?: "missing" | "stolen" | "corrupt" | undefined;
  readonly message?: string | undefined;
}

export function checkAndHandleLockLoss(options: CheckLockLossOptions): LockLossOutcome {
  const { room, reader, expectedPid, ports, onLockLoss, onStop } = options;
  const lockCheck = verifyDaemonLock(room, reader, expectedPid, ports);
  if (!lockCheck.valid) {
    const reason = lockCheck.reason ?? "missing";
    try {
      process.stderr.write(`daemon: self-terminating cleanly on lock loss (${reason})\n`);
    } catch {}
    onLockLoss?.(reason);
    onStop();
    return {
      valid: false,
      reason,
      message: `daemon self-terminated due to lock loss (${reason})`,
    };
  }
  return { valid: true };
}
