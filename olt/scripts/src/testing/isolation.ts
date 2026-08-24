import { tmpdir } from "node:os";
/**
 * Multi-Agent Parallel Test Isolation & Concurrency Sandbox Primitives.
 *
 * Provides isolated filesystem sandboxing under os.tmpdir()/olt-test-scratch/<uuid>,
 * safe process environment mutation & restoration, and ephemeral port allocation.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

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
}

export interface TestIsolationContext {
  readonly id: string;
  readonly tempDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly allocatedPorts: readonly number[];
  readonly isCleanedUp: boolean;
  allocatePort(options?: AllocatePortOptions | undefined): Promise<number>;
  allocatePorts(count: number, options?: AllocatePortOptions | undefined): Promise<number[]>;
  getTempDir(subpath?: string | undefined): string;
  createSubDir(subpath: string): string;
  writeTempFile(filename: string, content: string | Uint8Array): string;
  readTempFile(filename: string, encoding?: BufferEncoding | undefined): string;
  readTempFileBuffer(filename: string): Uint8Array;
  removeTempFile(filename: string): void;
  tempFileExists(filename: string): boolean;
  listTempFiles(subpath?: string | undefined): string[];
  setEnv(key: string, value: string | undefined): void;
  restoreEnv(): void;
  cleanup(): Promise<void>;
  cleanupSync(): void;
  [Symbol.asyncDispose](): Promise<void>;
  [Symbol.dispose](): void;
}

const reservedPorts = new Set<number>();

/**
 * Resolves the root directory of the repository by walking up from the current file
 * or a specified starting path until repository anchors are found.
 */
export function findRepoRoot(startDir?: string | undefined): string {
  let current = resolve(startDir ?? import.meta.dir ?? process.cwd());
  while (true) {
    if (
      !current.endsWith("/olt/scripts") &&
      !current.endsWith("/olt") &&
      (existsSync(join(current, ".git")) ||
        existsSync(join(current, ".olt")) ||
        existsSync(join(current, "package.json")))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return resolve(process.cwd());
}

/**
 * Returns an isolated temporary directory path under tests/.tmp/test-isolation/<uuid>.
 * Automatically ensures creation and cleanup of stale predecessors.
 */
export function getIsolatedTempDir(options?: string | IsolatedTempDirOptions | undefined): string {
  const opts: IsolatedTempDirOptions =
    typeof options === "string" ? { prefix: options } : (options ?? {});

  const baseDir = opts.baseDir
    ? resolve(opts.baseDir)
    : join(findRepoRoot(), "coverage", "test-isolation");

  const id = opts.uuid ?? randomUUID();
  const folderName = opts.prefix ? `${opts.prefix}-${id}` : id;
  const fullPath = opts.subDir ? join(baseDir, folderName, opts.subDir) : join(baseDir, folderName);

  if (opts.create !== false) {
    rmSync(fullPath, { recursive: true, force: true });
    mkdirSync(fullPath, { recursive: true });
  }

  return fullPath;
}

/**
 * Recursively removes an isolated temporary directory.
 */
export function removeIsolatedTempDir(dirPath: string): void {
  if (existsSync(dirPath)) {
    rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Captures a complete key-value snapshot of current process.env.
 */
export function snapshotEnv(): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of Object.keys(process.env)) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

/**
 * Restores process.env to an exact previously captured snapshot state.
 */
export function restoreEnvSnapshot(snapshot: Record<string, string | undefined>): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Applies mutations/overrides onto process.env.
 */
export function applyEnvOverrides(overrides: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Executes a synchronous callback with safely isolated environment variables.
 */
export function withIsolatedEnvSync<T>(
  envOverrides: Record<string, string | undefined>,
  fn: () => T,
): T {
  const snapshot = snapshotEnv();
  try {
    applyEnvOverrides(envOverrides);
    return fn();
  } finally {
    restoreEnvSnapshot(snapshot);
  }
}

/**
 * Executes an asynchronous or synchronous callback with safely isolated environment variables,
 * restoring original environment variables upon completion or failure.
 */
export async function withIsolatedEnv<T>(
  envOverrides: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const snapshot = snapshotEnv();
  try {
    applyEnvOverrides(envOverrides);
    return await fn();
  } finally {
    restoreEnvSnapshot(snapshot);
  }
}

/**
 * Releases a previously reserved isolated port.
 */
export function releaseIsolatedPort(port: number): void {
  reservedPorts.delete(port);
}

/**
 * Checks if a specific port is currently available for binding.
 */
export async function isPortAvailable(port: number, host: string = "127.0.0.1"): Promise<boolean> {
  if (reservedPorts.has(port)) return false;

  return new Promise<boolean>((res) => {
    const server = createServer();
    server.unref();
    server.on("error", () => {
      res(false);
    });
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => {
        res(true);
      });
    });
  });
}

/**
 * Allocates a free ephemeral network port for test server isolation.
 */
export async function allocateIsolatedPort(options: AllocatePortOptions = {}): Promise<number> {
  const host = options.host !== undefined ? options.host : "127.0.0.1";
  const preferredPort = options.preferredPort;

  if (preferredPort !== undefined && preferredPort > 0) {
    const available = await isPortAvailable(preferredPort, host);
    if (available) {
      reservedPorts.add(preferredPort);
      return preferredPort;
    }
  }

  return new Promise<number>((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.unref();
    server.on("error", (err) => {
      rejectPromise(err);
    });
    server.listen({ port: 0, host, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() =>
          rejectPromise(new Error("Failed to get port from ephemeral server address")),
        );
        return;
      }
      const port = address.port;
      server.close((err) => {
        if (err) {
          rejectPromise(err);
          return;
        }
        reservedPorts.add(port);
        resolvePromise(port);
      });
    });
  });
}

