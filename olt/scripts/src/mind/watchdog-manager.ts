import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { JsonValue } from "../core/contracts/json.ts";
import { atomicWriteJson } from "../core/durable-write.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import { isTestEnvironment, resolveScratchDir } from "../core/shared/paths.ts";
import {
  createDefaultWatchdogStore,
  DEFAULT_HEARTBEAT_CADENCE_MS,
  DEFAULT_WATCHDOG_TIMEOUT_MS,
  heartbeatWatchdog,
  parseTimestamp,
  registerWatchdog,
  terminateWatchdog,
  loadWatchdogStore,
  saveWatchdogStore,
  type HeartbeatOptions,
  type RegisterWatchdogOptions,
  type TerminateOptions,
  type WatchdogRecord,
  type WatchdogStatus,
  type WatchdogStore,
} from "../authority/watchdog-manager.ts";

export {
  createDefaultWatchdogStore,
  DEFAULT_HEARTBEAT_CADENCE_MS,
  DEFAULT_WATCHDOG_TIMEOUT_MS,
  heartbeatWatchdog,
  parseTimestamp,
  registerWatchdog,
  terminateWatchdog,
  type HeartbeatOptions,
  type RegisterWatchdogOptions,
  type TerminateOptions,
  type WatchdogRecord,
  type WatchdogStatus,
  type WatchdogStore,
};

export const CANONICAL_WATCHDOG_FILE = "olt/watchdogs.json";
export const DEFAULT_WATCHDOG_FILE = "olt/watchdogs.json";

export function resolveCanonicalWatchdogStorePath(customRoot?: string, _useTodo = false): string {
  const root = customRoot || (isTestEnvironment() ? resolveScratchDir() : process.cwd());
  return join(root, ".olt", "watchdogs.json");
}

export function resolveWatchdogStorePath(customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  return resolveCanonicalWatchdogStorePath();
}

export function loadMindWatchdogStore(target?: string): WatchdogStore {
  return loadWatchdogStore(target);
}

export function saveMindWatchdogStore(store: WatchdogStore, target?: string): void {
  saveWatchdogStore(store, target);
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
