/**
 * Multi-Agent Parallel Test Isolation & Concurrency Sandbox Primitives.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { findRepoRoot } from "../core/shared/paths.ts";
import { safeRmSync } from "../core/shared/safe-fs/index.ts";

export { findRepoRoot };

export interface IsolatedTempDirOptions {
  prefix?: string | undefined;
  baseDir?: string | undefined;
  subDir?: string | undefined;
  uuid?: string | undefined;
  create?: boolean | undefined;
}

export interface AllocatePortOptions {
  host?: string | undefined;
  preferredPort?: number | undefined;
}

export interface TestIsolationOptions {
  prefix?: string | undefined;
  baseDir?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
  isolatedEnv?: boolean | undefined;
  uuid?: string | undefined;
  inMemory?: boolean | undefined;
}

export interface TestIsolationContext {
  readonly id: string;
  readonly tempDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly allocatedPorts: readonly number[];
  readonly isCleanedUp: boolean;
  allocatePort(options?: AllocatePortOptions): Promise<number>;
  allocatePorts(count: number, options?: AllocatePortOptions): Promise<number[]>;
  getTempDir(subpath?: string): string;
  createSubDir(subpath: string): string;
  writeTempFile(filename: string, content: string | Uint8Array): string;
  readTempFile(filename: string, encoding?: BufferEncoding): string;
  readTempFileBuffer(filename: string): Uint8Array;
  removeTempFile(filename: string): void;
  tempFileExists(filename: string): boolean;
  listTempFiles(subpath?: string): string[];
  setEnv(key: string, value: string | undefined): void;
  restoreEnv(): void;
  cleanup(): Promise<void>;
  cleanupSync(): void;
  [Symbol.asyncDispose](): Promise<void>;
  [Symbol.dispose](): void;
}

const reservedPorts = new Set<number>();

function resolveTestIsolationRoot(): string {
  return join(findRepoRoot(), "coverage", "test-isolation");
}

export function getIsolatedTempDir(options?: string | IsolatedTempDirOptions): string {
  const opts: IsolatedTempDirOptions =
    typeof options === "string" ? { prefix: options } : (options ?? {});
  const baseDir = opts.baseDir ? resolve(opts.baseDir) : resolveTestIsolationRoot();
  const id = opts.uuid ?? randomUUID();
  const folderName = opts.prefix ? `${opts.prefix}-${id}` : id;
  const fullPath = opts.subDir ? join(baseDir, folderName, opts.subDir) : join(baseDir, folderName);
  if (opts.create !== false) {
    safeRmSync(fullPath, { allowedRoots: [resolveTestIsolationRoot()], missingOk: true });
    mkdirSync(fullPath, { recursive: true });
  }
  return fullPath;
}

export function removeIsolatedTempDir(dirPath: string): void {
  safeRmSync(dirPath, { allowedRoots: [resolveTestIsolationRoot()], missingOk: true });
}

export function snapshotEnv(): Record<string, string | undefined> {
  return { ...process.env };
}

export function restoreEnvSnapshot(snapshot: Record<string, string | undefined>): void {
  for (const k of Object.keys(process.env)) {
    if (!(k in snapshot)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(snapshot)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

export function applyEnvOverrides(overrides: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

export function withIsolatedEnvSync<T>(
  envOverrides: Record<string, string | undefined>,
  fn: () => T,
): T {
  const s = snapshotEnv();
  try {
    applyEnvOverrides(envOverrides);
    return fn();
  } finally {
    restoreEnvSnapshot(s);
  }
}

export async function withIsolatedEnv<T>(
  envOverrides: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const s = snapshotEnv();
  try {
    applyEnvOverrides(envOverrides);
    return await fn();
  } finally {
    restoreEnvSnapshot(s);
  }
}

export function releaseIsolatedPort(port: number): void {
  reservedPorts.delete(port);
}

export async function isPortAvailable(port: number, host = "127.0.0.1"): Promise<boolean> {
  if (reservedPorts.has(port)) return false;
  return new Promise<boolean>((res) => {
    const server = createServer();
    server.unref();
    server.on("error", () => res(false));
    server.listen({ port, host, exclusive: true }, () => server.close(() => res(true)));
  });
}

export async function allocateIsolatedPort(options: AllocatePortOptions = {}): Promise<number> {
  const host = options.host ?? "127.0.0.1";
  const preferredPort = options.preferredPort;
  if (preferredPort && preferredPort > 0 && (await isPortAvailable(preferredPort, host))) {
    reservedPorts.add(preferredPort);
    return preferredPort;
  }
  return new Promise<number>((res, rej) => {
    const s = createServer();
    s.unref();
    s.on("error", rej);
    s.listen({ port: 0, host, exclusive: true }, () => {
      const addr = s.address();
      if (!addr || typeof addr === "string") {
        s.close(() => rej(new Error("Failed to get ephemeral port")));
        return;
      }
      const port = addr.port;
      s.close((err) => {
        if (err) return rej(err);
        reservedPorts.add(port);
        res(port);
      });
    });
  });
}

export async function allocateIsolatedPorts(
  count: number,
  options: AllocatePortOptions = {},
): Promise<number[]> {
  const promises: Promise<number>[] = [];
  for (let i = 0; i < count; i++) promises.push(allocateIsolatedPort(options));
  return Promise.all(promises);
}

function toRel(base: string, target: string): string {
  const nBase = base.replace(/\\/g, "/").replace(/\/+$/, "");
  const nTarget = target.replace(/\\/g, "/");
  return nTarget === nBase
    ? ""
    : nTarget.startsWith(`${nBase}/`)
      ? nTarget.slice(nBase.length + 1)
      : nTarget.replace(/^\/+/, "");
}

function addDirs(dirs: Set<string>, relPath: string): void {
  let curr = "";
  for (const part of relPath.split("/").filter(Boolean)) {
    curr = curr ? `${curr}/${part}` : part;
    dirs.add(curr);
  }
}

export function createTestIsolationContext(
  options: TestIsolationOptions = {},
): TestIsolationContext {
  const id = options.uuid ?? randomUUID();
  const inMemory = options.inMemory ?? true;
  const tempDir = getIsolatedTempDir({
    prefix: options.prefix,
    baseDir: options.baseDir,
    uuid: id,
    create: !inMemory,
  });
  const shouldIsolateEnv = options.isolatedEnv ?? true;
  const initialEnvSnapshot = shouldIsolateEnv ? snapshotEnv() : null;
  const contextEnv: Record<string, string | undefined> = options.env ? { ...options.env } : {};
  const ports: number[] = [];
  const vFiles = new Map<string, Uint8Array>();
  const vDirs = new Set<string>([""]);
  let isCleanedUp = false;

  if (shouldIsolateEnv && options.env) applyEnvOverrides(options.env);
  const checkOpen = (op: string): void => {
    if (isCleanedUp) throw new Error(`Cannot ${op} on cleaned-up TestIsolationContext`);
  };

  const cleanupSyncMethod = (): void => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    if (initialEnvSnapshot) restoreEnvSnapshot(initialEnvSnapshot);
    for (const port of ports) releaseIsolatedPort(port);
    if (inMemory) {
      vFiles.clear();
      vDirs.clear();
    } else safeRmSync(tempDir, { allowedRoots: [resolveTestIsolationRoot()], missingOk: true });
  };

  return {
    get id(): string {
      return id;
    },
    get tempDir(): string {
      return tempDir;
    },
    get env(): Readonly<Record<string, string | undefined>> {
      return Object.freeze({ ...contextEnv });
    },
    get allocatedPorts(): readonly number[] {
      return Object.freeze([...ports]);
    },
    get isCleanedUp(): boolean {
      return isCleanedUp;
    },
    async allocatePort(opts?: AllocatePortOptions): Promise<number> {
      checkOpen("allocate port");
      const p = await allocateIsolatedPort(opts);
      ports.push(p);
      return p;
    },
    async allocatePorts(count: number, opts?: AllocatePortOptions): Promise<number[]> {
      checkOpen("allocate ports");
      const ps = await allocateIsolatedPorts(count, opts);
      ports.push(...ps);
      return ps;
    },
    getTempDir: (subpath?: string): string => (subpath ? join(tempDir, subpath) : tempDir),
    createSubDir(subpath: string): string {
      const full = join(tempDir, subpath);
      if (inMemory) addDirs(vDirs, toRel(tempDir, full));
      else mkdirSync(full, { recursive: true });
      return full;
    },
    writeTempFile(filename: string, content: string | Uint8Array): string {
      const full = join(tempDir, filename);
      if (inMemory) {
        const rel = toRel(tempDir, full);
        const parent = dirname(rel);
        if (parent && parent !== ".") addDirs(vDirs, parent);
        vFiles.set(
          rel,
          typeof content === "string" ? Buffer.from(content, "utf8") : new Uint8Array(content),
        );
      } else {
        const parent = dirname(full);
        if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
        writeFileSync(full, content, typeof content === "string" ? "utf8" : undefined);
      }
      return full;
    },
    readTempFile(filename: string, encoding: BufferEncoding = "utf8"): string {
      if (inMemory) {
        const b = vFiles.get(toRel(tempDir, join(tempDir, filename)));
        if (!b) throw new Error(`File not found: ${filename}`);
        return Buffer.from(b).toString(encoding);
      }
      return readFileSync(join(tempDir, filename), { encoding });
    },
    readTempFileBuffer(filename: string): Uint8Array {
      if (inMemory) {
        const b = vFiles.get(toRel(tempDir, join(tempDir, filename)));
        if (!b) throw new Error(`File not found: ${filename}`);
        return new Uint8Array(b);
      }
      return readFileSync(join(tempDir, filename));
    },
    removeTempFile(filename: string): void {
      if (inMemory) {
        const rel = toRel(tempDir, join(tempDir, filename));
        vFiles.delete(rel);
        vDirs.delete(rel);
        const prefix = rel ? `${rel}/` : "";
        if (prefix) {
          for (const k of vFiles.keys()) if (k.startsWith(prefix)) vFiles.delete(k);
          for (const d of vDirs.keys()) if (d.startsWith(prefix)) vDirs.delete(d);
        }
      } else
        safeRmSync(join(tempDir, filename), {
          allowedRoots: [resolveTestIsolationRoot()],
          missingOk: true,
        });
    },
    tempFileExists(filename: string): boolean {
      return inMemory
        ? vFiles.has(toRel(tempDir, join(tempDir, filename))) ||
            vDirs.has(toRel(tempDir, join(tempDir, filename)))
        : existsSync(join(tempDir, filename));
    },
    listTempFiles(subpath?: string): string[] {
      if (!inMemory) {
        const t = subpath ? join(tempDir, subpath) : tempDir;
        return existsSync(t) ? readdirSync(t) : [];
      }
      const rel = subpath ? toRel(tempDir, join(tempDir, subpath)) : "";
      const prefix = rel ? `${rel}/` : "";
      const entries = new Set<string>();
      for (const k of [...vFiles.keys(), ...vDirs.keys()]) {
        if (k && (!prefix || k.startsWith(prefix))) {
          const rest = prefix ? k.slice(prefix.length) : k;
          if (rest) {
            const slash = rest.indexOf("/");
            entries.add(slash === -1 ? rest : rest.slice(0, slash));
          }
        }
      }
      return Array.from(entries).sort();
    },
    setEnv(key: string, value: string | undefined): void {
      checkOpen("modify environment");
      contextEnv[key] = value;
      if (shouldIsolateEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
    restoreEnv(): void {
      if (initialEnvSnapshot) restoreEnvSnapshot(initialEnvSnapshot);
    },
    cleanup: async (): Promise<void> => cleanupSyncMethod(),
    cleanupSync: cleanupSyncMethod,
    [Symbol.asyncDispose]: async (): Promise<void> => cleanupSyncMethod(),
    [Symbol.dispose]: cleanupSyncMethod,
  };
}

export async function runWithIsolation<T>(
  fn: (ctx: TestIsolationContext) => Promise<T> | T,
  options?: TestIsolationOptions,
): Promise<T> {
  const ctx = createTestIsolationContext(options);
  try {
    return await fn(ctx);
  } finally {
    await ctx.cleanup();
  }
}
