/**
 * @file architecture-fixture.ts
 * In-memory virtual test sandbox fixture for tests/architecture domain.
 * Zero physical disk writes, backed by VirtualMemoryFS and createVirtualFSSession.
 */

import { afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | null = null;
let counter = 0;

export const SCRATCH_BASE = "/virtual/arch-scratch";

export function setupVirtualArchitectureFS(): VirtualMemoryFS {
  cleanupVirtualArchitectureFS();
  vfs = new VirtualMemoryFS();
  session = createVirtualFSSession(vfs);
  return vfs;
}

export function cleanupVirtualArchitectureFS(): void {
  if (session) {
    session.cleanup();
    session = null;
  }
}

export function getVirtualArchitectureFS(): VirtualMemoryFS {
  return vfs;
}

afterEach(() => {
  cleanupVirtualArchitectureFS();
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
 * Creates an isolated in-memory scratch sandbox directory for architecture testing.
 * Automatically provisions virtual directory inside VirtualMemoryFS.
 */
export function scratchRoot(callerPath = "arch-test", label = "test"): string {
  if (!session) {
    setupVirtualArchitectureFS();
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
