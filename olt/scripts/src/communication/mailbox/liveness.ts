import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { dirname, join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { isProcessAlive } from "../locking/index.ts";
import { loadMailboxCursor } from "./cursor-tracker.ts";
import {
  DEFAULT_DELIVERY_TIMEOUT_MS,
  DEFAULT_LISTENER_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_LISTENER_STALE_THRESHOLD_MS,
  isValidListenerHeartbeat,
  parseIsoOrThrow,
  requireValidActor,
  requireValidPid,
  type InspectListenerLivenessOptions,
  type ListenerHeartbeat,
  type ListenerLivenessResult,
  type ListenerLivenessState,
  type ListenerLivenessStatus,
  type LivenessTarget,
  type LivenessTargetOpt,
  type RecordListenerHeartbeatOptions,
  type RecordListenerStoppedOptions,
} from "./liveness-types.ts";
import {
  isVirtualMailboxPath,
  resolveListenerHeartbeatPath,
  resolveMailboxPaths,
} from "./mailbox-paths.ts";
import { getInMemoryMailbox, shouldUseInMemory, writeAndSync } from "./mailbox-stream.ts";

export {
  DEFAULT_DELIVERY_TIMEOUT_MS,
  DEFAULT_LISTENER_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_LISTENER_STALE_THRESHOLD_MS,
  isValidListenerHeartbeat,
};
export type {
  InspectListenerLivenessOptions,
  ListenerHeartbeat,
  ListenerLivenessResult,
  ListenerLivenessState,
  ListenerLivenessStatus,
  RecordListenerHeartbeatOptions,
  RecordListenerStoppedOptions,
};

type T = LivenessTarget;
type O = LivenessTargetOpt;

const inMemoryHeartbeats = new Map<string, ListenerHeartbeat>();
export const getInMemoryHeartbeat = (path: string): ListenerHeartbeat | undefined =>
  inMemoryHeartbeats.get(path);
export const setInMemoryHeartbeat = (path: string, heartbeat: ListenerHeartbeat): void => {
  inMemoryHeartbeats.set(path, { ...heartbeat });
};
export const clearInMemoryHeartbeats = (): void => {
  inMemoryHeartbeats.clear();
};
export const resetInMemoryHeartbeats = clearInMemoryHeartbeats;

function syncDirectory(dirPath: string): void {
  try {
    const fd = fs.openSync(dirPath, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {}
}

function writeHeartbeatAtomically(heartbeatPath: string, heartbeat: ListenerHeartbeat): void {
  inMemoryHeartbeats.set(heartbeatPath, { ...heartbeat });
  if (isVirtualMailboxPath(heartbeatPath)) return;
  const dir = dirname(heartbeatPath);
  const tempPath = join(dir, `.heartbeat-${randomUUID()}.tmp`);
  try {
    writeAndSync(
      tempPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC,
      JSON.stringify(heartbeat, null, 2) + "\n",
    );
    fs.renameSync(tempPath, heartbeatPath);
    syncDirectory(dir);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
    throw new HarnessError(
      "INTEGRITY",
      `Failed to write heartbeat file atomically '${heartbeatPath}': ${String(error)}`,
    );
  }
}

export function readListenerHeartbeat(actor: string, runRoot?: string): ListenerHeartbeat | null {
  requireValidActor(actor);
  const heartbeatPath = resolveListenerHeartbeatPath(actor, runRoot);
  if (isVirtualMailboxPath(heartbeatPath)) return inMemoryHeartbeats.get(heartbeatPath) ?? null;
  try {
    if (!fs.existsSync(heartbeatPath)) return null;
    const parsed: unknown = JSON.parse(fs.readFileSync(heartbeatPath, "utf8"));
    if (!isValidListenerHeartbeat(parsed)) return null;
    const lastDelivered = parsed.last_delivered_timestamp ?? parsed.lastDeliveredTimestamp ?? null;
    const stoppedAt = parsed.stopped_at ?? parsed.stoppedAt ?? null;
    const exitCode = parsed.exit_code ?? parsed.exitCode ?? null;
    return {
      actor: parsed.actor,
      pid: parsed.pid,
      timestamp: parsed.timestamp,
      last_delivered_timestamp: lastDelivered,
      lastDeliveredTimestamp: lastDelivered,
      status: parsed.status ?? "running",
      stopped_at: stoppedAt,
      stoppedAt,
      exit_code: exitCode,
      exitCode,
      reason: parsed.reason ?? null,
    };
  } catch {
    return null;
  }
}
export const loadListenerHeartbeat = readListenerHeartbeat;

export function removeListenerHeartbeat(actor: string, runRoot?: string): void {
  requireValidActor(actor);
  recordListenerStopped(actor, runRoot, "listener_exit");
}

export function deleteListenerHeartbeat(actor: string, runRoot?: string): void {
  requireValidActor(actor);
  const heartbeatPath = resolveListenerHeartbeatPath(actor, runRoot);
  inMemoryHeartbeats.delete(heartbeatPath);
  if (!isVirtualMailboxPath(heartbeatPath)) {
    try {
      if (fs.existsSync(heartbeatPath)) fs.unlinkSync(heartbeatPath);
    } catch {}
  }
}

export function recordListenerHeartbeat(
  actorOrOptions: string | RecordListenerHeartbeatOptions,
  options?: Omit<RecordListenerHeartbeatOptions, "actor">,
): ListenerHeartbeat {
  const opts = typeof actorOrOptions === "string" ? (options ?? {}) : actorOrOptions;
  const actor = requireValidActor(
    typeof actorOrOptions === "string" ? actorOrOptions : actorOrOptions.actor,
  );
  const runRoot = opts.runRoot ?? opts.baseDir;
  const heartbeatPath = resolveListenerHeartbeatPath(actor, runRoot);
  const pid = requireValidPid(opts.pid !== undefined ? opts.pid : process.pid);
  const timestamp = parseIsoOrThrow(opts.timestamp ?? new Date().toISOString(), "timestamp");
  let lastDelivered =
    opts.last_delivered_timestamp !== undefined
      ? opts.last_delivered_timestamp
      : opts.lastDeliveredTimestamp;
  if (lastDelivered === undefined) {
    lastDelivered = readListenerHeartbeat(actor, runRoot)?.last_delivered_timestamp ?? null;
  } else if (
    lastDelivered !== null &&
    (typeof lastDelivered !== "string" || Number.isNaN(Date.parse(lastDelivered)))
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Invalid lastDeliveredTimestamp '${String(lastDelivered)}'`,
    );
  }
  const heartbeat: ListenerHeartbeat = {
    actor,
    pid,
    timestamp,
    last_delivered_timestamp: lastDelivered,
    lastDeliveredTimestamp: lastDelivered,
    status: opts.status ?? "running",
    stopped_at: null,
    stoppedAt: null,
    exit_code: null,
    exitCode: null,
    reason: null,
  };
  writeHeartbeatAtomically(heartbeatPath, heartbeat);
  return heartbeat;
}
export const emitListenerHeartbeat = recordListenerHeartbeat;

export function recordListenerStopped(
  actorOrOptions: string | RecordListenerStoppedOptions,
  baseDirOrOptions?: string | RecordListenerStoppedOptions,
  reasonOrCode?: string | number,
  exitCodeArg?: number,
): ListenerHeartbeat {
  const isObj = typeof actorOrOptions === "object" && actorOrOptions !== null;
  const baseObj =
    typeof baseDirOrOptions === "object" && baseDirOrOptions !== null
      ? baseDirOrOptions
      : undefined;
  const opts: RecordListenerStoppedOptions = isObj ? actorOrOptions : (baseObj ?? {});
  const actor = requireValidActor(isObj ? opts.actor : actorOrOptions);
  const baseDir =
    opts.baseDir ??
    opts.runRoot ??
    (typeof baseDirOrOptions === "string" ? baseDirOrOptions : undefined);
  const heartbeatPath = resolveListenerHeartbeatPath(actor, baseDir);
  const existing = readListenerHeartbeat(actor, baseDir);
  const pid = requireValidPid(opts.pid ?? existing?.pid ?? process.pid);
  const stoppedAt = parseIsoOrThrow(
    opts.stopped_at ?? opts.stoppedAt ?? new Date().toISOString(),
    "stoppedAt",
  );
  const timestamp = existing?.timestamp ?? stoppedAt;
  const lastDelivered = existing?.last_delivered_timestamp ?? null;
  const reason =
    opts.reason ?? (typeof reasonOrCode === "string" ? reasonOrCode : "Listener stopped");
  let resolvedCode = opts.exit_code ?? opts.exitCode;
  if (resolvedCode === undefined && typeof reasonOrCode === "number") resolvedCode = reasonOrCode;
  if (resolvedCode === undefined && exitCodeArg !== undefined) resolvedCode = exitCodeArg;
  const exitCode = resolvedCode ?? 0;
  const heartbeat: ListenerHeartbeat = {
    actor,
    pid,
    timestamp,
    last_delivered_timestamp: lastDelivered,
    lastDeliveredTimestamp: lastDelivered,
    status: "stopped",
    stopped_at: stoppedAt,
    stoppedAt,
    reason,
    exit_code: exitCode,
    exitCode,
  };
  writeHeartbeatAtomically(heartbeatPath, heartbeat);
  return heartbeat;
}

function countPendingMessages(inboxPath: string, cursorPath: string): number {
  try {
    const lines = shouldUseInMemory(inboxPath)
      ? (getInMemoryMailbox(inboxPath) ?? [])
      : fs.existsSync(inboxPath)
        ? fs.readFileSync(inboxPath, "utf8").split("\n")
        : [];
    const nonBlank = lines.filter((l) => l.trim().length > 0);
    if (nonBlank.length === 0) return 0;
    const cur = loadMailboxCursor(cursorPath);
    if (cur.last_read_sequence <= 0 && cur.seen_ids.length === 0) return nonBlank.length;
    let unread = 0;
    for (const line of nonBlank) {
      try {
        const p = JSON.parse(line) as { id?: unknown; sequence?: unknown };
        if (
          typeof p.sequence === "number" &&
          p.sequence > cur.last_read_sequence &&
          (typeof p.id !== "string" || !cur.seen_ids.includes(p.id))
        )
          unread++;
      } catch {
        unread++;
      }
    }
    return unread;
  } catch {
    return 0;
  }
}

function buildResult(
  status: ListenerLivenessStatus,
  reason: string,
  heartbeat: ListenerHeartbeat | null = null,
  pid: number | null = null,
  isProcessAlive: boolean = false,
  heartbeatAgeMs: number | null = null,
  lastDeliveredAgeMs: number | null = null,
): ListenerLivenessResult {
  return {
    status,
    state: status.toUpperCase() as ListenerLivenessState,
    isRunning: status === "running_and_delivering" || status === "no_messages",
    isDelivering: status === "running_and_delivering",
    isWedged: status === "wedged",
    isStopped: status === "stopped",
    hasNoMessages: status === "no_messages",
    heartbeat,
    pid,
    isProcessAlive,
    heartbeatAgeMs,
    lastDeliveredAgeMs,
    reason,
  };
}

export function inspectListenerLiveness(
  actorOrOptions: string | InspectListenerLivenessOptions,
  options?: InspectListenerLivenessOptions | string,
): ListenerLivenessResult {
  const opts: InspectListenerLivenessOptions =
    typeof actorOrOptions === "string"
      ? typeof options === "string"
        ? { baseDir: options }
        : (options ?? {})
      : actorOrOptions;
  const actor = requireValidActor(
    typeof actorOrOptions === "string" ? actorOrOptions : actorOrOptions.actor,
  );
  const runRoot = opts.runRoot ?? opts.baseDir;
  const staleThresholdMs = opts.staleThresholdMs ?? DEFAULT_LISTENER_HEARTBEAT_TIMEOUT_MS;
  const deliveryThresholdMs = opts.deliveryThresholdMs ?? DEFAULT_DELIVERY_TIMEOUT_MS;
  const now = opts.nowMs ?? Date.now();
  const heartbeat =
    opts.heartbeat !== undefined ? opts.heartbeat : readListenerHeartbeat(actor, runRoot);
  if (!heartbeat) return buildResult("stopped", "No heartbeat found for actor");
  const pid = heartbeat.pid;
  const processAlive = isProcessAlive(pid);
  const heartbeatAgeMs = Math.max(0, now - Date.parse(heartbeat.timestamp));
  const lastDelivered =
    heartbeat.last_delivered_timestamp ?? heartbeat.lastDeliveredTimestamp ?? null;
  const lastDeliveredAgeMs = lastDelivered ? Math.max(0, now - Date.parse(lastDelivered)) : null;
  let status: ListenerLivenessStatus;
  let reason: string;
  if (heartbeat.status === "stopped") {
    status = "stopped";
    reason = heartbeat.reason ? `Listener stopped: ${heartbeat.reason}` : "Listener stopped";
  } else if (!processAlive) {
    status = "stopped";
    reason = `Process with PID ${pid} is not alive`;
  } else if (heartbeatAgeMs > staleThresholdMs) {
    status = "wedged";
    reason = `Heartbeat stale: last heartbeat was ${heartbeatAgeMs}ms ago (threshold: ${staleThresholdMs}ms)`;
  } else {
    const isRecentDelivery =
      lastDeliveredAgeMs !== null && lastDeliveredAgeMs <= deliveryThresholdMs;
    const paths = resolveMailboxPaths(actor, runRoot);
    const pendingCount =
      opts.unreadCount !== undefined
        ? opts.unreadCount
        : countPendingMessages(paths.inboxPath, paths.cursorPath);
    const hasPending =
      opts.hasPendingMessages !== undefined ? opts.hasPendingMessages : pendingCount > 0;
    if (hasPending) {
      if (isRecentDelivery) {
        status = "running_and_delivering";
        reason = "Listener is running and delivering messages";
      } else {
        status = "wedged";
        reason = `Listener is wedged: ${pendingCount} pending messages exist without delivery within ${deliveryThresholdMs}ms`;
      }
    } else if (isRecentDelivery) {
      status = "running_and_delivering";
      reason = "Listener is running and delivering messages";
    } else {
      status = "no_messages";
      reason = "Listener is running; no pending messages";
    }
  }
  return buildResult(
    status,
    reason,
    heartbeat,
    pid,
    processAlive,
    heartbeatAgeMs,
    lastDeliveredAgeMs,
  );
}
export const getListenerLiveness = inspectListenerLiveness;

export const isListenerAlive = (a: T, o?: O): boolean => inspectListenerLiveness(a, o).isRunning;
export const isListenerWedged = (a: T, o?: O): boolean => inspectListenerLiveness(a, o).isWedged;
export const isListenerStopped = (a: T, o?: O): boolean => inspectListenerLiveness(a, o).isStopped;
export const isListenerDelivering = (a: T, o?: O): boolean =>
  inspectListenerLiveness(a, o).isDelivering;
export const isListenerNoMessages = (a: T, o?: O): boolean =>
  inspectListenerLiveness(a, o).hasNoMessages;
export const hasListenerNoMessages = isListenerNoMessages;
export const isListenerRunning = isListenerAlive;
export const isListenerProcessAlive = (a: T, o?: O): boolean =>
  inspectListenerLiveness(a, o).isProcessAlive;
export const getListenerPid = (a: T, o?: O): number | null => inspectListenerLiveness(a, o).pid;
export const getListenerStatus = (a: T, o?: O): ListenerLivenessStatus =>
  inspectListenerLiveness(a, o).status;
