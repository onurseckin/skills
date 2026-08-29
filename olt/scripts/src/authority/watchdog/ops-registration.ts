import { HarnessError } from "../../core/errors/index.ts";
import { DEFAULT_HEARTBEAT_CADENCE_MS, DEFAULT_WATCHDOG_TIMEOUT_MS } from "./constants.ts";
import { withWatchdogStoreLock } from "./lock.ts";
import {
  generateWatchdogId,
  loadWatchdogStoreUnlocked,
  resolveApiNow,
  resolveWatchdogStorePath,
  saveWatchdogStoreUnlocked,
  timestampMilliseconds,
} from "./store.ts";
import type {
  HeartbeatOptions,
  RegisterWatchdogOptions,
  RegisterWatchdogResult,
  TerminateOptions,
  WatchdogRecord,
  WatchdogStore,
} from "./types.ts";

export function registerWatchdogUnlocked(
  params: RegisterWatchdogOptions = {},
  target?: string,
): RegisterWatchdogResult {
  const nowMs = resolveApiNow(params.now);
  const nowIso = new Date(nowMs).toISOString();

  const currentStore = loadWatchdogStoreUnlocked(target);
  const targetGen = params.generation ?? 1;
  const watchdogId = params.id ?? generateWatchdogId(targetGen);

  const supersededWatchdogs: WatchdogRecord[] = [];
  const updatedWatchdogs: WatchdogRecord[] = [];

  for (const existing of currentStore.watchdogs) {
    if (existing.status === "active") {
      const lastHbMs = timestampMilliseconds(existing.last_heartbeat_at, "last_heartbeat_at");
      const isOverdue = nowMs - lastHbMs > existing.timeout_ms;

      if (isOverdue) {
        updatedWatchdogs.push({
          ...existing,
          status: "stale",
          termination_reason: "heartbeat_timeout",
        });
      } else if (
        existing.generation === targetGen ||
        (params.pulse_id && existing.pulse_id === params.pulse_id)
      ) {
        const superseded: WatchdogRecord = {
          ...existing,
          status: "terminated",
          terminated_at: nowIso,
          termination_reason: "superseded_by_new_watchdog",
        };
        supersededWatchdogs.push(superseded);
        updatedWatchdogs.push(superseded);
      } else {
        updatedWatchdogs.push(existing);
      }
    } else {
      updatedWatchdogs.push(existing);
    }
  }

  const newWatchdog: WatchdogRecord = {
    id: watchdogId,
    generation: targetGen,
    pulse_id: params.pulse_id ?? null,
    phase: params.phase !== undefined ? params.phase : "autonomous-loop",
    run_id: params.run_id ?? null,
    run_root: params.run_root ?? null,
    pid: params.pid ?? (typeof process !== "undefined" ? process.pid : 0),
    ppid: params.ppid ?? (typeof process !== "undefined" ? process.ppid : 0),
    agent_id: params.agent_id ?? null,
    started_at: nowIso,
    last_heartbeat_at: nowIso,
    heartbeat_cadence_ms: params.heartbeat_cadence_ms ?? DEFAULT_HEARTBEAT_CADENCE_MS,
    timeout_ms:
      params.timeout_ms ??
      (params.heartbeat_cadence_ms !== undefined
        ? params.heartbeat_cadence_ms * 2
        : DEFAULT_WATCHDOG_TIMEOUT_MS),
    status: "active",
    terminated_at: null,
    termination_reason: null,
    ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
  };

  updatedWatchdogs.push(newWatchdog);

  const updatedStore: WatchdogStore = {
    schema: "harness.watchdog_store",
    version: 1,
    updated_at: nowIso,
    watchdogs: updatedWatchdogs,
  };

  saveWatchdogStoreUnlocked(updatedStore, target);

  return {
    watchdog: newWatchdog,
    supersededWatchdogs,
    store: updatedStore,
  };
}

export function registerWatchdog(
  params: RegisterWatchdogOptions = {},
  target?: string,
): RegisterWatchdogResult {
  return withWatchdogStoreLock(resolveWatchdogStorePath(target), () =>
    registerWatchdogUnlocked(params, target),
  );
}

export function heartbeatWatchdogUnlocked(
  id: string,
  options: HeartbeatOptions = {},
  target?: string,
): WatchdogRecord {
  const nowMs = resolveApiNow(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const currentStore = loadWatchdogStoreUnlocked(target);

  const existingIndex = currentStore.watchdogs.findIndex((w) => w.id === id);
  if (existingIndex === -1) {
    throw new HarnessError("INVALID_ARGUMENT", `watchdog not found: ${id}`);
  }

  const existing = currentStore.watchdogs[existingIndex]!;
  if (existing.status === "terminated") {
    throw new HarnessError("INVALID_STATE", `watchdog is terminated: ${id}`);
  }

  const updatedWd: WatchdogRecord = {
    ...existing,
    last_heartbeat_at: nowIso,
    status: "active",
    phase: options.phase ?? existing.phase,
    ...(options.metadata !== undefined || existing.metadata !== undefined
      ? {
          metadata: {
            ...(existing.metadata ?? {}),
            ...(options.metadata ?? {}),
          },
        }
      : {}),
  };

  const updatedWatchdogs = [...currentStore.watchdogs];
  updatedWatchdogs[existingIndex] = updatedWd;

  const updatedStore: WatchdogStore = {
    schema: "harness.watchdog_store",
    version: 1,
    updated_at: nowIso,
    watchdogs: updatedWatchdogs,
  };

  saveWatchdogStoreUnlocked(updatedStore, target);
  return updatedWd;
}

export function heartbeatWatchdog(
  id: string,
  options: HeartbeatOptions = {},
  target?: string,
): WatchdogRecord {
  return withWatchdogStoreLock(resolveWatchdogStorePath(target), () =>
    heartbeatWatchdogUnlocked(id, options, target),
  );
}

export function terminateWatchdogUnlocked(
  id: string,
  options: TerminateOptions = {},
  target?: string,
): WatchdogRecord {
  const nowMs = resolveApiNow(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const currentStore = loadWatchdogStoreUnlocked(target);

  const existingIndex = currentStore.watchdogs.findIndex((w) => w.id === id);
  if (existingIndex === -1) {
    throw new HarnessError("INVALID_ARGUMENT", `watchdog not found: ${id}`);
  }

  const existing = currentStore.watchdogs[existingIndex]!;
  if (existing.status === "terminated") {
    return existing;
  }

  const updatedWd: WatchdogRecord = {
    ...existing,
    status: "terminated",
    terminated_at: nowIso,
    termination_reason: options.reason ?? "manual_termination",
    ...(options.metadata !== undefined || existing.metadata !== undefined
      ? {
          metadata: {
            ...(existing.metadata ?? {}),
            ...(options.metadata ?? {}),
          },
        }
      : {}),
  };

  const updatedWatchdogs = [...currentStore.watchdogs];
  updatedWatchdogs[existingIndex] = updatedWd;

  const updatedStore: WatchdogStore = {
    schema: "harness.watchdog_store",
    version: 1,
    updated_at: nowIso,
    watchdogs: updatedWatchdogs,
  };

  saveWatchdogStoreUnlocked(updatedStore, target);
  return updatedWd;
}

export function terminateWatchdog(
  id: string,
  options: TerminateOptions = {},
  target?: string,
): WatchdogRecord {
  return withWatchdogStoreLock(resolveWatchdogStorePath(target), () =>
    terminateWatchdogUnlocked(id, options, target),
  );
}
