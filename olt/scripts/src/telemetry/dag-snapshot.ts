import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import { emitTelemetryEvent } from "../reporting/telemetry-stream.ts";
import { releaseFlock, tryExclusiveFlock } from "../platform/index.ts";
import type { CircuitBreakerEvaluation } from "./circuit-breaker.ts";

export interface QuotaDagSnapshotTask {
  id: string;
  status: string;
  effortMath: string;
  agent?: string;
  dependencies: string[];
}
export interface QuotaDagSnapshotAgent {
  id: string;
  role: string;
  status: string;
}
export interface QuotaDagSnapshotWave {
  waveId: string;
  status: string;
  lanes: string[];
}
export interface QuotaDagSnapshotCron {
  cronId: string;
  expression: string;
  purpose: string;
}
export interface QuotaDagSnapshot {
  version: "2";
  repositoryRoot: string;
  runRoot: string;
  frozenAt: string;
  resumedAt?: string;
  status: "frozen" | "resumed";
  activeWave?: QuotaDagSnapshotWave;
  tasks: QuotaDagSnapshotTask[];
  agents: QuotaDagSnapshotAgent[];
  cronsSuspended: QuotaDagSnapshotCron[];
  uncommittedFiles: string[];
  lowestQuotaObserved: number | null;
  constrainedModels: string[];
  autoWakeSchedule: { resetTime: string; resumeTime: string };
}
export interface CaptureDagSnapshotOptions {
  runRoot: string;
  repositoryRoot: string;
  lowestQuotaObserved: number | null;
  constrainedModels: string[];
  resetTime: string;
}
export interface ResumeDagSnapshotOptions {
  repoRoot: string;
  runRoot: string;
  clearAfterResume?: boolean;
}
export interface ResumeDagSnapshotResult {
  restoredWaveLanes: string[];
  cronsToReRegister: QuotaDagSnapshotCron[];
  resumeDirectives: string[];
}
export const DEFAULT_QUOTA_SNAPSHOT_FILENAME = "quota-dag-snapshot.json";
export const STANDARD_SUPERVISORY_CRONS: QuotaDagSnapshotCron[] = [
  { cronId: "mind-pulse", expression: "*/5 * * * *", purpose: "Mind pulse" },
  { cronId: "mind-auditor-live", expression: "*/3 * * * *", purpose: "Mind Auditor live" },
  { cronId: "skill-auditor-live", expression: "*/3 * * * *", purpose: "Skill Auditor live" },
  { cronId: "orchestrator-cadence", expression: "*/5 * * * *", purpose: "Orchestrator cadence" },
];

type SnapshotPersistenceStage =
  | "before_write"
  | "before_file_fsync"
  | "before_rename"
  | "after_rename"
  | "before_directory_fsync";
let snapshotPersistenceHook: ((stage: SnapshotPersistenceStage) => void) | undefined;

/** @internal deterministic durability seam for the unit suite. */
export function __setDagSnapshotPersistenceTestHook(
  hook: ((stage: SnapshotPersistenceStage) => void) | undefined,
): void {
  snapshotPersistenceHook = hook;
}

function observePersistence(stage: SnapshotPersistenceStage): void {
  snapshotPersistenceHook?.(stage);
}

