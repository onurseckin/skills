import { withWatchdogStoreLock } from "./lock.ts";
import {
  loadWatchdogStore,
  loadWatchdogStoreUnlocked,
  resolveApiNow,
  resolveWatchdogStorePath,
  saveWatchdogStoreUnlocked,
  timestampMilliseconds,
} from "./store.ts";
import type {
  CleanupPreviousPhaseOptions,
  CleanupStaleOptions,
  CleanupStaleResult,
  ListWatchdogOptions,
  TerminatePhaseOptions,
  TerminatePhaseResult,
  WatchdogRecord,
  WatchdogStore,
} from "./types.ts";

export function listWatchdogs(
  filter: ListWatchdogOptions = {},
  target?: string,
): readonly WatchdogRecord[] {
  const store = loadWatchdogStore(target);
  return store.watchdogs.filter((w) => {
    if (filter.generation !== undefined && w.generation !== filter.generation) return false;
    if (filter.pulse_id !== undefined && w.pulse_id !== filter.pulse_id) return false;
    if (filter.phase !== undefined && w.phase !== filter.phase) return false;
    if (filter.run_id !== undefined && w.run_id !== filter.run_id) return false;
    if (filter.agent_id !== undefined && w.agent_id !== filter.agent_id) return false;
    if (filter.status !== undefined) {
      if (Array.isArray(filter.status)) {
        if (!filter.status.includes(w.status)) return false;
      } else if (w.status !== filter.status) {
        return false;
      }
    }
    return true;
  });
}

export function cleanupStaleWatchdogsUnlocked(
  options: CleanupStaleOptions = {},
  target?: string,
): CleanupStaleResult {
  const nowMs = resolveApiNow(options.now);
  const store = loadWatchdogStoreUnlocked(target);

  const cleanedWatchdogs: WatchdogRecord[] = [];
  const updatedWatchdogs: WatchdogRecord[] = [];

  for (const w of store.watchdogs) {
    if (w.status === "active") {
      const lastHbMs = timestampMilliseconds(w.last_heartbeat_at, "last_heartbeat_at");
      const timeout = options.maxAgeMs ?? w.timeout_ms;
      if (nowMs - lastHbMs > timeout) {
        const cleaned: WatchdogRecord = {
          ...w,
          status: options.markAs ?? "stale",
          termination_reason: options.reason ?? "stale_cadence_exceeded",
        };
        cleanedWatchdogs.push(cleaned);
        updatedWatchdogs.push(cleaned);
      } else {
        updatedWatchdogs.push(w);
      }
    } else {
      updatedWatchdogs.push(w);
    }
  }

  const dryRun = options.dryRun ?? false;
  const updatedStore: WatchdogStore = {
    schema: "harness.watchdog_store",
    version: 1,
    updated_at: new Date(nowMs).toISOString(),
    watchdogs: updatedWatchdogs,
  };

  if (!dryRun) {
    saveWatchdogStoreUnlocked(updatedStore, target);
  }

  const activeCount = updatedWatchdogs.filter((w) => w.status === "active").length;

  return {
    cleanedCount: cleanedWatchdogs.length,
    activeCount,
    cleanedWatchdogs,
    dryRun,
    store: dryRun ? store : updatedStore,
  };
}

export function cleanupStaleWatchdogs(
  options: CleanupStaleOptions = {},
  target?: string,
): CleanupStaleResult {
  return withWatchdogStoreLock(resolveWatchdogStorePath(target), () =>
    cleanupStaleWatchdogsUnlocked(options, target),
  );
}

