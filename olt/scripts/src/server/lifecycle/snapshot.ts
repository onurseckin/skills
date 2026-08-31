/**
 * Dev Server State Snapshot Capture & Persistence Subsystem.
 *
 * Captures, serializes, loads, and manages server state snapshots
 * (active endpoints, environment variables, PID history, port configs, run flags).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
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
  let envSource: Record<string, string | undefined> = {};
  if (input !== undefined && input !== null && input.envVariables !== undefined) {
    envSource = input.envVariables;
  } else if (typeof process !== "undefined" && process.env !== undefined) {
    envSource = process.env;
  }

  const safeEnv: Record<string, string> = {};
  for (const [key, val] of Object.entries(envSource)) {
    if (typeof val === "string") {
      safeEnv[key] = val;
    }
  }

  let currentPid: number | undefined = undefined;
  if (input !== undefined && input !== null && input.currentPid !== undefined) {
    currentPid = input.currentPid;
  } else if (typeof process !== "undefined") {
    currentPid = process.pid;
  }

  const pidHistory: number[] = [];
  if (input !== undefined && input !== null && input.pidHistory !== undefined && input.pidHistory.length > 0) {
    for (const p of input.pidHistory) {
      pidHistory.push(p);
    }
  } else if (currentPid !== undefined) {
    pidHistory.push(currentPid);
  }

  const activeEndpoints: ServerEndpoint[] = [];
  if (input !== undefined && input !== null && input.activeEndpoints !== undefined) {
    for (const ep of input.activeEndpoints) {
      activeEndpoints.push({
        path: ep.path,
        method: ep.method,
        port: ep.port,
        name: ep.name,
      });
    }
  }

  const portConfigurations: PortConfiguration[] = [];
  if (input !== undefined && input !== null && input.portConfigurations !== undefined) {
    for (const pc of input.portConfigurations) {
      portConfigurations.push({
        port: pc.port,
        protocol: pc.protocol,
        host: pc.host,
        isPrimary: pc.isPrimary,
        name: pc.name,
      });
    }
  }

  const runFlags: Record<string, string | number | boolean | readonly string[]> = {};
  if (input !== undefined && input !== null && input.runFlags !== undefined) {
    for (const [key, val] of Object.entries(input.runFlags)) {
      if (typeof val === "string") {
        runFlags[key] = val;
      } else if (typeof val === "number") {
        runFlags[key] = val;
      } else if (typeof val === "boolean") {
        runFlags[key] = val;
      } else if (Array.isArray(val)) {
        runFlags[key] = val;
      }
    }
  }

  const metadata: Record<string, string> = {};
  if (input !== undefined && input !== null && input.metadata !== undefined) {
    for (const [key, val] of Object.entries(input.metadata)) {
      if (typeof val === "string") {
        metadata[key] = val;
      }
    }
  }

  let timestamp = new Date().toISOString();
  if (input !== undefined && input !== null && input.timestamp !== undefined) {
    timestamp = input.timestamp;
  }

  return {
    activeEndpoints,
    envVariables: Object.freeze(safeEnv),
    pidHistory: Object.freeze(pidHistory),
    portConfigurations: Object.freeze(portConfigurations),
    runFlags: Object.freeze(runFlags),
    currentPid,
    timestamp,
    metadata: Object.freeze(metadata),
  };
}

export const captureServerStateSnapshot = captureSnapshot;

/**
 * Validates whether an unknown object conforms to the ServerStateSnapshot schema.
 */
export function isValidServerStateSnapshot(data: unknown): data is ServerStateSnapshot {
  if (typeof data !== "object") {
    return false;
  }
  if (data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj["activeEndpoints"])) {
    return false;
  }
  if (typeof obj["envVariables"] !== "object") {
    return false;
  }
  if (obj["envVariables"] === null) {
    return false;
  }
  if (!Array.isArray(obj["pidHistory"])) {
    return false;
  }
  if (!Array.isArray(obj["portConfigurations"])) {
    return false;
  }
  if (typeof obj["runFlags"] !== "object") {
    return false;
  }
  if (obj["runFlags"] === null) {
    return false;
  }
  if (typeof obj["timestamp"] !== "string") {
    return false;
  }
  return true;
}

