import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { JsonValue } from "../../core/contracts/index.ts";
import { atomicWriteJson } from "../../core/durable-write.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { resolveWatchdogsPath } from "../../core/shared/paths.ts";
import { WATCHDOG_STATUSES } from "./constants.ts";
import {
  assertCurrentLockAuthority,
  openVerifiedParent,
  requiredNoFollowFlag,
  sameInode,
  withWatchdogStoreLock,
} from "./lock.ts";
import type { WatchdogRecord, WatchdogStatus, WatchdogStore } from "./types.ts";

export function failStoreIntegrity(message: string): never {
  throw new HarnessError("INTEGRITY", `invalid watchdog store: ${message}`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isWatchdogStatus(value: unknown): value is WatchdogStatus {
  return typeof value === "string" && WATCHDOG_STATUSES.has(value as WatchdogStatus);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    failStoreIntegrity(`${field} must be a nonempty string`);
  }
  return value;
}

export function requireNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requireNonEmptyString(value, field);
}

export function timestampMilliseconds(value: unknown, field: string): number {
  if (typeof value !== "string" || value.trim().length === 0) {
    failStoreIntegrity(`${field} must be a timestamp string`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    failStoreIntegrity(`${field} must be a valid timestamp`);
  }
  return parsed;
}

export function requireTimestamp(value: unknown, field: string): string {
  const timestamp = requireNonEmptyString(value, field);
  timestampMilliseconds(timestamp, field);
  return timestamp;
}

export function requirePositiveSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    failStoreIntegrity(`${field} must be a positive safe integer`);
  }
  return value;
}

export function validateMetadata(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    failStoreIntegrity(`${field} must be an object`);
  }
  return { ...value };
}

