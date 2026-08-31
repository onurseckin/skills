import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteBytes } from "../../core/durable-write.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../../platform/index.ts";
import { detectActiveHost } from "../../platform/host-autodetect.ts";

export const DEFAULT_AUDITOR_LOCK_FILE = ".olt/locks/skill_auditor.lock";
export const DEFAULT_AUDITOR_LEASE_DURATION_MS = 300_000;

export interface AuditorLeaseLock {
  readonly auditor_id: string;
  readonly pid: number;
  readonly host_type: string;
  readonly acquired_at: string;
  readonly lease_expires_at: string;
  readonly lock_token: string;
}

export interface AcquireAuditorLeaseOptions {
  readonly auditor_id: string;
  readonly pid?: number | undefined;
  readonly host_type?: string | undefined;
  readonly leaseDurationMs?: number | undefined;
  readonly customLockPath?: string | undefined;
  readonly isPidAliveFn?: ((pid: number) => boolean) | undefined;
}

export interface ReleaseAuditorLeaseOptions {
  readonly auditor_id: string;
  readonly lock_token?: string | undefined;
  readonly customLockPath?: string | undefined;
}

export interface AssertSingletonAuditorOptions extends AcquireAuditorLeaseOptions {}

export function defaultIsPidAlive(pid: number): boolean {
  if (pid <= 0 || !Number.isInteger(pid)) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "code" in err) {
      return (err as { code?: string }).code === "EPERM";
    }
    return false;
  }
}

export function normalizeAuditorRole(roleOrId: string): string {
  return roleOrId.trim().toLowerCase().replace(/_/gu, "-");
}

function resolveLockPath(customPath?: string): string {
  return customPath?.trim()
    ? resolve(customPath.trim())
    : resolve(process.cwd(), DEFAULT_AUDITOR_LOCK_FILE);
}

function resolveHostType(hostType?: string): string {
  if (hostType && hostType.trim()) {
    return hostType.trim();
  }
  try {
    return detectActiveHost();
  } catch {
    return "antigravity";
  }
}

