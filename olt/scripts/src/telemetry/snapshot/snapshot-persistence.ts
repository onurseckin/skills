import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { emitTelemetryEvent } from "../../reporting/telemetry-stream.ts";
import {
  DEFAULT_QUOTA_SNAPSHOT_FILENAME,
  type QuotaDagSnapshot,
  type QuotaDagSnapshotAgent,
  type QuotaDagSnapshotCron,
  type QuotaDagSnapshotTask,
  type QuotaDagSnapshotWave,
  type SnapshotPersistenceStage,
} from "./types.ts";
import { regular, withSnapshotLock } from "./snapshot-lock.ts";

export { withSnapshotLock };

let snapshotPersistenceHook: ((stage: SnapshotPersistenceStage) => void) | undefined;

export function __setDagSnapshotPersistenceTestHook(
  hook: ((stage: SnapshotPersistenceStage) => void) | undefined,
): void {
  snapshotPersistenceHook = hook;
}

export function observePersistence(stage: SnapshotPersistenceStage): void {
  snapshotPersistenceHook?.(stage);
}

export function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new HarnessError("INTEGRITY", `quota snapshot requires ${field}`);
  return value;
}

export function timestamp(value: unknown, field: string): string {
  const result = requiredText(value, field);
  if (!Number.isFinite(Date.parse(result)))
    throw new HarnessError("INTEGRITY", `quota snapshot ${field} must be an ISO timestamp`);
  return result;
}

export function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new HarnessError("INTEGRITY", `quota snapshot ${field} must be a string array`);
  return [...value];
}

export function secureRead(path: string, required: boolean): string | undefined {
  const before = regular(path, required);
  if (!before) return undefined;
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    )
      throw new HarnessError("INTEGRITY", "quota snapshot changed while opening");
    const raw = readFileSync(fd, "utf8");
    const after = regular(path, true)!;
    if (after.dev !== opened.dev || after.ino !== opened.ino)
      throw new HarnessError("INTEGRITY", "quota snapshot changed while reading");
    return raw;
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw new HarnessError("INTEGRITY", "could not securely read quota snapshot");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function writeAtomic(path: string, snapshot: QuotaDagSnapshot): void {
  const old = regular(path, false);
  const parent = dirname(path);
  const temporary = join(
    parent,
    `.${DEFAULT_QUOTA_SNAPSHOT_FILENAME}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  let fd: number | undefined;
  let dirFd: number | undefined;
  let renamed = false;
  try {
    const bytes = Buffer.from(JSON.stringify(snapshot, null, 2));
    fd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    for (let offset = 0; offset < bytes.byteLength;) {
      observePersistence("before_write");
      const written = writeSync(fd, bytes, offset, bytes.byteLength - offset);
      if (written <= 0)
        throw new HarnessError("INTEGRITY", "quota snapshot write made no progress");
      offset += written;
    }
    observePersistence("before_file_fsync");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    const current = regular(path, false);
    if (
      (old === undefined) !== (current === undefined) ||
      (old && (!current || old.dev !== current.dev || old.ino !== current.ino))
    )
      throw new HarnessError("INTEGRITY", "quota snapshot changed before replacement");
    observePersistence("before_rename");
    renameSync(temporary, path);
    renamed = true;
    observePersistence("after_rename");
    dirFd = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    observePersistence("before_directory_fsync");
    fsyncSync(dirFd);
  } catch (error) {
    if (renamed)
      throw new HarnessError(
        "INTEGRITY",
        "quota snapshot outcome is uncertain after atomic rename",
      );
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (dirFd !== undefined) closeSync(dirFd);
    if (!renamed) {
      try {
        unlinkSync(temporary);
      } catch {}
    }
  }
}

export function parseSnapshot(raw: string): QuotaDagSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HarnessError("INTEGRITY", "quota snapshot contains invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new HarnessError("INTEGRITY", "quota snapshot must be an object");
  const record = parsed as Record<string, unknown>;
  if (record.version !== "2")
    throw new HarnessError("INTEGRITY", "quota snapshot version is unsupported");
  if (record.status !== "frozen" && record.status !== "resumed")
    throw new HarnessError("INTEGRITY", "quota snapshot status is invalid");
  if (
    record.lowestQuotaObserved !== null &&
    (typeof record.lowestQuotaObserved !== "number" || !Number.isFinite(record.lowestQuotaObserved))
  )
    throw new HarnessError("INTEGRITY", "quota snapshot lowestQuotaObserved is invalid");
  if (
    !record.autoWakeSchedule ||
    typeof record.autoWakeSchedule !== "object" ||
    Array.isArray(record.autoWakeSchedule)
  )
    throw new HarnessError("INTEGRITY", "quota snapshot autoWakeSchedule is invalid");
  for (const name of ["tasks", "agents", "cronsSuspended"] as const)
    if (!Array.isArray(record[name]))
      throw new HarnessError("INTEGRITY", `quota snapshot ${name} is invalid`);
  const wake = record.autoWakeSchedule as Record<string, unknown>;
  return {
    version: "2",
    repositoryRoot: resolve(requiredText(record.repositoryRoot, "repositoryRoot")),
    runRoot: resolve(requiredText(record.runRoot, "runRoot")),
    frozenAt: timestamp(record.frozenAt, "frozenAt"),
    ...(record.resumedAt === undefined
      ? {}
      : { resumedAt: timestamp(record.resumedAt, "resumedAt") }),
    status: record.status,
    tasks: record.tasks as QuotaDagSnapshotTask[],
    agents: record.agents as QuotaDagSnapshotAgent[],
    cronsSuspended: record.cronsSuspended as QuotaDagSnapshotCron[],
    uncommittedFiles: strings(record.uncommittedFiles, "uncommittedFiles"),
    lowestQuotaObserved: record.lowestQuotaObserved,
    constrainedModels: strings(record.constrainedModels, "constrainedModels"),
    autoWakeSchedule: {
      resetTime: timestamp(wake.resetTime, "resetTime"),
      resumeTime: timestamp(wake.resumeTime, "resumeTime"),
    },
    ...(record.activeWave === undefined
      ? {}
      : { activeWave: record.activeWave as QuotaDagSnapshotWave }),
  };
}

export function persistDagSnapshot(snapshot: QuotaDagSnapshot): string {
  const checked = parseSnapshot(JSON.stringify(snapshot));
  return withSnapshotLock(checked.repositoryRoot, (path) => {
    writeAtomic(path, checked);
    emitTelemetryEvent(
      {
        timestamp: new Date().toISOString(),
        actor: "system",
        action: "QUOTA_FREEZE_SNAPSHOT",
        status: "success",
        details: {
          frozenAt: checked.frozenAt,
          lowestQuotaObserved: checked.lowestQuotaObserved,
          constrainedModels: checked.constrainedModels,
        },
      },
      checked.repositoryRoot,
    );
    return path;
  });
}

export function loadDagSnapshot(repoRoot: string): QuotaDagSnapshot | undefined {
  return withSnapshotLock(repoRoot, (path) => {
    const raw = secureRead(path, false);
    return raw === undefined ? undefined : parseSnapshot(raw);
  });
}