export function validateWatchdogRecord(value: unknown, field: string): WatchdogRecord {
  if (!isRecord(value)) {
    failStoreIntegrity(`${field} must be an object`);
  }
  const status = value.status;
  if (!isWatchdogStatus(status)) {
    failStoreIntegrity(`${field}.status must be a supported watchdog status`);
  }
  const metadata = validateMetadata(value.metadata, `${field}.metadata`);
  return {
    id: requireNonEmptyString(value.id, `${field}.id`),
    generation: requirePositiveSafeInteger(value.generation, `${field}.generation`),
    pulse_id: requireNullableString(value.pulse_id, `${field}.pulse_id`),
    phase: requireNonEmptyString(value.phase, `${field}.phase`),
    run_id: requireNullableString(value.run_id, `${field}.run_id`),
    run_root: requireNullableString(value.run_root, `${field}.run_root`),
    pid: requirePositiveSafeInteger(value.pid, `${field}.pid`),
    ppid: requirePositiveSafeInteger(value.ppid, `${field}.ppid`),
    agent_id: requireNullableString(value.agent_id, `${field}.agent_id`),
    started_at: requireTimestamp(value.started_at, `${field}.started_at`),
    last_heartbeat_at: requireTimestamp(value.last_heartbeat_at, `${field}.last_heartbeat_at`),
    heartbeat_cadence_ms: requirePositiveSafeInteger(
      value.heartbeat_cadence_ms,
      `${field}.heartbeat_cadence_ms`,
    ),
    timeout_ms: requirePositiveSafeInteger(value.timeout_ms, `${field}.timeout_ms`),
    status,
    terminated_at:
      value.terminated_at === null
        ? null
        : requireTimestamp(value.terminated_at, `${field}.terminated_at`),
    termination_reason: requireNullableString(
      value.termination_reason,
      `${field}.termination_reason`,
    ),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

export function validateWatchdogStore(value: unknown): WatchdogStore {
  if (!isRecord(value)) {
    failStoreIntegrity("root must be an object");
  }
  if (value.schema !== "harness.watchdog_store") {
    failStoreIntegrity("schema must be harness.watchdog_store");
  }
  if (value.version !== 1) {
    failStoreIntegrity("version must be 1");
  }
  const updatedAt = requireTimestamp(value.updated_at, "updated_at");

  let rawWatchdogs: readonly unknown[];
  if (Object.hasOwn(value, "watchdogs")) {
    if (!Array.isArray(value.watchdogs)) {
      failStoreIntegrity("watchdogs must be an array");
    }
    rawWatchdogs = value.watchdogs;
  } else if (Object.hasOwn(value, "active_watchdog")) {
    rawWatchdogs = [value.active_watchdog];
  } else {
    failStoreIntegrity("watchdogs must be present");
  }

  const watchdogs = rawWatchdogs.map((watchdog, index) =>
    validateWatchdogRecord(watchdog, `watchdogs[${index}]`),
  );
  const ids = new Set<string>();
  for (const watchdog of watchdogs) {
    if (ids.has(watchdog.id)) {
      failStoreIntegrity(`duplicate watchdog id: ${watchdog.id}`);
    }
    ids.add(watchdog.id);
  }

  return {
    schema: "harness.watchdog_store",
    version: 1,
    updated_at: updatedAt,
    watchdogs,
  };
}

export function resolveApiNow(input: string | number | Date | undefined): number {
  if (input === undefined) return Date.now();
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (input instanceof Date && Number.isFinite(input.getTime())) return input.getTime();
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new HarnessError("INVALID_ARGUMENT", "now must be a valid timestamp");
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
    version: 1,
    updated_at: nowIso ?? new Date().toISOString(),
    watchdogs: [],
  };
}

export function loadWatchdogStoreUnlocked(target?: string): WatchdogStore {
  const storePath = resolveWatchdogStorePath(target);
  if (!existsSync(storePath)) {
    const parent = dirname(storePath);
    if (existsSync(parent)) {
      const openedParent = openVerifiedParent(parent, false);
      closeSync(openedParent.descriptor);
    }
    return createDefaultWatchdogStore();
  }

  let raw: string;
  let parentDescriptor: number | undefined;
  let descriptor: number | undefined;
  try {
    const parent = openVerifiedParent(dirname(storePath), false);
    parentDescriptor = parent.descriptor;
    const before = lstatSync(storePath);
    if (before.isSymbolicLink() || !before.isFile()) {
      throw new HarnessError("PATH_SAFETY", `watchdog store is not a regular file: ${storePath}`);
    }
    descriptor = openSync(storePath, constants.O_RDONLY | requiredNoFollowFlag());
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameInode(before, opened)) {
      throw new HarnessError("INTEGRITY", `watchdog store changed while opening: ${storePath}`);
    }
    raw = readFileSync(descriptor, "utf8");
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw new HarnessError("INTEGRITY", "failed to read watchdog store");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (parentDescriptor !== undefined) closeSync(parentDescriptor);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new HarnessError("INTEGRITY", "corrupted watchdog store JSON");
  }
  return validateWatchdogStore(parsed);
}

export function loadWatchdogStore(target?: string): WatchdogStore {
  return loadWatchdogStoreUnlocked(target);
}

export function saveWatchdogStoreUnlocked(store: WatchdogStore, target?: string): void {
  const validatedStore = validateWatchdogStore(store);
  let serialized: unknown;
  try {
    serialized = JSON.parse(JSON.stringify(validatedStore));
  } catch {
    failStoreIntegrity("must be JSON serializable");
  }
  if (!isJsonValue(serialized)) {
    failStoreIntegrity("must contain finite JSON values");
  }
  const storePath = resolveWatchdogStorePath(target);
  assertCurrentLockAuthority(storePath);
  atomicWriteJson(storePath, serialized);
}

export function saveWatchdogStore(store: WatchdogStore, target?: string): void {
  const storePath = resolveWatchdogStorePath(target);
  withWatchdogStoreLock(storePath, () => saveWatchdogStoreUnlocked(store, target));
}

export function generateWatchdogId(generation: number): string {
  const nowStr = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `wd-gen${generation}-${nowStr}-${rand}`;
}