function delay(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withAuditorFileLock<T>(lockFilePath: string, fn: () => T, timeoutMs = 5000): T {
  const flockPath = `${lockFilePath}.flock`;
  mkdirSync(dirname(flockPath), { recursive: true });
  const fd = openSync(flockPath, constants.O_RDWR | constants.O_CREAT, 0o600);
  let locked = false;
  try {
    const start = Date.now();
    while (!locked) {
      locked = tryExclusiveFlock(fd);
      if (locked) break;
      if (Date.now() - start > timeoutMs) {
        throw new HarnessError(
          "LOCK_TIMEOUT",
          `timed out waiting for skill auditor lock: ${flockPath}`,
        );
      }
      delay(10);
    }
    return fn();
  } finally {
    if (locked) {
      try {
        releaseFlock(fd);
      } catch {}
    }
    closeSync(fd);
  }
}

export function readAuditorLeaseLock(customLockPath?: string): AuditorLeaseLock | null {
  const resolvedPath = resolveLockPath(customLockPath);
  if (!existsSync(resolvedPath)) {
    return null;
  }
  try {
    const raw = readFileSync(resolvedPath, "utf-8");
    if (!raw.trim()) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    const auditor_id =
      typeof candidate["auditor_id"] === "string" ? candidate["auditor_id"].trim() : "";
    const pid =
      typeof candidate["pid"] === "number" && Number.isInteger(candidate["pid"])
        ? candidate["pid"]
        : 0;
    const host_type =
      typeof candidate["host_type"] === "string" ? candidate["host_type"].trim() : "";
    const acquired_at =
      typeof candidate["acquired_at"] === "string" ? candidate["acquired_at"].trim() : "";
    const lease_expires_at =
      typeof candidate["lease_expires_at"] === "string" ? candidate["lease_expires_at"].trim() : "";
    const lock_token =
      typeof candidate["lock_token"] === "string" ? candidate["lock_token"].trim() : "";

    if (!auditor_id || pid <= 0 || !host_type || !acquired_at || !lease_expires_at || !lock_token) {
      return null;
    }
    return {
      auditor_id,
      pid,
      host_type,
      acquired_at,
      lease_expires_at,
      lock_token,
    };
  } catch {
    return null;
  }
}

export function acquireAuditorLeaseLock(options: AcquireAuditorLeaseOptions): AuditorLeaseLock {
  if (!options || typeof options !== "object") {
    throw new HarnessError("INVALID_ARGUMENT", "options must be an object");
  }
  if (typeof options.auditor_id !== "string" || !options.auditor_id.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "auditor_id must be a non-empty string");
  }
  const auditorId = options.auditor_id.trim();
  const normAuditorId = normalizeAuditorRole(auditorId);

  const pid = options.pid ?? process.pid;
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new HarnessError("INVALID_ARGUMENT", "pid must be a positive integer");
  }

  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_AUDITOR_LEASE_DURATION_MS;
  if (!Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0) {
    throw new HarnessError("INVALID_ARGUMENT", "leaseDurationMs must be a positive number");
  }

  const hostType = resolveHostType(options.host_type);
  const isPidAlive = options.isPidAliveFn ?? defaultIsPidAlive;
  const lockPath = resolveLockPath(options.customLockPath);

  return withAuditorFileLock(lockPath, () => {
    mkdirSync(dirname(lockPath), { recursive: true });
    const nowMs = Date.now();
    const existing = readAuditorLeaseLock(lockPath);

    if (existing !== null) {
      const expiresAtMs = Date.parse(existing.lease_expires_at);
      const isExpired = Number.isNaN(expiresAtMs) || expiresAtMs <= nowMs;
      const isAlive = isPidAlive(existing.pid);

      if (isAlive && !isExpired) {
        if (normalizeAuditorRole(existing.auditor_id) === normAuditorId && existing.pid === pid) {
          const renewed: AuditorLeaseLock = {
            auditor_id: existing.auditor_id,
            pid: existing.pid,
            host_type: hostType,
            acquired_at: existing.acquired_at,
            lease_expires_at: new Date(nowMs + leaseDurationMs).toISOString(),
            lock_token: existing.lock_token,
          };
          atomicWriteBytes(lockPath, Buffer.from(JSON.stringify(renewed, null, 2)));
          return renewed;
        }

        throw new HarnessError(
          "ROLE_CONFINEMENT_VIOLATION",
          `SINGLETON_AUDITOR_COLLISION: Active skill auditor already running (id=${existing.auditor_id}, pid=${existing.pid})`,
        );
      }
    }

    const newLease: AuditorLeaseLock = {
      auditor_id: auditorId,
      pid,
      host_type: hostType,
      acquired_at: new Date(nowMs).toISOString(),
      lease_expires_at: new Date(nowMs + leaseDurationMs).toISOString(),
      lock_token: randomUUID(),
    };
    atomicWriteBytes(lockPath, Buffer.from(JSON.stringify(newLease, null, 2)));
    return newLease;
  });
}

export function releaseAuditorLeaseLock(options: ReleaseAuditorLeaseOptions): boolean {
  if (
    !options ||
    typeof options !== "object" ||
    typeof options.auditor_id !== "string" ||
    !options.auditor_id.trim()
  ) {
    return false;
  }
  const auditorId = options.auditor_id.trim();
  const normAuditorId = normalizeAuditorRole(auditorId);
  const lockPath = resolveLockPath(options.customLockPath);

  if (!existsSync(lockPath)) {
    return false;
  }

  return withAuditorFileLock(lockPath, () => {
    const existing = readAuditorLeaseLock(lockPath);
    if (!existing) {
      return false;
    }
    if (
      existing.auditor_id !== auditorId &&
      normalizeAuditorRole(existing.auditor_id) !== normAuditorId
    ) {
      return false;
    }
    if (options.lock_token && existing.lock_token !== options.lock_token.trim()) {
      return false;
    }
    try {
      if (existsSync(lockPath)) {
        rmSync(lockPath, { force: true });
      }
      return true;
    } catch {
      return false;
    }
  });
}

export function assertSingletonSkillAuditor(
  options?: AssertSingletonAuditorOptions,
): AuditorLeaseLock {
  const auditorId = options?.auditor_id?.trim() || "skill_auditor";
  return acquireAuditorLeaseLock({
    ...options,
    auditor_id: auditorId,
  });
}
