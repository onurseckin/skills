import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { JsonValue } from "../contracts/json.ts";
import { atomicWriteJson } from "../core/durable-write.ts";
import { HarnessError } from "../errors/harness-error.ts";

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
  readonly version: 1;
  readonly updated_at: string;
  readonly watchdogs: readonly WatchdogRecord[];
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
  readonly autoCleanupStale?: boolean | undefined;
  readonly enforceSingleActive?: boolean | undefined;
}

export interface WatchdogRegistrationResult {
  readonly watchdog: WatchdogRecord;
  readonly supersededWatchdogs: readonly WatchdogRecord[];
  readonly store: WatchdogStore;
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

export interface WatchdogFilterOptions {
  readonly generation?: number | undefined;
  readonly status?: WatchdogStatus | readonly WatchdogStatus[] | "all" | undefined;
  readonly pulse_id?: string | null | undefined;
  readonly run_id?: string | null | undefined;
  readonly phase?: string | undefined;
  readonly max_age_ms?: number | undefined;
  readonly now?: string | number | Date | undefined;
}

export interface CleanupOptions {
  readonly now?: string | number | Date | undefined;
  readonly maxAgeMs?: number | undefined;
  readonly generation?: number | undefined;
  readonly dryRun?: boolean | undefined;
  readonly markAs?: "stale" | "orphaned" | "terminated" | undefined;
  readonly reason?: string | undefined;
}

export interface CleanupResult {
  readonly cleanedCount: number;
  readonly cleanedWatchdogs: readonly WatchdogRecord[];
  readonly activeCount: number;
  readonly totalCount: number;
  readonly dryRun: boolean;
  readonly store: WatchdogStore;
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
    const cwdCapsules = join(process.cwd(), ".capsules");
    if (existsSync(cwdCapsules)) {
      return join(cwdCapsules, "watchdogs.json");
    }
    return join(process.cwd(), "watchdogs.json");
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
    version: 1,
    updated_at: nowIso ?? new Date().toISOString(),
    watchdogs: [],
  };
}

