import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { JsonValue } from "../contracts/json.ts";
import { atomicWriteJson } from "../core/durable-write.ts";
import { HarnessError } from "../errors/harness-error.ts";
import {
  cleanupPreviousPhaseWatchdogs,
  cleanupStaleWatchdogs,
  createDefaultWatchdogStore,
  DEFAULT_HEARTBEAT_CADENCE_MS,
  DEFAULT_WATCHDOG_TIMEOUT_MS,
  heartbeatWatchdog,
  listWatchdogs,
  parseTimestamp,
  registerWatchdog,
  renderAsciiWatchdogTable,
  terminatePhaseWatchdogs,
  terminateWatchdog,
  verifyWatchdogLifecycle,
  type CleanupOptions,
  type CleanupPreviousPhaseOptions,
  type CleanupResult,
  type HeartbeatOptions,
  type LifecycleInvariantViolation,
  type RegisterWatchdogOptions,
  type TerminateOptions,
  type TerminatePhaseWatchdogsOptions,
  type TerminatePhaseWatchdogsResult,
  type VerifyWatchdogLifecycleOptions,
  type WatchdogFilterOptions,
  type WatchdogLifecycleVerificationResult,
  type WatchdogRecord,
  type WatchdogRegistrationResult,
  type WatchdogStatus,
  type WatchdogStore,
} from "../authority/watchdog-manager.ts";

export {
  cleanupPreviousPhaseWatchdogs,
  cleanupStaleWatchdogs,
  createDefaultWatchdogStore,
  DEFAULT_HEARTBEAT_CADENCE_MS,
  DEFAULT_WATCHDOG_TIMEOUT_MS,
  heartbeatWatchdog,
  listWatchdogs,
  parseTimestamp,
  registerWatchdog,
  renderAsciiWatchdogTable,
  terminatePhaseWatchdogs,
  terminateWatchdog,
  verifyWatchdogLifecycle,
  type CleanupOptions,
  type CleanupPreviousPhaseOptions,
  type CleanupResult,
  type HeartbeatOptions,
  type LifecycleInvariantViolation,
  type RegisterWatchdogOptions,
  type TerminateOptions,
  type TerminatePhaseWatchdogsOptions,
  type TerminatePhaseWatchdogsResult,
  type VerifyWatchdogLifecycleOptions,
  type WatchdogFilterOptions,
  type WatchdogLifecycleVerificationResult,
  type WatchdogRecord,
  type WatchdogRegistrationResult,
  type WatchdogStatus,
  type WatchdogStore,
};

export const CANONICAL_WATCHDOG_FILE = ".capsules/mind/queue/watchdogs.json";
export const TODO_WATCHDOG_FILE = ".capsules/todo/watchdogs.json";
export const LEGACY_WATCHDOG_FILE = ".capsules/watchdogs.json";
export const DEFAULT_WATCHDOG_FILE = ".capsules/watchdogs.json";

export function resolveCanonicalWatchdogStorePath(customRoot?: string, useTodo = false): string {
  const root = customRoot && customRoot.trim() ? resolve(customRoot.trim()) : process.cwd();
  const relPath = useTodo ? TODO_WATCHDOG_FILE : CANONICAL_WATCHDOG_FILE;
  return join(root, relPath);
}

export function resolveWatchdogStorePath(target?: string): string {
  if (target && target.trim()) {
    const resolved = resolve(target.trim());
    if (resolved.endsWith(".json")) {
      return resolved;
    }

    const checkPaths = [
      join(resolved, ".capsules", "mind", "queue", "watchdogs.json"),
      join(resolved, ".capsules", "todo", "watchdogs.json"),
      join(resolved, "mind", "queue", "watchdogs.json"),
      join(resolved, "todo", "watchdogs.json"),
      join(resolved, ".capsules", "watchdogs.json"),
      join(resolved, "watchdogs.json"),
    ];

    for (const p of checkPaths) {
      if (existsSync(p)) return p;
    }

    return join(resolved, "watchdogs.json");
  }

  const cwd = process.cwd();
  const candidates = [cwd, dirname(cwd)];

  for (const root of candidates) {
    const canonical = join(root, CANONICAL_WATCHDOG_FILE);
    if (existsSync(canonical)) return canonical;

    const todo = join(root, TODO_WATCHDOG_FILE);
    if (existsSync(todo)) return todo;

    const legacy = join(root, LEGACY_WATCHDOG_FILE);
    if (existsSync(legacy)) return legacy;

    const cwdWatchdogs = join(root, "watchdogs.json");
    if (existsSync(cwdWatchdogs)) return cwdWatchdogs;
  }

  const cwdCapsules = join(cwd, ".capsules");
  if (existsSync(cwdCapsules)) {
    return join(cwdCapsules, "watchdogs.json");
  }
  return join(cwd, "watchdogs.json");
}

