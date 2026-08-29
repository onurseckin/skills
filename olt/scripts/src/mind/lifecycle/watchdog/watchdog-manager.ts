import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveOltDir } from "../../../core/shared/paths.ts";

export const CANONICAL_WATCHDOG_FILE = "olt/watchdogs.json";
export const DEFAULT_WATCHDOG_FILE = "olt/watchdogs.json";

export type WatchdogStatus = "active" | "terminated" | "expired" | "failed";

export interface WatchdogRecord {
  readonly id: string;
  readonly generation: number;
  readonly pulse_id: string;
  readonly phase: string;
  readonly run_id: string;
  readonly run_root: string | null;
  readonly pid: number;
  readonly ppid: number;
  readonly agent_id: string;
  readonly started_at: string;
  readonly last_heartbeat_at: string;
  readonly heartbeat_cadence_ms: number;
  readonly timeout_ms: number;
  readonly status: WatchdogStatus;
  readonly terminated_at: string | null;
  readonly termination_reason: string | null;
}

export interface WatchdogStore {
  readonly schema: string;
  readonly version: string;
  readonly last_updated: string;
  readonly watchdogs: readonly WatchdogRecord[];
}

export function createDefaultWatchdogStore(): WatchdogStore {
  return {
    schema: "harness.watchdog_store",
    version: "1.0.0",
    last_updated: new Date().toISOString(),
    watchdogs: [],
  };
}

export function resolveCanonicalWatchdogStorePath(repoRoot: string): string {
  return join(resolveOltDir(repoRoot), "watchdogs.json");
}

export function resolveWatchdogStorePath(customPath?: string): string {
  if (customPath && customPath.trim().length > 0) {
    return resolve(customPath.trim());
  }
  return resolve(DEFAULT_WATCHDOG_FILE);
}

export function loadMindWatchdogStore(filePath?: string): WatchdogStore {
  const resolved = resolveWatchdogStorePath(filePath);
  if (!existsSync(resolved)) {
    return createDefaultWatchdogStore();
  }
  try {
    const raw = readFileSync(resolved, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "watchdogs" in parsed) {
      return parsed as WatchdogStore;
    }
    return createDefaultWatchdogStore();
  } catch {
    return createDefaultWatchdogStore();
  }
}

export function saveMindWatchdogStore(a: unknown, b?: unknown): void {
  const store = (typeof a === "object" && a !== null && "watchdogs" in a ? a : b) as WatchdogStore;
  const filePath = (typeof a === "string" ? a : typeof b === "string" ? b : undefined) as
    | string
    | undefined;
  const resolved = resolveWatchdogStorePath(filePath);
  const parent = dirname(resolved);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  writeFileSync(
    resolved,
    JSON.stringify(store ?? createDefaultWatchdogStore(), null, 2) + "\n",
    "utf-8",
  );
}

export function auditProcessLiveness(
  pid: number,
  lastHeartbeatMs?: number,
  timeoutMs: number = 60000,
): { isAlive: boolean; isFrozen: boolean } {
  let isAlive = false;
  try {
    process.kill(pid, 0);
    isAlive = true;
  } catch {
    isAlive = false;
  }

  let isFrozen = false;
  if (isAlive && lastHeartbeatMs !== undefined) {
    const elapsed = Date.now() - lastHeartbeatMs;
    if (elapsed > timeoutMs) {
      isFrozen = true;
    }
  }

  return { isAlive, isFrozen };
}

export interface HeartbeatOptions {
  readonly id: string;
}

export interface RegisterWatchdogOptions {
  readonly record: WatchdogRecord;
}

export interface TerminateOptions {
  readonly id: string;
  readonly reason: string;
}