export function loadWatchdogStore(target?: string): WatchdogStore {
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
    const watchdogsRaw = Array.isArray(record.watchdogs) ? record.watchdogs : [];
    const watchdogs: WatchdogRecord[] = [];

    for (const item of watchdogsRaw) {
      if (typeof item === "object" && item !== null) {
        const entry = item as Record<string, unknown>;
        if (typeof entry.id === "string") {
          const statusRaw = entry.status;
          const status: WatchdogStatus =
            statusRaw === "active" ||
            statusRaw === "stale" ||
            statusRaw === "terminated" ||
            statusRaw === "orphaned"
              ? statusRaw
              : "orphaned";

          const wdRecord: WatchdogRecord = {
            id: entry.id,
            generation: typeof entry.generation === "number" ? entry.generation : 1,
            pulse_id: typeof entry.pulse_id === "string" ? entry.pulse_id : null,
            phase: typeof entry.phase === "string" ? entry.phase : "unknown",
            run_id: typeof entry.run_id === "string" ? entry.run_id : null,
            run_root: typeof entry.run_root === "string" ? entry.run_root : null,
            pid: typeof entry.pid === "number" ? entry.pid : 0,
            ppid: typeof entry.ppid === "number" ? entry.ppid : 0,
            agent_id: typeof entry.agent_id === "string" ? entry.agent_id : null,
            started_at:
              typeof entry.started_at === "string" ? entry.started_at : new Date().toISOString(),
            last_heartbeat_at:
              typeof entry.last_heartbeat_at === "string"
                ? entry.last_heartbeat_at
                : new Date().toISOString(),
            heartbeat_cadence_ms:
              typeof entry.heartbeat_cadence_ms === "number"
                ? entry.heartbeat_cadence_ms
                : DEFAULT_HEARTBEAT_CADENCE_MS,
            timeout_ms:
              typeof entry.timeout_ms === "number"
                ? entry.timeout_ms
                : DEFAULT_WATCHDOG_TIMEOUT_MS,
            status,
            terminated_at: typeof entry.terminated_at === "string" ? entry.terminated_at : null,
            termination_reason:
              typeof entry.termination_reason === "string" ? entry.termination_reason : null,
            ...(typeof entry.metadata === "object" && entry.metadata !== null
              ? { metadata: entry.metadata as Record<string, unknown> }
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
        typeof record.updated_at === "string" ? record.updated_at : new Date().toISOString(),
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

export function saveWatchdogStore(store: WatchdogStore, target?: string): void {
  const storePath = resolveWatchdogStorePath(target);
  const dir = dirname(storePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Strip any undefined properties to ensure canonical JSON bytes serialization
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
): WatchdogRegistrationResult {
  const nowMs = parseTimestamp(params.now);
  const nowIso = new Date(nowMs).toISOString();
  const currentStore = loadWatchdogStore(target);

  const generation = params.generation ?? 1;
  const heartbeatCadence = params.heartbeat_cadence_ms ?? DEFAULT_HEARTBEAT_CADENCE_MS;
  const timeoutMs =
    params.timeout_ms ??
    (params.heartbeat_cadence_ms !== undefined
      ? params.heartbeat_cadence_ms * 2
      : DEFAULT_WATCHDOG_TIMEOUT_MS);

  const autoCleanup = params.autoCleanupStale !== false;
  const singleActive = params.enforceSingleActive !== false;

  const supersededWatchdogs: WatchdogRecord[] = [];
  const updatedWatchdogs: WatchdogRecord[] = [];

  for (const wd of currentStore.watchdogs) {
    let updatedWd = wd;

    // 1. Auto-cleanup stale monitors if heartbeat is overdue
    if (wd.status === "active" && autoCleanup) {
      const lastHeartbeatMs = parseTimestamp(wd.last_heartbeat_at);
      if (nowMs - lastHeartbeatMs > wd.timeout_ms) {
        updatedWd = {
          ...wd,
          status: "stale",
          termination_reason: "heartbeat_timeout",
        };
      }
    }

    // 2. Enforce max 1 active watchdog per pulse / generation to prevent multi-watchdog accumulation
    if (updatedWd.status === "active" && singleActive) {
      const matchGen = updatedWd.generation === generation;
      const matchPulse =
        params.pulse_id !== null &&
        params.pulse_id !== undefined &&
        updatedWd.pulse_id === params.pulse_id;

      if (matchGen || matchPulse) {
        updatedWd = {
          ...updatedWd,
          status: "terminated",
          terminated_at: nowIso,
          termination_reason: "superseded_by_new_watchdog",
        };
        supersededWatchdogs.push(updatedWd);
      }
    }

    updatedWatchdogs.push(updatedWd);
  }

  const watchdogId = params.id ?? generateWatchdogId(generation);

  const newWatchdog: WatchdogRecord = {
    id: watchdogId,
    generation,
    pulse_id: params.pulse_id ?? null,
    phase: params.phase ?? "autonomous-loop",
    run_id: params.run_id ?? null,
    run_root: params.run_root ?? null,
    pid: params.pid ?? (typeof process !== "undefined" ? process.pid : 0),
    ppid: params.ppid ?? (typeof process !== "undefined" ? process.ppid : 0),
    agent_id: params.agent_id ?? null,
    started_at: nowIso,
    last_heartbeat_at: nowIso,
    heartbeat_cadence_ms: heartbeatCadence,
    timeout_ms: timeoutMs,
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

  saveWatchdogStore(updatedStore, target);

  return {
    watchdog: newWatchdog,
    supersededWatchdogs,
    store: updatedStore,
  };
}

export function heartbeatWatchdog(
  id: string,
  options: HeartbeatOptions = {},
  target?: string,
): WatchdogRecord {
  const nowMs = parseTimestamp(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const currentStore = loadWatchdogStore(target);

  const index = currentStore.watchdogs.findIndex((wd) => wd.id === id);
  if (index === -1) {
    throw new HarnessError("INVALID_ARGUMENT", `watchdog not found: ${id}`);
  }

  const existing = currentStore.watchdogs[index]!;
  if (existing.status === "terminated") {
    throw new HarnessError("INVALID_STATE", `cannot heartbeat terminated watchdog: ${id}`);
  }

  const updatedWd: WatchdogRecord = {
    ...existing,
    last_heartbeat_at: nowIso,
    status: "active",
    termination_reason: null,
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

  const updatedList = [...currentStore.watchdogs];
  updatedList[index] = updatedWd;

  const updatedStore: WatchdogStore = {
    ...currentStore,
    updated_at: nowIso,
    watchdogs: updatedList,
  };

  saveWatchdogStore(updatedStore, target);
  return updatedWd;
}

export function terminateWatchdog(
  id: string,
  options: TerminateOptions = {},
  target?: string,
): WatchdogRecord {
  const nowMs = parseTimestamp(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const currentStore = loadWatchdogStore(target);

  const index = currentStore.watchdogs.findIndex((wd) => wd.id === id);
  if (index === -1) {
    throw new HarnessError("INVALID_ARGUMENT", `watchdog not found: ${id}`);
  }

  const existing = currentStore.watchdogs[index]!;
  if (existing.status === "terminated") {
    return existing;
  }

  const updatedWd: WatchdogRecord = {
    ...existing,
    status: "terminated",
    terminated_at: nowIso,
    termination_reason: options.reason ?? "normal_termination",
    ...(options.metadata !== undefined || existing.metadata !== undefined
      ? {
          metadata: {
            ...(existing.metadata ?? {}),
            ...(options.metadata ?? {}),
          },
        }
      : {}),
  };

  const updatedList = [...currentStore.watchdogs];
  updatedList[index] = updatedWd;

  const updatedStore: WatchdogStore = {
    ...currentStore,
    updated_at: nowIso,
    watchdogs: updatedList,
  };

  saveWatchdogStore(updatedStore, target);
  return updatedWd;
}

export function listWatchdogs(
  filter: WatchdogFilterOptions = {},
  target?: string,
): readonly WatchdogRecord[] {
  const store = loadWatchdogStore(target);
  const nowMs = parseTimestamp(filter.now);

  return store.watchdogs.filter((wd) => {
    if (filter.generation !== undefined && wd.generation !== filter.generation) {
      return false;
    }
    if (filter.pulse_id !== undefined && wd.pulse_id !== filter.pulse_id) {
      return false;
    }
    if (filter.run_id !== undefined && wd.run_id !== filter.run_id) {
      return false;
    }
    if (filter.phase !== undefined && wd.phase !== filter.phase) {
      return false;
    }
    if (filter.status !== undefined && filter.status !== "all") {
      if (Array.isArray(filter.status)) {
        if (!filter.status.includes(wd.status)) return false;
      } else if (wd.status !== filter.status) {
        return false;
      }
    }
    if (filter.max_age_ms !== undefined) {
      const age = nowMs - parseTimestamp(wd.last_heartbeat_at);
      if (age > filter.max_age_ms) return false;
    }
    return true;
  });
}

export function cleanupStaleWatchdogs(options: CleanupOptions = {}, target?: string): CleanupResult {
  const nowMs = parseTimestamp(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const currentStore = loadWatchdogStore(target);

  const markAs: WatchdogStatus = options.markAs ?? "stale";
  const dryRun = options.dryRun === true;
  const reason = options.reason ?? "stale_cadence_exceeded";

  const cleanedWatchdogs: WatchdogRecord[] = [];
  const updatedWatchdogs: WatchdogRecord[] = [];

  for (const wd of currentStore.watchdogs) {
    if (wd.status === "active") {
      if (options.generation !== undefined && wd.generation !== options.generation) {
        updatedWatchdogs.push(wd);
        continue;
      }

      const threshold = options.maxAgeMs ?? wd.timeout_ms;
      const ageMs = nowMs - parseTimestamp(wd.last_heartbeat_at);

      if (ageMs > threshold) {
        const cleaned: WatchdogRecord = {
          ...wd,
          status: markAs,
          terminated_at: markAs === "terminated" ? nowIso : wd.terminated_at,
          termination_reason: reason,
        };
        cleanedWatchdogs.push(cleaned);
        updatedWatchdogs.push(cleaned);
        continue;
      }
    }

    updatedWatchdogs.push(wd);
  }

  const activeCount = updatedWatchdogs.filter((w) => w.status === "active").length;

  const updatedStore: WatchdogStore = {
    ...currentStore,
    updated_at: nowIso,
    watchdogs: updatedWatchdogs,
  };

  if (!dryRun && cleanedWatchdogs.length > 0) {
    saveWatchdogStore(updatedStore, target);
  }

  return {
    cleanedCount: cleanedWatchdogs.length,
    cleanedWatchdogs,
    activeCount,
    totalCount: updatedWatchdogs.length,
    dryRun,
    store: dryRun ? currentStore : updatedStore,
  };
}

function padRight(str: string, width: number): string {
  if (str.length >= width) return str;
  return `${str}${" ".repeat(width - str.length)}`;
}

function truncateString(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}…`;
}

function formatStatusBadge(status: WatchdogStatus): string {
  switch (status) {
    case "active":
      return "[ACTIVE 🟢]";
    case "stale":
      return "[STALE ⚠️]";
    case "terminated":
      return "[TERM ⏹️]";
    case "orphaned":
      return "[ORPHAN ❌]";
  }
}

function formatHeartbeatAge(lastHeartbeatIso: string, nowMs: number): string {
  const deltaMs = Math.max(0, nowMs - parseTimestamp(lastHeartbeatIso));
  const deltaSec = Math.floor(deltaMs / 1000);
  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 3600) {
    const mins = Math.floor(deltaSec / 60);
    const secs = deltaSec % 60;
    return `${mins}m ${secs}s ago`;
  }
  const hours = Math.floor(deltaSec / 3600);
  return `${hours}h ago`;
}

export function renderAsciiWatchdogTable(
  watchdogs: readonly WatchdogRecord[],
  options: { readonly now?: string | number | Date | undefined } = {},
): string {
  if (watchdogs.length === 0) {
    return [
      "┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐",
      "│ No registered watchdog monitors found matching criteria                                                               │",
      "└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘",
    ].join("\n");
  }

  const nowMs = parseTimestamp(options.now);

  const colIdWidth = 24;
  const colGenWidth = 14;
  const colPhaseWidth = 16;
  const colStatusWidth = 16;
  const colPidWidth = 8;
  const colHbWidth = 16;
  const colCadenceWidth = 10;

  const topBorder = `┌${"─".repeat(colIdWidth + 2)}┬${"─".repeat(colGenWidth + 2)}┬${"─".repeat(colPhaseWidth + 2)}┬${"─".repeat(colStatusWidth + 2)}┬${"─".repeat(colPidWidth + 2)}┬${"─".repeat(colHbWidth + 2)}┬${"─".repeat(colCadenceWidth + 2)}┐`;
  const header = `│ ${padRight("Watchdog ID", colIdWidth)} │ ${padRight("Gen / Pulse", colGenWidth)} │ ${padRight("Phase", colPhaseWidth)} │ ${padRight("Status", colStatusWidth)} │ ${padRight("PID", colPidWidth)} │ ${padRight("Last Heartbeat", colHbWidth)} │ ${padRight("Cadence", colCadenceWidth)} │`;
  const separator = `├${"─".repeat(colIdWidth + 2)}┼${"─".repeat(colGenWidth + 2)}┼${"─".repeat(colPhaseWidth + 2)}┼${"─".repeat(colStatusWidth + 2)}┼${"─".repeat(colPidWidth + 2)}┼${"─".repeat(colHbWidth + 2)}┼${"─".repeat(colCadenceWidth + 2)}┤`;
  const bottomBorder = `└${"─".repeat(colIdWidth + 2)}┴${"─".repeat(colGenWidth + 2)}┴${"─".repeat(colPhaseWidth + 2)}┴${"─".repeat(colStatusWidth + 2)}┴${"─".repeat(colPidWidth + 2)}┴${"─".repeat(colHbWidth + 2)}┴${"─".repeat(colCadenceWidth + 2)}┘`;

  const rows = watchdogs.map((wd) => {
    const idCell = padRight(truncateString(wd.id, colIdWidth), colIdWidth);
    const genText =
      wd.pulse_id !== null ? `Gen ${wd.generation} • ${wd.pulse_id}` : `Gen ${wd.generation}`;
    const genCell = padRight(truncateString(genText, colGenWidth), colGenWidth);
    const phaseCell = padRight(truncateString(wd.phase, colPhaseWidth), colPhaseWidth);
    const statusCell = padRight(
      truncateString(formatStatusBadge(wd.status), colStatusWidth),
      colStatusWidth,
    );
    const pidCell = padRight(truncateString(String(wd.pid), colPidWidth), colPidWidth);
    const hbCell = padRight(
      truncateString(formatHeartbeatAge(wd.last_heartbeat_at, nowMs), colHbWidth),
      colHbWidth,
    );
    const cadenceText = `${Math.round(wd.heartbeat_cadence_ms / 1000)}s`;
    const cadenceCell = padRight(truncateString(cadenceText, colCadenceWidth), colCadenceWidth);

    return `│ ${idCell} │ ${genCell} │ ${phaseCell} │ ${statusCell} │ ${pidCell} │ ${hbCell} │ ${cadenceCell} │`;
  });

  return [topBorder, header, separator, ...rows, bottomBorder].join("\n");
}