function isOwnCode(error: unknown, code: string): boolean {
  return error instanceof Error && Object.getOwnPropertyDescriptor(error, "code")?.value === code;
}
function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new HarnessError("INTEGRITY", `quota snapshot requires ${field}`);
  return value;
}
function timestamp(value: unknown, field: string): string {
  const result = requiredText(value, field);
  if (!Number.isFinite(Date.parse(result)))
    throw new HarnessError("INTEGRITY", `quota snapshot ${field} must be an ISO timestamp`);
  return result;
}
function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new HarnessError("INTEGRITY", `quota snapshot ${field} must be a string array`);
  return [...value];
}
function canonicalPath(repoRoot: string): string {
  return join(resolve(repoRoot), ".olt", DEFAULT_QUOTA_SNAPSHOT_FILENAME);
}
function regular(path: string, required: boolean): { dev: number; ino: number } | undefined {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.nlink !== 1)
      throw new HarnessError(
        "INTEGRITY",
        `quota snapshot must be a single-link regular file: ${path}`,
      );
    return { dev: stat.dev, ino: stat.ino };
  } catch (error) {
    if (!required && isOwnCode(error, "ENOENT")) return undefined;
    throw error;
  }
}
function secureRead(path: string, required: boolean): string | undefined {
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
function acquire(path: string, label: string): number {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const opened = fstatSync(fd);
  const visible = lstatSync(path);
  if (
    !opened.isDirectory() ||
    !visible.isDirectory() ||
    opened.dev !== visible.dev ||
    opened.ino !== visible.ino
  ) {
    closeSync(fd);
    throw new HarnessError("INTEGRITY", `${label} changed while opening`);
  }
  for (let attempt = 0; attempt < 200; attempt++) {
    if (tryExclusiveFlock(fd)) return fd;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
  closeSync(fd);
  throw new HarnessError("LOCK_TIMEOUT", `${label} is locked`);
}
function withSnapshotLock<T>(repoRoot: string, operation: (path: string) => T): T {
  const root = resolve(repoRoot);
  let rootFd: number | undefined;
  let parentFd: number | undefined;
  let primary: unknown;
  let didThrow = false;
  let result!: T;
  try {
    rootFd = acquire(root, "repository root");
    const identity = fstatSync(rootFd);
    const parent = join(root, ".olt");
    try {
      mkdirSync(parent, { mode: 0o700 });
    } catch (error) {
      if (!isOwnCode(error, "EEXIST")) throw error;
    }
    parentFd = acquire(parent, "quota snapshot parent");
    const current = lstatSync(root);
    if (current.dev !== identity.dev || current.ino !== identity.ino)
      throw new HarnessError("INTEGRITY", "repository root changed during quota snapshot mutation");
    result = operation(canonicalPath(root));
    const after = lstatSync(root);
    if (after.dev !== identity.dev || after.ino !== identity.ino)
      throw new HarnessError("INTEGRITY", "repository root changed after quota snapshot mutation");
  } catch (error) {
    didThrow = true;
    primary = error;
  }
  let cleanup: unknown;
  let cleanupThrown = false;
  for (const action of [
    () => {
      if (parentFd !== undefined) releaseFlock(parentFd);
    },
    () => {
      if (rootFd !== undefined) releaseFlock(rootFd);
    },
    () => {
      if (parentFd !== undefined) closeSync(parentFd);
    },
    () => {
      if (rootFd !== undefined) closeSync(rootFd);
    },
  ]) {
    try {
      action();
    } catch (error) {
      if (!cleanupThrown) {
        cleanup = error;
        cleanupThrown = true;
      }
    }
  }
  if (didThrow) throw primary;
  if (cleanupThrown) throw cleanup;
  return result;
}
function writeAtomic(path: string, snapshot: QuotaDagSnapshot): void {
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
      } catch (error) {
        if (!isOwnCode(error, "ENOENT")) throw error;
      }
    }
  }
}
function parseSnapshot(raw: string): QuotaDagSnapshot {
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

export async function captureDagSnapshot(
  options: CaptureDagSnapshotOptions,
): Promise<QuotaDagSnapshot> {
  const runRoot = resolve(requiredText(options.runRoot, "runRoot"));
  const repositoryRoot = resolve(requiredText(options.repositoryRoot, "repositoryRoot"));
  if (
    options.lowestQuotaObserved !== null &&
    (!Number.isFinite(options.lowestQuotaObserved) || options.lowestQuotaObserved < 0)
  )
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "lowestQuotaObserved must be null or finite and non-negative",
    );
  const resetTime = timestamp(options.resetTime, "resetTime");
  let tasks: QuotaDagSnapshotTask[] = [];
  let agents: QuotaDagSnapshotAgent[] = [];
  let activeWave: QuotaDagSnapshotWave | undefined;
  try {
    const raw = readFileSync(join(runRoot, "memory.json"), "utf8");
    const memory: unknown = JSON.parse(raw);
    if (!memory || typeof memory !== "object" || Array.isArray(memory))
      throw new HarnessError("INTEGRITY", "run memory is invalid");
    const data = memory as Record<string, unknown>;
    if (data.tasks !== undefined) {
      if (!Array.isArray(data.tasks))
        throw new HarnessError("INTEGRITY", "run memory tasks is invalid");
      tasks = data.tasks as QuotaDagSnapshotTask[];
    }
    if (data.agents !== undefined) {
      if (!Array.isArray(data.agents))
        throw new HarnessError("INTEGRITY", "run memory agents is invalid");
      agents = data.agents as QuotaDagSnapshotAgent[];
    }
    if (data.activeWave !== undefined) {
      if (!data.activeWave || typeof data.activeWave !== "object" || Array.isArray(data.activeWave))
        throw new HarnessError("INTEGRITY", "run memory activeWave is invalid");
      activeWave = data.activeWave as QuotaDagSnapshotWave;
    }
  } catch (error) {
    if (!isOwnCode(error, "ENOENT")) {
      if (error instanceof HarnessError) throw error;
      throw new HarnessError("INTEGRITY", "could not capture run memory evidence");
    }
  }
  const git = spawnSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    cwd: repositoryRoot,
    shell: false,
  });
  if (git.status !== 0)
    throw new HarnessError("INTEGRITY", "could not capture repository status evidence");
  return {
    version: "2",
    repositoryRoot,
    runRoot,
    frozenAt: new Date().toISOString(),
    status: "frozen",
    tasks,
    agents,
    cronsSuspended: STANDARD_SUPERVISORY_CRONS.map((cron) => ({ ...cron })),
    uncommittedFiles: (git.stdout ?? "")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).trim()),
    lowestQuotaObserved: options.lowestQuotaObserved,
    constrainedModels: [...options.constrainedModels],
    autoWakeSchedule: {
      resetTime,
      resumeTime: new Date(Date.parse(resetTime) + 60_000).toISOString(),
    },
    ...(activeWave ? { activeWave } : {}),
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
export async function resumeDagSnapshot(
  options: ResumeDagSnapshotOptions,
): Promise<ResumeDagSnapshotResult> {
  const repoRoot = resolve(requiredText(options.repoRoot, "repoRoot"));
  const runRoot = resolve(requiredText(options.runRoot, "runRoot"));
  return withSnapshotLock(repoRoot, (path) => {
    const raw = secureRead(path, false);
    if (raw === undefined)
      throw new HarnessError("INVALID_STATE", "no quota snapshot is available to resume");
    const snapshot = parseSnapshot(raw);
    if (snapshot.repositoryRoot !== repoRoot || snapshot.runRoot !== runRoot)
      throw new HarnessError("INTEGRITY", "quota snapshot is bound to another repository or run");
    if (snapshot.status !== "frozen")
      throw new HarnessError("INVALID_STATE", "quota snapshot is already resumed");
    if (options.clearAfterResume)
      throw new HarnessError("INVALID_ARGUMENT", "quota snapshot must remain as durable evidence");
    const resumed: QuotaDagSnapshot = {
      ...snapshot,
      status: "resumed",
      resumedAt: new Date().toISOString(),
    };
    writeAtomic(path, resumed);
    emitTelemetryEvent(
      {
        timestamp: new Date().toISOString(),
        actor: "system",
        action: "QUOTA_RESUME_SNAPSHOT",
        status: "success",
        details: { resumedAt: resumed.resumedAt!, frozenAt: snapshot.frozenAt },
      },
      repoRoot,
    );
    const restoredWaveLanes = snapshot.activeWave?.lanes ?? [];
    const cronsToReRegister = snapshot.cronsSuspended;
    return {
      restoredWaveLanes,
      cronsToReRegister,
      resumeDirectives: [
        `Re-register crons: ${cronsToReRegister.map((cron) => cron.cronId).join(", ")}`,
        `Resume wave lanes: ${restoredWaveLanes.join(", ")}`,
      ],
    };
  });
}
export function formatDagSnapshotMarkdown(
  snapshot: QuotaDagSnapshot,
  evaluation: CircuitBreakerEvaluation,
  detailed = false,
): string {
  let markdown = `## Quota DAG Snapshot\n\n- **Status**: ${snapshot.status}\n- **Frozen At**: ${snapshot.frozenAt}\n- **Lowest Quota Observed**: ${evaluation.lowestRemainingQuota ?? "None"}%\n- **Constrained Models**: ${snapshot.constrainedModels.join(", ") || "None"}\n- **Auto-Wake Resume Time**: ${snapshot.autoWakeSchedule.resumeTime}\n\n`;
  if (detailed) {
    markdown += "### Tasks\n";
    if (!snapshot.tasks.length) markdown += "*No active tasks*\n";
    for (const task of snapshot.tasks)
      markdown += `- **${task.id}**: ${task.status} (Effort: ${task.effortMath})\n`;
    markdown += "\n### Uncommitted Files\n";
    if (!snapshot.uncommittedFiles.length) markdown += "*None*\n";
    for (const file of snapshot.uncommittedFiles) markdown += `- \`${file}\`\n`;
  }
  return markdown;
}
export function formatDagResumeMarkdown(result: ResumeDagSnapshotResult, detailed = false): string {
  let markdown = `## DAG Resume State\n\n### Restored Wave Lanes\n${result.restoredWaveLanes.length ? result.restoredWaveLanes.map((lane) => `- ${lane}`).join("\n") : "*None*"}\n\n### Crons to Re-Register\n${result.cronsToReRegister.length ? result.cronsToReRegister.map((cron) => `- **${cron.cronId}**: \`${cron.expression}\` (${cron.purpose})`).join("\n") : "*None*"}\n`;
  if (detailed && result.resumeDirectives.length)
    markdown += `\n### Directives\n${result.resumeDirectives.map((directive) => `- ${directive}`).join("\n")}\n`;
  return markdown;
}
