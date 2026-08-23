import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { JsonValue } from "../core/contracts/json.ts";
import { atomicWriteJson } from "../core/durable-write.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import { resolveWatchdogsPath } from "../core/shared/paths.ts";

export type WatchdogStatus = "active" | "stale" | "terminated" | "orphaned";

export const DEFAULT_HEARTBEAT_CADENCE_MS = 180_000; // 3 minutes standard cadence
export const DEFAULT_WATCHDOG_TIMEOUT_MS = 360_000; // 6 minutes timeout (2x cadence)

export interface WatchdogRecord {
  readonly id: string;
  readonly generation: number;
  readonly pulse_id: string | null;
  readonly phase: string;
  readonly run_id: string | null;
  readonly run_root: string | null;
  readonly pid: number;
  readonly ppid: number;
  readonly agent_id: string | null;
  readonly started_at: string;
  readonly last_heartbeat_at: string;
  readonly heartbeat_cadence_ms: number;
  readonly timeout_ms: number;
  readonly status: WatchdogStatus;
  readonly terminated_at: string | null;
  readonly termination_reason: string | null;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface WatchdogStore {
  readonly schema: "harness.watchdog_store";
  readonly version: 2;
  readonly updated_at: string;
  readonly active_watchdog: WatchdogRecord | null;
}

export interface RegisterWatchdogOptions {
  readonly id?: string | undefined;
  readonly generation?: number | undefined;
  readonly pulse_id?: string | null | undefined;
  readonly phase?: string | undefined;
  readonly run_id?: string | null | undefined;
  readonly run_root?: string | null | undefined;
  readonly pid?: number | undefined;
  readonly ppid?: number | undefined;
  readonly agent_id?: string | null | undefined;
  readonly heartbeat_cadence_ms?: number | undefined;
  readonly timeout_ms?: number | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly now?: string | number | Date | undefined;
}

export interface HeartbeatOptions {
  readonly now?: string | number | Date | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly phase?: string | undefined;
}

export interface TerminateOptions {
  readonly now?: string | number | Date | undefined;
  readonly reason?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export function parseTimestamp(input?: string | number | Date | undefined): number {
  if (typeof input === "number") return input;
  if (input instanceof Date) return input.getTime();
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

export function resolveWatchdogStorePath(target?: string): string {
  if (!target) {
    return resolveWatchdogsPath();
  }
  const resolved = resolve(target);
  if (resolved.endsWith(".json")) {
    return resolved;
  }
  return join(resolved, "watchdogs.json");
}

export function createDefaultWatchdogStore(nowIso?: string): WatchdogStore {
  return {
    schema: "harness.watchdog_store",
    version: 2,
    updated_at: nowIso ?? new Date().toISOString(),
    active_watchdog: null,
  };
}

export function loadWatchdogStore(target?: string): WatchdogStore {
  const storePath = resolveWatchdogStorePath(target);
  if (!existsSync(storePath)) {
    return createDefaultWatchdogStore();
  }

  try {
    const raw = readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // If it's a legacy version 1 store, discard it and return a fresh version 2 store
    if (parsed.version === 1) {
      return createDefaultWatchdogStore();
    }

    let active_watchdog: WatchdogRecord | null = null;
    if (parsed.active_watchdog && typeof parsed.active_watchdog === "object") {
      active_watchdog = parsed.active_watchdog as unknown as WatchdogRecord;
    }

    return {
      schema: "harness.watchdog_store",
      version: 2,
      updated_at:
        typeof parsed.updated_at === "string" ? parsed.updated_at : new Date().toISOString(),
      active_watchdog,
    };
  } catch (err: unknown) {
    return createDefaultWatchdogStore();
  }
}

export function saveWatchdogStore(store: WatchdogStore, target?: string): void {
  const storePath = resolveWatchdogStorePath(target);
  const dir = dirname(storePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const serialized = JSON.parse(JSON.stringify(store)) as unknown as JsonValue;
  atomicWriteJson(storePath, serialized);
}

function generateWatchdogId(generation: number): string {
  const nowStr = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `wd-gen${generation}-${nowStr}-${rand}`;
}

export function registerWatchdog(
  params: RegisterWatchdogOptions = {},
  target?: string,
): WatchdogRecord {
  const nowMs = parseTimestamp(params.now);
  const nowIso = new Date(nowMs).toISOString();

  const watchdogId = params.id ?? generateWatchdogId(params.generation ?? 1);

  const newWatchdog: WatchdogRecord = {
    id: watchdogId,
    generation: params.generation ?? 1,
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

  const updatedStore: WatchdogStore = {
    schema: "harness.watchdog_store",
    version: 2,
    updated_at: nowIso,
    active_watchdog: newWatchdog,
  };

  saveWatchdogStore(updatedStore, target);
  return newWatchdog;
}

export function heartbeatWatchdog(
  id: string,
  options: HeartbeatOptions = {},
  target?: string,
): WatchdogRecord {
  const nowMs = parseTimestamp(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const currentStore = loadWatchdogStore(target);

  const existing = currentStore.active_watchdog;
  if (!existing || existing.id !== id) {
    throw new HarnessError("INVALID_ARGUMENT", `watchdog not found or not active: ${id}`);
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

  const updatedStore: WatchdogStore = {
    schema: "harness.watchdog_store",
    version: 2,
    updated_at: nowIso,
    active_watchdog: updatedWd,
  };

  saveWatchdogStore(updatedStore, target);
  return updatedWd;
}

export function terminateWatchdog(
  id: string,
  options: TerminateOptions = {},
  target?: string,
): void {
  const nowMs = parseTimestamp(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const currentStore = loadWatchdogStore(target);

  if (currentStore.active_watchdog?.id === id) {
    const updatedStore: WatchdogStore = {
      schema: "harness.watchdog_store",
      version: 2,
      updated_at: nowIso,
      active_watchdog: null,
    };
    saveWatchdogStore(updatedStore, target);
  }
}
