/**
 * @file sync-fixture.ts
 * In-memory virtual test sandbox fixture for tests/sync domain.
 * Zero physical disk writes, backed by VirtualMemoryFS and createVirtualFSSession.
 */

import { afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | null = null;
let counter = 0;

export const SCRATCH_BASE = "/virtual/sync";

export function setupVirtualSyncFS(): VirtualMemoryFS {
  cleanupVirtualSyncFS();
  vfs = new VirtualMemoryFS();
  session = createVirtualFSSession(vfs);
  return vfs;
}

export function cleanupVirtualSyncFS(): void {
  if (session) {
    session.cleanup();
    session = null;
  }
}

export function getVirtualSyncFS(): VirtualMemoryFS {
  return vfs;
}

export function getVirtualSyncSession(): VirtualFSSession {
  if (!session) {
    setupVirtualSyncFS();
  }
  const currentSession = session;
  if (!currentSession) {
    throw new Error("VirtualFSSession failed to initialize");
  }
  return currentSession;
}

export function isSymbolicLink(targetPath: string): boolean {
  return session !== null && session.symlinks.has(targetPath);
}

export { mockSubprocess } from "../../olt/scripts/src/testing/virtual-fs/index.ts";
import * as fs from "node:fs";

export function virtualSymlinkSync(target: string, linkPath: string): void {
  getVirtualSyncSession();
  fs.symlinkSync(target, linkPath);
}

export function virtualReadlinkSync(linkPath: string): string {
  getVirtualSyncSession();
  return fs.readlinkSync(linkPath) as string;
}

export function virtualChmodSync(targetPath: string, mode: number): void {
  getVirtualSyncSession();
  fs.chmodSync(targetPath, mode);
}

export function virtualLstatSync(targetPath: string): fs.Stats {
  getVirtualSyncSession();
  return fs.lstatSync(targetPath);
}

export function virtualExistsSync(targetPath: string): boolean {
  getVirtualSyncSession();
  return fs.existsSync(targetPath);
}

export function virtualMkdirSync(dirPath: string, opts?: { recursive?: boolean } | boolean) {
  getVirtualSyncSession();
  return fs.mkdirSync(dirPath, opts);
}

export function virtualWriteFileSync(filePath: string, data: string | Uint8Array): void {
  getVirtualSyncSession();
  fs.writeFileSync(filePath, data);
}

export function virtualReadFileSync(filePath: string, encoding: "utf-8" | "utf8" = "utf-8"): string {
  getVirtualSyncSession();
  return fs.readFileSync(filePath, encoding) as string;
}

afterEach(() => {
  cleanupVirtualSyncFS();
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
 * Creates an isolated in-memory scratch sandbox directory for sync testing.
 * Automatically provisions virtual directory inside VirtualMemoryFS.
 */
export function scratchRoot(callerPath = "sync-test", label = "test"): string {
  if (!session) {
    setupVirtualSyncFS();
  }
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const raw = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
  const dirName = raw.slice(0, 50).replace(/-+$/, "");
  const root = join(SCRATCH_BASE, dirName);

  vfs.mkdirSync(root, { recursive: true });
  return root;
}

export function createSandboxDir(label = "sandbox"): string {
  return scratchRoot("sandbox", label);
}
