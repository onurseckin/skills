import {
  loadWatchdogStore as loadAuthorityStore,
  loadWatchdogStoreUnlocked,
  resolveWatchdogStorePath,
  saveWatchdogStore as saveAuthorityStore,
  saveWatchdogStoreUnlocked,
  validateWatchdogStore,
  withWatchdogStoreLock,
  type WatchdogRecord,
  type WatchdogStore,
} from "../../authority/watchdog/index.ts";

function recordTimestamp(record: WatchdogRecord): number {
  const term = record.terminated_at ? Date.parse(record.terminated_at) : 0;
  const hb = Date.parse(record.last_heartbeat_at);
  const start = Date.parse(record.started_at);
  return Math.max(
    Number.isFinite(term) ? term : 0,
    Number.isFinite(hb) ? hb : 0,
    Number.isFinite(start) ? start : 0,
  );
}

function mergeRecords(
  diskRecords: readonly WatchdogRecord[],
  memoryRecords: readonly WatchdogRecord[],
): readonly WatchdogRecord[] {
  const map = new Map<string, WatchdogRecord>();
  for (const rec of diskRecords) {
    map.set(rec.id, rec);
  }
  for (const memRec of memoryRecords) {
    const existing = map.get(memRec.id);
    if (!existing) {
      map.set(memRec.id, memRec);
      continue;
    }
    const memTs = recordTimestamp(memRec);
    const existTs = recordTimestamp(existing);
    if (memTs > existTs) {
      map.set(memRec.id, memRec);
    } else if (memTs === existTs) {
      if (memRec.status !== "active" && existing.status === "active") {
        map.set(memRec.id, memRec);
      } else {
        map.set(memRec.id, memRec);
      }
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => Date.parse(a.started_at) - Date.parse(b.started_at),
  );
}

export function loadWatchdogStore(filePath?: string): WatchdogStore {
  return loadAuthorityStore(filePath);
}

export function saveWatchdogStore(store: WatchdogStore, filePath?: string): void {
  saveAuthorityStore(store, filePath);
}

export function syncWatchdogStore(store: WatchdogStore, filePath?: string): void {
  validateWatchdogStore(store);
  const storePath = resolveWatchdogStorePath(filePath);
  withWatchdogStoreLock(storePath, () => {
    const diskStore = loadWatchdogStoreUnlocked(storePath);
    const merged = mergeRecords(diskStore.watchdogs, store.watchdogs);
    const nowIso = new Date().toISOString();
    const target = store as {
      schema: "harness.watchdog_store";
      version: 1;
      updated_at: string;
      watchdogs: readonly WatchdogRecord[];
    };
    target.updated_at = nowIso;
    target.watchdogs = merged;
    saveWatchdogStoreUnlocked(store, storePath);
  });
}