export function loadMindWatchdogStore(target?: string): WatchdogStore {
  const storePath = resolveWatchdogStorePath(target);
  if (!existsSync(storePath)) {
    return createDefaultWatchdogStore();
  }

  try {
    const raw = readFileSync(storePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      throw new HarnessError("INVALID_STATE", `corrupted watchdog store at ${storePath}`);
    }
    const record = parsed as Record<string, unknown>;
    const watchdogsRaw = Array.isArray(record["watchdogs"]) ? record["watchdogs"] : [];
    const watchdogs: WatchdogRecord[] = [];

    for (const item of watchdogsRaw) {
      if (typeof item === "object" && item !== null) {
        const entry = item as Record<string, unknown>;
        if (typeof entry["id"] === "string") {
          const statusRaw = entry["status"];
          const status: WatchdogStatus =
            statusRaw === "active" ||
            statusRaw === "stale" ||
            statusRaw === "terminated" ||
            statusRaw === "orphaned"
              ? statusRaw
              : "orphaned";

          const wdRecord: WatchdogRecord = {
            id: String(entry["id"]),
            generation: typeof entry["generation"] === "number" ? entry["generation"] : 1,
            pulse_id: typeof entry["pulse_id"] === "string" ? entry["pulse_id"] : null,
            phase: typeof entry["phase"] === "string" ? entry["phase"] : "unknown",
            run_id: typeof entry["run_id"] === "string" ? entry["run_id"] : null,
            run_root: typeof entry["run_root"] === "string" ? entry["run_root"] : null,
            pid: typeof entry["pid"] === "number" ? entry["pid"] : 0,
            ppid: typeof entry["ppid"] === "number" ? entry["ppid"] : 0,
            agent_id: typeof entry["agent_id"] === "string" ? entry["agent_id"] : null,
            started_at:
              typeof entry["started_at"] === "string"
                ? entry["started_at"]
                : new Date().toISOString(),
            last_heartbeat_at:
              typeof entry["last_heartbeat_at"] === "string"
                ? entry["last_heartbeat_at"]
                : new Date().toISOString(),
            heartbeat_cadence_ms:
              typeof entry["heartbeat_cadence_ms"] === "number"
                ? entry["heartbeat_cadence_ms"]
                : DEFAULT_HEARTBEAT_CADENCE_MS,
            timeout_ms:
              typeof entry["timeout_ms"] === "number"
                ? entry["timeout_ms"]
                : DEFAULT_WATCHDOG_TIMEOUT_MS,
            status,
            terminated_at:
              typeof entry["terminated_at"] === "string" ? entry["terminated_at"] : null,
            termination_reason:
              typeof entry["termination_reason"] === "string" ? entry["termination_reason"] : null,
            ...(typeof entry["metadata"] === "object" && entry["metadata"] !== null
              ? { metadata: entry["metadata"] as Record<string, unknown> }
              : {}),
          };

          watchdogs.push(wdRecord);
        }
      }
    }

    return {
      schema: "harness.watchdog_store",
      version: 1,
      updated_at:
        typeof record["updated_at"] === "string" ? record["updated_at"] : new Date().toISOString(),
      watchdogs,
    };
  } catch (err: unknown) {
    if (err instanceof HarnessError) throw err;
    throw new HarnessError(
      "INVALID_STATE",
      `failed to load watchdog store at ${storePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function saveMindWatchdogStore(store: WatchdogStore, target?: string): void {
  const storePath = resolveWatchdogStorePath(target);
  const dir = dirname(storePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const serialized = JSON.parse(JSON.stringify(store)) as unknown as JsonValue;
  atomicWriteJson(storePath, serialized);
}

export function migrateWatchdogStore(options?: {
  readonly sourcePath?: string | undefined;
  readonly targetPath?: string | undefined;
}): { readonly migrated: boolean; readonly count: number } {
  const sourcePath =
    options?.sourcePath !== undefined ? options.sourcePath : resolveWatchdogStorePath();
  const targetPath =
    options?.targetPath !== undefined ? options.targetPath : resolveCanonicalWatchdogStorePath();

  if (!existsSync(sourcePath) || sourcePath === targetPath) {
    return { migrated: false, count: 0 };
  }

  const store = loadMindWatchdogStore(sourcePath);
  if (store.watchdogs.length === 0) {
    return { migrated: false, count: 0 };
  }

  saveMindWatchdogStore(store, targetPath);
  return { migrated: true, count: store.watchdogs.length };
}
