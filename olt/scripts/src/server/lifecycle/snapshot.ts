/**
 * Dev Server State Snapshot Capture & Persistence Subsystem.
 *
 * Captures, serializes, loads, and atomically persists server state snapshots
 * (active endpoints, environment variables, PID history, port configs, run flags).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  openSync,
  closeSync,
  writeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  constants,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import type {
  ServerEndpoint,
  PortConfiguration,
  ServerStateSnapshot,
  ServerStateSnapshotInput,
  ServerStateRestoreResult,
} from "./types.ts";

export const DEFAULT_SNAPSHOT_PATH = ".locks/server-state.json";

/**
 * Captures an immutable snapshot of current dev server state.
 */
export function captureSnapshot(input?: ServerStateSnapshotInput): ServerStateSnapshot {
  const envSource = input?.envVariables ?? (typeof process !== "undefined" ? process.env : {});
  const safeEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(envSource)) {
    if (typeof v === "string") safeEnv[k] = v;
  }

  const currentPid =
    input?.currentPid ?? (typeof process !== "undefined" ? process.pid : undefined);

  let pidHistory: number[] = [];
  if (input?.pidHistory && input.pidHistory.length > 0) {
    pidHistory = [...input.pidHistory];
  } else if (currentPid !== undefined) {
    pidHistory = [currentPid];
  }

  const activeEndpoints: ServerEndpoint[] = (input?.activeEndpoints ?? []).map((ep) => ({
    path: ep.path,
    ...(ep.method !== undefined ? { method: ep.method } : {}),
    ...(ep.port !== undefined ? { port: ep.port } : {}),
    ...(ep.name !== undefined ? { name: ep.name } : {}),
  }));

  const portConfigurations: PortConfiguration[] = (input?.portConfigurations ?? []).map((pc) => ({
    port: pc.port,
    ...(pc.protocol !== undefined ? { protocol: pc.protocol } : {}),
    ...(pc.host !== undefined ? { host: pc.host } : {}),
    ...(pc.isPrimary !== undefined ? { isPrimary: pc.isPrimary } : {}),
    ...(pc.name !== undefined ? { name: pc.name } : {}),
  }));

  const runFlags: Record<string, string | number | boolean | readonly string[]> = {};
  if (input?.runFlags) {
    for (const [k, v] of Object.entries(input.runFlags)) {
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean" ||
        Array.isArray(v)
      ) {
        runFlags[k] = v;
      }
    }
  }

  const metadata: Record<string, string> = {};
  if (input?.metadata) {
    for (const [k, v] of Object.entries(input.metadata)) {
      if (typeof v === "string") metadata[k] = v;
    }
  }

  return {
    activeEndpoints,
    envVariables: Object.freeze(safeEnv),
    pidHistory: Object.freeze(pidHistory),
    portConfigurations: Object.freeze(portConfigurations),
    runFlags: Object.freeze(runFlags),
    currentPid,
    timestamp: input?.timestamp ?? new Date().toISOString(),
    metadata: Object.freeze(metadata),
  };
}

export const captureServerStateSnapshot = captureSnapshot;

/**
 * Validates whether an unknown object conforms to the ServerStateSnapshot schema.
 */
export function isValidServerStateSnapshot(data: unknown): data is ServerStateSnapshot {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    Array.isArray(obj["activeEndpoints"]) &&
    typeof obj["envVariables"] === "object" &&
    obj["envVariables"] !== null &&
    Array.isArray(obj["pidHistory"]) &&
    Array.isArray(obj["portConfigurations"]) &&
    typeof obj["runFlags"] === "object" &&
    obj["runFlags"] !== null &&
    typeof obj["timestamp"] === "string"
  );
}

/**
 * Atomically saves a server state snapshot to disk via temp-file + fsync + rename.
 */
export async function saveSnapshot(
  snapshot: ServerStateSnapshot,
  filepath?: string,
): Promise<void> {
  const resolvedPath = resolve(filepath && filepath.length > 0 ? filepath : DEFAULT_SNAPSHOT_PATH);
  const dir = dirname(resolvedPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const nonce = randomBytes(4).toString("hex");
  const tempPath = `${resolvedPath}.${process.pid}.${Date.now()}.${nonce}.tmp`;
  const serialized = JSON.stringify(snapshot, null, 2);

  const fd = openSync(tempPath, constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC, 0o600);
  try {
    writeSync(fd, serialized, 0, "utf-8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  try {
    renameSync(tempPath, resolvedPath);
  } catch (err) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore temp file cleanup error
    }
    throw err;
  }
}

/**
 * Synchronously or asynchronously loads a server state snapshot from disk.
 */
export async function loadSnapshot(filepath?: string): Promise<ServerStateSnapshot | null> {
  const resolvedPath = resolve(filepath && filepath.length > 0 ? filepath : DEFAULT_SNAPSHOT_PATH);
  if (!existsSync(resolvedPath)) return null;
  try {
    const content = readFileSync(resolvedPath, "utf-8");
    const parsed: unknown = JSON.parse(content);
    return isValidServerStateSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Clears the snapshot file from disk if present.
 */
export async function clearSnapshot(filepath?: string): Promise<boolean> {
  const resolvedPath = resolve(filepath && filepath.length > 0 ? filepath : DEFAULT_SNAPSHOT_PATH);
  if (!existsSync(resolvedPath)) return false;
  try {
    unlinkSync(resolvedPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * State Preserver container for dev server state.
 */
export class StatePreserver {
  private currentSnapshot: ServerStateSnapshot | null = null;
  private readonly defaultPath: string;

  public constructor(defaultPath?: string) {
    this.defaultPath = defaultPath && defaultPath.length > 0 ? defaultPath : DEFAULT_SNAPSHOT_PATH;
  }

  public capture(input?: ServerStateSnapshotInput): ServerStateSnapshot {
    const snapshot = captureSnapshot(input);
    this.currentSnapshot = snapshot;
    return snapshot;
  }

  public async save(snapshot?: ServerStateSnapshot, filepath?: string): Promise<void> {
    const target = snapshot ?? this.currentSnapshot ?? captureSnapshot();
    this.currentSnapshot = target;
    await saveSnapshot(target, filepath ?? this.defaultPath);
  }

  public async load(filepath?: string): Promise<ServerStateSnapshot | null> {
    const loaded = await loadSnapshot(filepath ?? this.defaultPath);
    if (loaded !== null) this.currentSnapshot = loaded;
    return loaded;
  }

  public async clear(filepath?: string): Promise<boolean> {
    this.currentSnapshot = null;
    return clearSnapshot(filepath ?? this.defaultPath);
  }

  public getLatest(): ServerStateSnapshot | null {
    return this.currentSnapshot;
  }

  public restore(snapshot: ServerStateSnapshot): ServerStateRestoreResult {
    this.currentSnapshot = snapshot;
    return {
      restored: true,
      snapshot,
      ...(snapshot.currentPid !== undefined ? { targetPid: snapshot.currentPid } : {}),
    };
  }
}

export function createStatePreserver(defaultPath?: string): StatePreserver {
  return new StatePreserver(defaultPath);
}