export function terminatePhaseWatchdogsUnlocked(
  options: TerminatePhaseOptions,
  target?: string,
): TerminatePhaseResult {
  const nowMs = resolveApiNow(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const store = loadWatchdogStoreUnlocked(target);

  const terminatedWatchdogs: WatchdogRecord[] = [];
  const updatedWatchdogs: WatchdogRecord[] = [];

  for (const w of store.watchdogs) {
    const matchesPhase = w.phase === options.phase;
    const matchesGen = options.generation === undefined || w.generation === options.generation;
    const matchesPulse = options.pulse_id === undefined || w.pulse_id === options.pulse_id;
    const notExcluded = options.excludeId === undefined || w.id !== options.excludeId;

    if (w.status === "active" && matchesPhase && matchesGen && matchesPulse && notExcluded) {
      const term: WatchdogRecord = {
        ...w,
        status: "terminated",
        terminated_at: nowIso,
        termination_reason: options.reason ?? `phase_completed_${options.phase}`,
      };
      terminatedWatchdogs.push(term);
      updatedWatchdogs.push(term);
    } else {
      updatedWatchdogs.push(w);
    }
  }

  const dryRun = options.dryRun ?? false;
  const updatedStore: WatchdogStore = {
    schema: "harness.watchdog_store",
    version: 1,
    updated_at: nowIso,
    watchdogs: updatedWatchdogs,
  };

  if (!dryRun) {
    saveWatchdogStoreUnlocked(updatedStore, target);
  }

  const activeCount = updatedWatchdogs.filter((w) => w.status === "active").length;

  return {
    terminatedCount: terminatedWatchdogs.length,
    activeCount,
    terminatedWatchdogs,
    dryRun,
    store: dryRun ? store : updatedStore,
  };
}

export function terminatePhaseWatchdogs(
  options: TerminatePhaseOptions,
  target?: string,
): TerminatePhaseResult {
  return withWatchdogStoreLock(resolveWatchdogStorePath(target), () =>
    terminatePhaseWatchdogsUnlocked(options, target),
  );
}

export function cleanupPreviousPhaseWatchdogsUnlocked(
  options: CleanupPreviousPhaseOptions,
  target?: string,
): TerminatePhaseResult {
  const nowMs = resolveApiNow(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const store = loadWatchdogStoreUnlocked(target);

  const terminatedWatchdogs: WatchdogRecord[] = [];
  const updatedWatchdogs: WatchdogRecord[] = [];

  for (const w of store.watchdogs) {
    const isPreviousPhase = w.phase !== options.currentPhase;
    const matchesGen = options.generation === undefined || w.generation === options.generation;
    const matchesPulse = options.pulse_id === undefined || w.pulse_id === options.pulse_id;
    const notExcluded = options.excludeId === undefined || w.id !== options.excludeId;

    if (w.status === "active" && isPreviousPhase && matchesGen && matchesPulse && notExcluded) {
      const term: WatchdogRecord = {
        ...w,
        status: "terminated",
        terminated_at: nowIso,
        termination_reason: `phase_rollover_from_${w.phase}_to_${options.currentPhase}`,
      };
      terminatedWatchdogs.push(term);
      updatedWatchdogs.push(term);
    } else {
      updatedWatchdogs.push(w);
    }
  }

  const dryRun = options.dryRun ?? false;
  const updatedStore: WatchdogStore = {
    schema: "harness.watchdog_store",
    version: 1,
    updated_at: nowIso,
    watchdogs: updatedWatchdogs,
  };

  if (!dryRun) {
    saveWatchdogStoreUnlocked(updatedStore, target);
  }

  const activeCount = updatedWatchdogs.filter((w) => w.status === "active").length;

  return {
    terminatedCount: terminatedWatchdogs.length,
    activeCount,
    terminatedWatchdogs,
    dryRun,
    store: dryRun ? store : updatedStore,
  };
}

export function cleanupPreviousPhaseWatchdogs(
  options: CleanupPreviousPhaseOptions,
  target?: string,
): TerminatePhaseResult {
  return withWatchdogStoreLock(resolveWatchdogStorePath(target), () =>
    cleanupPreviousPhaseWatchdogsUnlocked(options, target),
  );
}