/**
 * Allocates multiple free ephemeral network ports concurrently.
 */
export async function allocateIsolatedPorts(
  count: number,
  options: AllocatePortOptions = {},
): Promise<number[]> {
  const ports: number[] = [];
  for (let i = 0; i < count; i++) {
    const port = await allocateIsolatedPort(options);
    ports.push(port);
  }
  return ports;
}

/**
 * Creates a comprehensive test isolation context managing temporary storage,
 * environment isolation, and network port reservations.
 */
export function createTestIsolationContext(
  options: TestIsolationOptions = {},
): TestIsolationContext {
  const id = options.uuid ?? randomUUID();
  const tempDir = getIsolatedTempDir({
    prefix: options.prefix,
    baseDir: options.baseDir,
    uuid: id,
  });

  const shouldIsolateEnv = options.isolatedEnv ?? true;
  const initialEnvSnapshot = shouldIsolateEnv ? snapshotEnv() : null;
  const contextEnv: Record<string, string | undefined> = options.env ? { ...options.env } : {};
  const ports: number[] = [];
  let isCleanedUp = false;

  if (shouldIsolateEnv && options.env) {
    applyEnvOverrides(options.env);
  }

  const setEnv = (key: string, value: string | undefined): void => {
    if (isCleanedUp) {
      throw new Error("Cannot modify environment on cleaned-up TestIsolationContext");
    }
    contextEnv[key] = value;
    if (shouldIsolateEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  const restoreEnv = (): void => {
    if (initialEnvSnapshot) {
      restoreEnvSnapshot(initialEnvSnapshot);
    }
  };

  const allocatePortMethod = async (opts?: AllocatePortOptions | undefined): Promise<number> => {
    if (isCleanedUp) {
      throw new Error("Cannot allocate port on cleaned-up TestIsolationContext");
    }
    const port = await allocateIsolatedPort(opts);
    ports.push(port);
    return port;
  };

  const allocatePortsMethod = async (
    count: number,
    opts?: AllocatePortOptions | undefined,
  ): Promise<number[]> => {
    if (isCleanedUp) {
      throw new Error("Cannot allocate ports on cleaned-up TestIsolationContext");
    }
    const newPorts = await allocateIsolatedPorts(count, opts);
    for (const p of newPorts) {
      ports.push(p);
    }
    return newPorts;
  };

  const getTempDirMethod = (subpath?: string | undefined): string => {
    if (!subpath) return tempDir;
    return join(tempDir, subpath);
  };

  const createSubDirMethod = (subpath: string): string => {
    const p = join(tempDir, subpath);
    mkdirSync(p, { recursive: true });
    return p;
  };

  const writeTempFileMethod = (filename: string, content: string | Uint8Array): string => {
    const filePath = join(tempDir, filename);
    const parent = dirname(filePath);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }
    if (typeof content === "string") {
      writeFileSync(filePath, content, "utf8");
    } else {
      writeFileSync(filePath, content);
    }
    return filePath;
  };

  const readTempFileMethod = (filename: string, encoding: BufferEncoding = "utf8"): string => {
    const filePath = join(tempDir, filename);
    return readFileSync(filePath, { encoding });
  };

  const readTempFileBufferMethod = (filename: string): Uint8Array => {
    const filePath = join(tempDir, filename);
    return readFileSync(filePath);
  };

  const removeTempFileMethod = (filename: string): void => {
    const filePath = join(tempDir, filename);
    if (existsSync(filePath)) {
      rmSync(filePath, { recursive: true, force: true });
    }
  };

  const tempFileExistsMethod = (filename: string): boolean => {
    return existsSync(join(tempDir, filename));
  };

  const listTempFilesMethod = (subpath?: string | undefined): string[] => {
    const targetDir = subpath ? join(tempDir, subpath) : tempDir;
    if (!existsSync(targetDir)) return [];
    return readdirSync(targetDir);
  };

  const cleanupSyncMethod = (): void => {
    if (isCleanedUp) return;
    isCleanedUp = true;

    restoreEnv();

    for (const port of ports) {
      releaseIsolatedPort(port);
    }

    try {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Non-fatal filesystem cleanup
    }
  };

  const cleanupMethod = async (): Promise<void> => {
    cleanupSyncMethod();
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
    allocatePort: allocatePortMethod,
    allocatePorts: allocatePortsMethod,
    getTempDir: getTempDirMethod,
    createSubDir: createSubDirMethod,
    writeTempFile: writeTempFileMethod,
    readTempFile: readTempFileMethod,
    readTempFileBuffer: readTempFileBufferMethod,
    removeTempFile: removeTempFileMethod,
    tempFileExists: tempFileExistsMethod,
    listTempFiles: listTempFilesMethod,
    setEnv,
    restoreEnv,
    cleanup: cleanupMethod,
    cleanupSync: cleanupSyncMethod,
    [Symbol.asyncDispose]: async () => {
      await cleanupMethod();
    },
    [Symbol.dispose]: () => {
      cleanupSyncMethod();
    },
  };
}

/**
 * Runs a test sandbox within an isolated context, automatically cleaning up resources
 * and restoring process state when execution completes or fails.
 */
export async function runWithIsolation<T>(
  fn: (ctx: TestIsolationContext) => Promise<T> | T,
  options?: TestIsolationOptions | undefined,
): Promise<T> {
  const ctx = createTestIsolationContext(options);
  try {
    return await fn(ctx);
  } finally {
    await ctx.cleanup();
  }
}
