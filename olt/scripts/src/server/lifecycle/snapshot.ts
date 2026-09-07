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
  chmodSync,
  rmdirSync,
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

export interface SnapshotFsPorts {
  readonly existsSync?: (path: string) => boolean;
  readonly writeFileSync?: (
    path: string,
    data: string,
    options?: string | { mode?: number; encoding?: string },
  ) => void;
  readonly readFileSync?: (path: string, options?: string | { encoding?: string }) => string;
  readonly unlinkSync?: (path: string) => void;
  readonly mkdirSync?: (
    path: string,
    options?: { recursive?: boolean; mode?: number },
  ) => string | undefined;
  readonly chmodSync?: (path: string, mode: number) => void;
  readonly statSync?: (path: string) => { mode: number };
}

export const DEFAULT_SNAPSHOT_PATH = ".olt/locks/server-state.json";
export const LEGACY_SNAPSHOT_PATH = ".locks/server-state.json";

export const ALLOWED_ENV_VARS = new Set<string>(["NODE_ENV", "SHELL", "TERM", "LANG", "CI"]);

export const CREDENTIAL_PATTERNS: readonly RegExp[] = Object.freeze([
  /sk-[a-zA-Z0-9_-]{16,}/i,
  /ghp_[a-zA-Z0-9]{20,}/,
  /AIza[0-9A-Za-z-_]{20,}/,
  /\b[0-9a-fA-F]{32,}\b/,
  /\b[A-Za-z0-9+/]{32,}={0,2}\b/,
]);

export function isCredentialValue(value: string): boolean {
  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(value)) return true;
  }
  return false;
}

export function purgeLegacySnapshot(
  legacyPath: string = LEGACY_SNAPSHOT_PATH,
  ports?: SnapshotFsPorts,
): void {
  try {
    const resolved = resolve(legacyPath);
    const exists = ports?.existsSync ?? existsSync;
    const unlink = ports?.unlinkSync ?? unlinkSync;
    if (exists(resolved)) {
      unlink(resolved);
      const parent = dirname(resolved);
      try {
        rmdirSync(parent);
      } catch {}
    }
  } catch {}
}

export function captureSnapshot(input?: ServerStateSnapshotInput): ServerStateSnapshot {
  const envSource = input?.envVariables ?? (typeof process !== "undefined" ? process.env : {});
  const safeEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(envSource)) {
    if (ALLOWED_ENV_VARS.has(k) && typeof v === "string" && !isCredentialValue(v)) {
      safeEnv[k] = v;
    }
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
      if (typeof v === "string" && !isCredentialValue(v)) {
        metadata[k] = v;
      }
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

export async function saveSnapshot(
  snapshot: ServerStateSnapshot,
  filepath?: string,
  ports?: SnapshotFsPorts,
): Promise<void> {
  purgeLegacySnapshot(undefined, ports);
  const resolvedPath = resolve(filepath && filepath.length > 0 ? filepath : DEFAULT_SNAPSHOT_PATH);
  const dir = dirname(resolvedPath);
  const exists = ports?.existsSync ?? existsSync;
  const mkdir = ports?.mkdirSync ?? mkdirSync;
  const chmod = ports?.chmodSync ?? chmodSync;

  if (!exists(dir)) {
    mkdir(dir, { recursive: true, mode: 0o700 });
  }
  try {
    chmod(dir, 0o700);
  } catch {}

  const serialized = JSON.stringify(snapshot, null, 2);
  if (ports?.writeFileSync) {
    ports.writeFileSync(resolvedPath, serialized, { mode: 0o600 });
    try {
      chmod(resolvedPath, 0o600);
    } catch {}
    return;
  }

  const nonce = randomBytes(4).toString("hex");
  const tempPath = `${resolvedPath}.${process.pid}.${Date.now()}.${nonce}.tmp`;

  const fd = openSync(tempPath, constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC, 0o600);
  try {
    writeSync(fd, serialized, 0, "utf-8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  try {
    chmodSync(tempPath, 0o600);
  } catch {}

  try {
    renameSync(tempPath, resolvedPath);
    try {
      chmod(resolvedPath, 0o600);
    } catch {}
  } catch (err) {
    try {
      unlinkSync(tempPath);
    } catch {}
    throw err;
  }
}

export async function loadSnapshot(
  filepath?: string,
  ports?: SnapshotFsPorts,
): Promise<ServerStateSnapshot | null> {
  purgeLegacySnapshot(undefined, ports);
  const resolvedPath = resolve(filepath && filepath.length > 0 ? filepath : DEFAULT_SNAPSHOT_PATH);
  const exists = ports?.existsSync ?? existsSync;
  const readFile = ports?.readFileSync ?? readFileSync;
  if (!exists(resolvedPath)) return null;
  try {
    const content = readFile(resolvedPath, "utf-8");
    const parsed: unknown = JSON.parse(content);
    return isValidServerStateSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearSnapshot(filepath?: string, ports?: SnapshotFsPorts): Promise<boolean> {
  purgeLegacySnapshot(undefined, ports);
  const resolvedPath = resolve(filepath && filepath.length > 0 ? filepath : DEFAULT_SNAPSHOT_PATH);
  const exists = ports?.existsSync ?? existsSync;
  const unlink = ports?.unlinkSync ?? unlinkSync;
  if (!exists(resolvedPath)) return false;
  try {
    unlink(resolvedPath);
    return true;
  } catch {
    return false;
  }
}

export class StatePreserver {
  private currentSnapshot: ServerStateSnapshot | null = null;
  private readonly defaultPath: string;
  private readonly ports?: SnapshotFsPorts | undefined;

  public constructor(defaultPath?: string, ports?: SnapshotFsPorts) {
    purgeLegacySnapshot(undefined, ports);
    this.defaultPath = defaultPath && defaultPath.length > 0 ? defaultPath : DEFAULT_SNAPSHOT_PATH;
    this.ports = ports;
  }

  public capture(input?: ServerStateSnapshotInput): ServerStateSnapshot {
    const snapshot = captureSnapshot(input);
    this.currentSnapshot = snapshot;
    return snapshot;
  }

  public async save(snapshot?: ServerStateSnapshot, filepath?: string): Promise<void> {
    const target = snapshot ?? this.currentSnapshot ?? captureSnapshot();
    this.currentSnapshot = target;
    await saveSnapshot(target, filepath ?? this.defaultPath, this.ports);
  }

  public async load(filepath?: string): Promise<ServerStateSnapshot | null> {
    const loaded = await loadSnapshot(filepath ?? this.defaultPath, this.ports);
    if (loaded !== null) this.currentSnapshot = loaded;
    return loaded;
  }

  public async clear(filepath?: string): Promise<boolean> {
    this.currentSnapshot = null;
    return clearSnapshot(filepath ?? this.defaultPath, this.ports);
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

export function createStatePreserver(
  defaultPath?: string,
  ports?: SnapshotFsPorts,
): StatePreserver {
  return new StatePreserver(defaultPath, ports);
}
