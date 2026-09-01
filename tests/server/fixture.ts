/**
 * @file fixture.ts
 * In-memory virtual test sandbox fixture and harness for tests/server domain.
 * 100% zero disk writes, backed by VirtualMemoryFS and virtual descriptor session.
 */

import { afterEach, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import * as net from "node:net";
import * as path from "node:path";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";

let currentSession: VirtualFSSession | null = null;
let currentVfs: VirtualMemoryFS = new VirtualMemoryFS();
let counter = 0;

function normPath(p: string): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

export function setupVirtualServerFS(): VirtualMemoryFS {
  if (!currentSession) {
    currentVfs = new VirtualMemoryFS();
    const repoRoot = normPath(process.cwd());
    currentVfs.mkdirSync(repoRoot, { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".olt", "capsules"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".olt", "scratch"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".olt", "runs"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".tmp"), { recursive: true });
    currentVfs.mkdirSync("/virtual/server-scratch", { recursive: true });
    currentSession = createVirtualFSSession(currentVfs);
  }
  return currentVfs;
}

export function cleanupVirtualServerFS(): void {
  if (currentSession) {
    currentSession.cleanup();
    currentSession = null;
  }
  currentVfs = new VirtualMemoryFS();
}

export interface VirtualNetworkSession {
  occupied: Set<string>;
  occupy: (port: number, host?: string) => void;
  free: (port: number, host?: string) => void;
  cleanup: () => void;
}

let activeNetSession: VirtualNetworkSession | null = null;

export function setupVirtualNetwork(
  initialOccupied: Array<{ port: number; host?: string }> = [],
): VirtualNetworkSession {
  cleanupVirtualNetwork();
  const occupied = new Set<string>();

  for (const item of initialOccupied) {
    const host = item.host ?? "127.0.0.1";
    occupied.add(`${host}:${item.port}`);
  }

  const createServerSpy = spyOn(net, "createServer").mockImplementation((() => {
    const emitter = new EventEmitter() as unknown as net.Server;
    (emitter as unknown as Record<string, unknown>)["listen"] = (
      opts: unknown,
      cb?: () => void,
    ) => {
      const port =
        typeof opts === "object" && opts !== null ? (opts as { port: number }).port : Number(opts);
      const host =
        typeof opts === "object" && opts !== null && (opts as { host?: string }).host
          ? (opts as { host: string }).host
          : "127.0.0.1";

      queueMicrotask(() => {
        const isOccupied =
          occupied.has(`${host}:${port}`) ||
          (host === "0.0.0.0" &&
            (occupied.has(`127.0.0.1:${port}`) || occupied.has(`0.0.0.0:${port}`))) ||
          (host === "::" && (occupied.has(`::1:${port}`) || occupied.has(`:::${port}`)));

        if (isOccupied) {
          const err = Object.assign(new Error(`bind EADDRINUSE ${host}:${port}`), {
            code: "EADDRINUSE",
          });
          emitter.emit("error", err);
        } else {
          if (typeof cb === "function") cb();
          emitter.emit("listening");
        }
      });
      return emitter;
    };

    (emitter as unknown as Record<string, unknown>)["close"] = (cb?: () => void) => {
      if (typeof cb === "function") queueMicrotask(cb);
      return emitter;
    };

    (emitter as unknown as Record<string, unknown>)["address"] = () => ({
      port: 4000,
      family: "IPv4",
      address: "127.0.0.1",
    });

    return emitter;
  }) as never);

  const connectSpy = spyOn(net.Socket.prototype, "connect").mockImplementation(function (
    this: EventEmitter,
    opts: unknown,
  ) {
    const port =
      typeof opts === "object" && opts !== null ? (opts as { port: number }).port : Number(opts);
    const host =
      typeof opts === "object" && opts !== null && (opts as { host?: string }).host
        ? (opts as { host: string }).host
        : "127.0.0.1";

    queueMicrotask(() => {
      if (host === "198.51.100.1") {
        return;
      }
      const isListening =
        occupied.has(`${host}:${port}`) ||
        (occupied.has(`127.0.0.1:${port}`) && (host === "localhost" || host === "127.0.0.1")) ||
        (occupied.has(`::1:${port}`) && host === "::1") ||
        occupied.has(`0.0.0.0:${port}`) ||
        occupied.has(`:::${port}`);

      if (isListening) {
        this.emit("connect");
      } else {
        const err = Object.assign(new Error(`connect ECONNREFUSED ${host}:${port}`), {
          code: "ECONNREFUSED",
        });
        this.emit("error", err);
      }
    });
    return this;
  } as never);

  const cleanup = (): void => {
    try {
      createServerSpy.mockRestore();
    } catch {}
    try {
      connectSpy.mockRestore();
    } catch {}
    occupied.clear();
  };

  const session: VirtualNetworkSession = {
    occupied,
    occupy: (port: number, host = "127.0.0.1") => occupied.add(`${host}:${port}`),
    free: (port: number, host = "127.0.0.1") => occupied.delete(`${host}:${port}`),
    cleanup,
  };

  activeNetSession = session;
  return session;
}

export function cleanupVirtualNetwork(): void {
  if (activeNetSession) {
    activeNetSession.cleanup();
    activeNetSession = null;
  }
}

afterEach(() => {
  cleanupVirtualServerFS();
  cleanupVirtualNetwork();
});

function slug(value: string): string {
  const cleaned = value
    .replace(/\.+/g, "-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const trimmed = cleaned.slice(0, 20).replace(/-+$/, "");
  return trimmed.length > 0 ? trimmed : "root";
}

function shortDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/**
 * Creates an in-memory virtual scratch sandbox directory for server tests.
 * Zero physical disk writes occur.
 */
export function scratchRoot(callerPath = "server-test", label = "test"): string {
  const vfs = setupVirtualServerFS();
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const dirName = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  const root = `/virtual/server-scratch/${dirName}`;
  vfs.mkdirSync(root, { recursive: true });
  return root;
}

export function getVirtualServerFS(): VirtualMemoryFS {
  return currentVfs;
}
