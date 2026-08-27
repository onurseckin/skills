import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  type Stats,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { JsonValue } from "../core/contracts/json.ts";
import { atomicWriteJson } from "../core/durable-write.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import { resolveWatchdogsPath } from "../core/shared/paths.ts";
import { releaseFlock, tryExclusiveFlock } from "../platform/flock-ffi.ts";

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
}

export interface RegisterWatchdogResult {
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

export interface ListWatchdogOptions {
  readonly generation?: number | undefined;
  readonly pulse_id?: string | null | undefined;
  readonly phase?: string | undefined;
  readonly status?: readonly WatchdogStatus[] | WatchdogStatus | undefined;
  readonly run_id?: string | null | undefined;
  readonly agent_id?: string | null | undefined;
}

export interface CleanupStaleOptions {
  readonly now?: string | number | Date | undefined;
  readonly maxAgeMs?: number | undefined;
  readonly markAs?: WatchdogStatus | undefined;
  readonly dryRun?: boolean | undefined;
  readonly reason?: string | undefined;
}

export interface CleanupStaleResult {
  readonly cleanedCount: number;
  readonly activeCount: number;
  readonly cleanedWatchdogs: readonly WatchdogRecord[];
  readonly dryRun: boolean;
  readonly store: WatchdogStore;
}

export interface TerminatePhaseOptions {
  readonly phase: string;
  readonly generation?: number | undefined;
  readonly pulse_id?: string | null | undefined;
  readonly excludeId?: string | undefined;
  readonly reason?: string | undefined;
  readonly dryRun?: boolean | undefined;
  readonly now?: string | number | Date | undefined;
}

export interface TerminatePhaseResult {
  readonly terminatedCount: number;
  readonly activeCount: number;
  readonly terminatedWatchdogs: readonly WatchdogRecord[];
  readonly dryRun: boolean;
  readonly store: WatchdogStore;
}

export interface CleanupPreviousPhaseOptions {
  readonly currentPhase: string;
  readonly generation?: number | undefined;
  readonly pulse_id?: string | null | undefined;
  readonly excludeId?: string | undefined;
  readonly dryRun?: boolean | undefined;
  readonly now?: string | number | Date | undefined;
}

export interface WatchdogViolation {
  readonly rule: string;
  readonly message: string;
  readonly watchdog_id?: string | undefined;
}

export interface VerifyWatchdogResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
  readonly violationDetails: readonly WatchdogViolation[];
  readonly activeCount: number;
  readonly totalCount: number;
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

const WATCHDOG_STATUSES = new Set<WatchdogStatus>(["active", "stale", "terminated", "orphaned"]);
const activeWatchdogLockPaths = new Set<string>();
const activeWatchdogLockInodes = new Set<string>();
const activeWatchdogLockParents = new Map<string, Pick<Stats, "dev" | "ino">>();
const activeWatchdogRootPaths = new Set<string>();
const activeWatchdogRootInodes = new Set<string>();
const activeWatchdogLockRoots = new Map<string, Pick<Stats, "dev" | "ino">>();
const activeWatchdogAuthorityPaths = new Map<string, string>();
let watchdogLockTimeoutMs = 10_000;
let watchdogLockRetryMs = 10;

function failStoreIntegrity(message: string): never {
  throw new HarnessError("INTEGRITY", `invalid watchdog store: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWatchdogStatus(value: unknown): value is WatchdogStatus {
  return typeof value === "string" && WATCHDOG_STATUSES.has(value as WatchdogStatus);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    failStoreIntegrity(`${field} must be a nonempty string`);
  }
  return value;
}

function requireNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requireNonEmptyString(value, field);
}

function timestampMilliseconds(value: unknown, field: string): number {
  if (typeof value !== "string" || value.trim().length === 0) {
    failStoreIntegrity(`${field} must be a timestamp string`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    failStoreIntegrity(`${field} must be a valid timestamp`);
  }
  return parsed;
}

function requireTimestamp(value: unknown, field: string): string {
  const timestamp = requireNonEmptyString(value, field);
  timestampMilliseconds(timestamp, field);
  return timestamp;
}

function requirePositiveSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    failStoreIntegrity(`${field} must be a positive safe integer`);
  }
  return value;
}

function validateMetadata(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    failStoreIntegrity(`${field} must be an object`);
  }
  return { ...value };
}

function validateWatchdogRecord(value: unknown, field: string): WatchdogRecord {
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

function validateWatchdogStore(value: unknown): WatchdogStore {
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

function resolveApiNow(input: string | number | Date | undefined): number {
  if (input === undefined) return Date.now();
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (input instanceof Date && Number.isFinite(input.getTime())) return input.getTime();
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new HarnessError("INVALID_ARGUMENT", "now must be a valid timestamp");
}

function requiredNoFollowFlag(): number {
  const flag = constants.O_NOFOLLOW;
  if (!Number.isInteger(flag) || flag === 0) {
    throw new HarnessError(
      "UNSUPPORTED_PLATFORM",
      "watchdog store access requires final-component O_NOFOLLOW protection",
    );
  }
  return flag;
}

function delay(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function sameInode(left: Pick<Stats, "dev" | "ino">, right: Pick<Stats, "dev" | "ino">): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertRealDirectory(path: string, label: string): Stats {
  let metadata: Stats;
  try {
    metadata = lstatSync(path);
  } catch {
    throw new HarnessError("INTEGRITY", `${label} is unavailable: ${path}`);
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new HarnessError("PATH_SAFETY", `${label} must be a real directory: ${path}`);
  }
  return metadata;
}

function openVerifiedParent(
  parent: string,
  create: boolean,
): { descriptor: number; metadata: Stats } {
  if (!existsSync(parent)) {
    if (!create) {
      throw new HarnessError("INTEGRITY", `watchdog store parent is unavailable: ${parent}`);
    }
    mkdirSync(parent, { recursive: true, mode: 0o700 });
  }
  const before = assertRealDirectory(parent, "watchdog store parent");
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      parent,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | requiredNoFollowFlag(),
    );
    const opened = fstatSync(descriptor);
    if (!opened.isDirectory()) {
      throw new HarnessError(
        "PATH_SAFETY",
        `opened watchdog store parent is not a directory: ${parent}`,
      );
    }
    const after = assertRealDirectory(parent, "watchdog store parent");
    if (!sameInode(before, opened) || !sameInode(opened, after)) {
      throw new HarnessError("INTEGRITY", `watchdog store parent changed while opening: ${parent}`);
    }
    return { descriptor, metadata: opened };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function watchdogAuthorityRoot(storePath: string): string {
  const parent = dirname(storePath);
  if (basename(parent) === ".olt") return dirname(parent);
  let candidate = parent;
  while (!existsSync(candidate)) {
    const ancestor = dirname(candidate);
    if (ancestor === candidate) {
      throw new HarnessError("INTEGRITY", `watchdog authority root is unavailable: ${parent}`);
    }
    candidate = ancestor;
  }
  return candidate;
}

function acquireExclusiveLock(descriptor: number, path: string): void {
  const deadline = performance.now() + watchdogLockTimeoutMs;
  while (!tryExclusiveFlock(descriptor)) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      throw new HarnessError("LOCK_TIMEOUT", `timed out waiting for watchdog store lock: ${path}`);
    }
    delay(Math.min(watchdogLockRetryMs, remaining));
  }
}

function withWatchdogStoreLock<T>(storePath: string, operation: () => T): T {
  const parent = dirname(storePath);
  const authorityRoot = watchdogAuthorityRoot(storePath);
  const pathIdentity = resolve(parent);
  const rootPathIdentity = resolve(authorityRoot);
  if (activeWatchdogLockPaths.has(pathIdentity) || activeWatchdogRootPaths.has(rootPathIdentity)) {
    throw new HarnessError(
      "LOCK_TIMEOUT",
      `watchdog store is already active in this process: ${storePath}`,
    );
  }

  let rootDescriptor: number | undefined;
  let rootAcquired = false;
  let rootInodeIdentity: string | undefined;
  let rootTracked = false;
  let parentDescriptor: number | undefined;
  let parentAcquired = false;
  let parentInodeIdentity: string | undefined;
  let parentTracked = false;
  let hasPrimary = false;
  let primary: unknown;
  let hasCleanupFailure = false;
  let cleanupFailure: unknown;
  let result!: T;
  activeWatchdogLockPaths.add(pathIdentity);
  activeWatchdogRootPaths.add(rootPathIdentity);
  activeWatchdogAuthorityPaths.set(pathIdentity, rootPathIdentity);
  try {
    const openedRoot = openVerifiedParent(authorityRoot, false);
    rootDescriptor = openedRoot.descriptor;
    rootInodeIdentity = `${openedRoot.metadata.dev}:${openedRoot.metadata.ino}`;
    if (activeWatchdogRootInodes.has(rootInodeIdentity)) {
      throw new HarnessError(
        "LOCK_TIMEOUT",
        `watchdog authority root is already active: ${authorityRoot}`,
      );
    }
    activeWatchdogRootInodes.add(rootInodeIdentity);
    rootTracked = true;
    activeWatchdogLockRoots.set(rootPathIdentity, openedRoot.metadata);
    acquireExclusiveLock(rootDescriptor, authorityRoot);
    rootAcquired = true;
    if (
      !sameInode(openedRoot.metadata, assertRealDirectory(authorityRoot, "watchdog authority root"))
    ) {
      throw new HarnessError(
        "INTEGRITY",
        `watchdog authority root changed while locked: ${authorityRoot}`,
      );
    }

    if (pathIdentity === rootPathIdentity) {
      activeWatchdogLockParents.set(pathIdentity, openedRoot.metadata);
    } else {
      const openedParent = openVerifiedParent(parent, true);
      parentDescriptor = openedParent.descriptor;
      parentInodeIdentity = `${openedParent.metadata.dev}:${openedParent.metadata.ino}`;
      if (activeWatchdogLockInodes.has(parentInodeIdentity)) {
        throw new HarnessError(
          "LOCK_TIMEOUT",
          `watchdog store parent is already active: ${parent}`,
        );
      }
      activeWatchdogLockInodes.add(parentInodeIdentity);
      parentTracked = true;
      activeWatchdogLockParents.set(pathIdentity, openedParent.metadata);
      acquireExclusiveLock(parentDescriptor, parent);
      parentAcquired = true;
      if (!sameInode(openedParent.metadata, assertRealDirectory(parent, "watchdog store parent"))) {
        throw new HarnessError(
          "INTEGRITY",
          `watchdog store parent changed while locked: ${parent}`,
        );
      }
    }

    result = operation();
    const expectedRoot = activeWatchdogLockRoots.get(rootPathIdentity);
    if (
      expectedRoot === undefined ||
      !sameInode(expectedRoot, assertRealDirectory(authorityRoot, "watchdog authority root"))
    ) {
      throw new HarnessError(
        "INTEGRITY",
        `watchdog authority root changed after mutation: ${authorityRoot}`,
      );
    }
  } catch (error) {
    hasPrimary = true;
    primary = error;
  }

  for (const cleanup of [
    () => {
      if (parentDescriptor !== undefined && parentAcquired) releaseFlock(parentDescriptor);
    },
    () => {
      if (parentDescriptor !== undefined) closeSync(parentDescriptor);
    },
    () => {
      if (rootDescriptor !== undefined && rootAcquired) releaseFlock(rootDescriptor);
    },
    () => {
      if (rootDescriptor !== undefined) closeSync(rootDescriptor);
    },
  ]) {
    try {
      cleanup();
    } catch (error) {
      if (!hasCleanupFailure) {
        hasCleanupFailure = true;
        cleanupFailure = error;
      }
    }
  }
  activeWatchdogLockPaths.delete(pathIdentity);
  activeWatchdogRootPaths.delete(rootPathIdentity);
  activeWatchdogLockParents.delete(pathIdentity);
  activeWatchdogLockRoots.delete(rootPathIdentity);
  activeWatchdogAuthorityPaths.delete(pathIdentity);
  if (parentTracked && parentInodeIdentity !== undefined)
    activeWatchdogLockInodes.delete(parentInodeIdentity);
  if (rootTracked && rootInodeIdentity !== undefined)
    activeWatchdogRootInodes.delete(rootInodeIdentity);
  if (hasPrimary) throw primary;
  if (hasCleanupFailure) throw cleanupFailure;
  return result;
}

/** Test-only seam for deterministic watchdog lock-contention coverage. */
export function setWatchdogLockTimingForTesting(timeoutMs: number, retryMs: number): () => void {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(retryMs) || retryMs < 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "watchdog lock timing must be finite and non-negative",
    );
  }
  const previousTimeoutMs = watchdogLockTimeoutMs;
  const previousRetryMs = watchdogLockRetryMs;
  watchdogLockTimeoutMs = timeoutMs;
  watchdogLockRetryMs = retryMs;
  return () => {
    watchdogLockTimeoutMs = previousTimeoutMs;
    watchdogLockRetryMs = previousRetryMs;
  };
}

function assertCurrentLockAuthority(storePath: string): void {
  const parent = dirname(storePath);
  const pathIdentity = resolve(parent);
  const rootPathIdentity = activeWatchdogAuthorityPaths.get(pathIdentity);
  const expected = activeWatchdogLockParents.get(pathIdentity);
  const expectedRoot =
    rootPathIdentity === undefined ? undefined : activeWatchdogLockRoots.get(rootPathIdentity);
  if (expected === undefined) {
    throw new HarnessError(
      "INTEGRITY",
      `watchdog store write has no active lock authority: ${storePath}`,
    );
  }
  const current = assertRealDirectory(parent, "watchdog store parent");
  if (!sameInode(expected, current)) {
    throw new HarnessError("INTEGRITY", `watchdog store parent changed before write: ${parent}`);
  }
  if (
    expectedRoot === undefined ||
    rootPathIdentity === undefined ||
    !sameInode(expectedRoot, assertRealDirectory(rootPathIdentity, "watchdog authority root"))
  ) {
    throw new HarnessError(
      "INTEGRITY",
      `watchdog authority root changed before write: ${rootPathIdentity ?? "unknown"}`,
    );
  }
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

function loadWatchdogStoreUnlocked(target?: string): WatchdogStore {
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

function saveWatchdogStoreUnlocked(store: WatchdogStore, target?: string): void {
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

function generateWatchdogId(generation: number): string {
  const nowStr = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `wd-gen${generation}-${nowStr}-${rand}`;
}

function registerWatchdogUnlocked(
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
        // Auto-clean stale watchdog
        updatedWatchdogs.push({
          ...existing,
          status: "stale",
          termination_reason: "heartbeat_timeout",
        });
      } else if (
        existing.generation === targetGen ||
        (params.pulse_id && existing.pulse_id === params.pulse_id)
      ) {
        // Supersede active monitor in same generation or matching pulse_id
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

function heartbeatWatchdogUnlocked(
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

function terminateWatchdogUnlocked(
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

function cleanupStaleWatchdogsUnlocked(
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

function terminatePhaseWatchdogsUnlocked(
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

function cleanupPreviousPhaseWatchdogsUnlocked(
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

export function verifyWatchdogLifecycle(
  options: { now?: string | number | Date } = {},
  target?: string,
): VerifyWatchdogResult {
  const nowMs = parseTimestamp(options.now);
  const store = loadWatchdogStore(target);

  const violations: string[] = [];
  const violationDetails: WatchdogViolation[] = [];

  const activeByGen = new Map<number, WatchdogRecord[]>();
  const activeByPulse = new Map<string, WatchdogRecord[]>();

  for (const w of store.watchdogs) {
    if (w.status === "active") {
      const genList = activeByGen.get(w.generation) ?? [];
      genList.push(w);
      activeByGen.set(w.generation, genList);

      if (w.pulse_id) {
        const pulseList = activeByPulse.get(w.pulse_id) ?? [];
        pulseList.push(w);
        activeByPulse.set(w.pulse_id, pulseList);
      }

      const lastHbMs = timestampMilliseconds(w.last_heartbeat_at, "last_heartbeat_at");
      if (nowMs - lastHbMs > w.timeout_ms) {
        const diff = nowMs - lastHbMs;
        const msg = `Watchdog '${w.id}' heartbeat is overdue by ${diff}ms (timeout: ${w.timeout_ms}ms)`;
        violations.push(msg);
        violationDetails.push({
          rule: "heartbeat_timeout_exceeded",
          message: msg,
          watchdog_id: w.id,
        });
      }
    }
  }

  for (const [gen, list] of activeByGen.entries()) {
    if (list.length > 1) {
      const msg = `Multiple active watchdogs found in generation ${gen}: ${list.map((w) => w.id).join(", ")}`;
      violations.push(msg);
      violationDetails.push({
        rule: "single_active_per_generation",
        message: msg,
      });
    }
  }

  for (const [pulse, list] of activeByPulse.entries()) {
    if (list.length > 1) {
      const msg = `Multiple active watchdogs found for pulse '${pulse}': ${list.map((w) => w.id).join(", ")}`;
      violations.push(msg);
      violationDetails.push({
        rule: "single_active_per_pulse",
        message: msg,
      });
    }
  }

  const activeCount = store.watchdogs.filter((w) => w.status === "active").length;

  return {
    valid: violations.length === 0,
    violations,
    violationDetails,
    activeCount,
    totalCount: store.watchdogs.length,
  };
}

export function renderAsciiWatchdogTable(
  records: readonly WatchdogRecord[],
  _options: { now?: string | number | Date } = {},
): string {
  if (records.length === 0) {
    return [
      "┌─────────────────────────────────────────────────────────────────────────────┐",
      "│ No registered watchdog monitors found matching criteria                     │",
      "└─────────────────────────────────────────────────────────────────────────────┘",
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push(
    "┌───────────────────────────┬─────────────┬────────────────┬──────────────┬────────┐",
  );
  lines.push(
    "│ Watchdog ID               │ Gen / Pulse │ Phase          │ Status       │ PID    │",
  );
  lines.push(
    "├───────────────────────────┼─────────────┼────────────────┼──────────────┼────────┤",
  );

  for (const w of records) {
    const idPad = w.id.padEnd(25).slice(0, 25);
    const genPulse = `g${w.generation}${w.pulse_id ? "/" + w.pulse_id : ""}`
      .padEnd(11)
      .slice(0, 11);
    const phasePad = w.phase.padEnd(14).slice(0, 14);
    const statusGlyph =
      w.status === "active"
        ? "[ACTIVE 🟢]"
        : w.status === "stale"
          ? "[STALE ⚠️]"
          : w.status === "terminated"
            ? "[TERMINATED ⏹️]"
            : "[ORPHANED ❌]";
    const statusPad = statusGlyph.padEnd(12);
    const pidPad = String(w.pid).padEnd(6).slice(0, 6);
    const cadenceSec = `${Math.round(w.heartbeat_cadence_ms / 1000)}s`;

    lines.push(`│ ${idPad} │ ${genPulse} │ ${phasePad} │ ${statusPad} │ ${pidPad} │`);
    lines.push(
      `│   Cadence: ${cadenceSec.padEnd(6)} | Timeout: ${Math.round(w.timeout_ms / 1000)}s                                      │`,
    );
  }

  lines.push(
    "└───────────────────────────┴─────────────┴────────────────┴──────────────┴────────┘",
  );
  return lines.join("\n");
}
