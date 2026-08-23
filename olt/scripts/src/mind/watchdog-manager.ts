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

export const LEGACY_WATCHDOG_FILE = ".capsules/watchdogs.json";
export const DEFAULT_WATCHDOG_FILE = ".capsules/watchdogs.json";

export function resolveCanonicalWatchdogStorePath(customRoot?: string, useTodo = false): string {
  return require("path").join(customRoot || process.cwd(), ".olt", "watchdogs.json");
}

export function resolveWatchdogStorePath(customPath?: string): string {
  if (customPath && customPath.trim()) return require("path").resolve(customPath.trim());
  return require("path").join(process.cwd(), ".olt", "watchdogs.json");
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

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    return false;
  }
}

export function auditProcessLiveness(
  pid: number,
  registeredAtMs: number,
  timeoutMs: number = 60_000,
): { isAlive: boolean; isFrozen: boolean } {
  const isAlive = isProcessRunning(pid);
  const elapsed = Date.now() - registeredAtMs;
  const isFrozen = isAlive && elapsed > timeoutMs;

  return { isAlive, isFrozen };
}