/**
 * Synchronously or asynchronously saves a server state snapshot to disk.
 */
export async function saveSnapshot(
  snapshot: ServerStateSnapshot,
  filepath?: string,
): Promise<void> {
  let targetPath = DEFAULT_SNAPSHOT_PATH;
  if (filepath !== undefined && filepath !== null && filepath.length > 0) {
    targetPath = filepath;
  }
  const resolvedPath = resolve(targetPath);
  const dir = dirname(resolvedPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const serialized = JSON.stringify(snapshot, null, 2);
  writeFileSync(resolvedPath, serialized, "utf-8");
}

/**
 * Synchronously or asynchronously loads a server state snapshot from disk.
 */
export async function loadSnapshot(
  filepath?: string,
): Promise<ServerStateSnapshot | null> {
  let targetPath = DEFAULT_SNAPSHOT_PATH;
  if (filepath !== undefined && filepath !== null && filepath.length > 0) {
    targetPath = filepath;
  }
  const resolvedPath = resolve(targetPath);
  if (!existsSync(resolvedPath)) {
    return null;
  }
  try {
    const content = readFileSync(resolvedPath, "utf-8");
    const parsed: unknown = JSON.parse(content);
    if (isValidServerStateSnapshot(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Clears the snapshot file from disk if present.
 */
export async function clearSnapshot(
  filepath?: string,
): Promise<boolean> {
  let targetPath = DEFAULT_SNAPSHOT_PATH;
  if (filepath !== undefined && filepath !== null && filepath.length > 0) {
    targetPath = filepath;
  }
  const resolvedPath = resolve(targetPath);
  if (!existsSync(resolvedPath)) {
    return false;
  }
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
    let resolved = DEFAULT_SNAPSHOT_PATH;
    if (defaultPath !== undefined && defaultPath !== null && defaultPath.length > 0) {
      resolved = defaultPath;
    }
    this.defaultPath = resolved;
  }

  public capture(input?: ServerStateSnapshotInput): ServerStateSnapshot {
    const snapshot = captureSnapshot(input);
    this.currentSnapshot = snapshot;
    return snapshot;
  }

  public async save(
    snapshot?: ServerStateSnapshot,
    filepath?: string,
  ): Promise<void> {
    let target: ServerStateSnapshot;
    if (snapshot !== undefined && snapshot !== null) {
      target = snapshot;
    } else if (this.currentSnapshot !== null) {
      target = this.currentSnapshot;
    } else {
      target = captureSnapshot();
    }
    this.currentSnapshot = target;

    let path = this.defaultPath;
    if (filepath !== undefined && filepath !== null && filepath.length > 0) {
      path = filepath;
    }
    await saveSnapshot(target, path);
  }

  public async load(filepath?: string): Promise<ServerStateSnapshot | null> {
    let path = this.defaultPath;
    if (filepath !== undefined && filepath !== null && filepath.length > 0) {
      path = filepath;
    }
    const loaded = await loadSnapshot(path);
    if (loaded !== null) {
      this.currentSnapshot = loaded;
    }
    return loaded;
  }

  public async clear(filepath?: string): Promise<boolean> {
    this.currentSnapshot = null;
    let path = this.defaultPath;
    if (filepath !== undefined && filepath !== null && filepath.length > 0) {
      path = filepath;
    }
    return clearSnapshot(path);
  }

  public getLatest(): ServerStateSnapshot | null {
    return this.currentSnapshot;
  }

  public restore(snapshot: ServerStateSnapshot): ServerStateRestoreResult {
    this.currentSnapshot = snapshot;
    return {
      restored: true,
      snapshot,
      targetPid: snapshot.currentPid,
    };
  }
}

export function createStatePreserver(defaultPath?: string): StatePreserver {
  return new StatePreserver(defaultPath);
}
