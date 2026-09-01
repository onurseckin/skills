/**
 * @file fixture.ts
 * In-memory virtual test sandbox fixture and harness for tests/agents domain.
 * 100% zero disk writes, backed by VirtualMemoryFS and virtual descriptor session.
 */

import { afterEach } from "bun:test";
import { createHash } from "node:crypto";
import * as path from "node:path";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";

import {
  disableInMemorySessionStore,
  enableInMemorySessionStore,
} from "../../olt/scripts/src/authority/session/paths.ts";

let currentSession: VirtualFSSession | null = null;
let currentVfs: VirtualMemoryFS = new VirtualMemoryFS();
let counter = 0;

function normPath(p: string): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

export function setupVirtualAgentsFS(): VirtualMemoryFS {
  enableInMemorySessionStore();
  if (!currentSession) {
    currentVfs = new VirtualMemoryFS();
    const repoRoot = normPath(process.cwd());
    currentVfs.mkdirSync(repoRoot, { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".olt"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".olt", "capsules"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".olt", "scratch"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".olt", "runs"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".tmp"), { recursive: true });
    currentVfs.mkdirSync("/virtual/agents-scratch", { recursive: true });
    currentVfs.mkdirSync("/virtual/.git", { recursive: true });
    currentVfs.mkdirSync("/virtual/.olt", { recursive: true });
    currentSession = createVirtualFSSession(currentVfs);
  }
  return currentVfs;
}

export function cleanupVirtualAgentsFS(): void {
  disableInMemorySessionStore();
  if (currentSession) {
    currentSession.cleanup();
    currentSession = null;
  }
  currentVfs = new VirtualMemoryFS();
}

afterEach(() => {
  cleanupVirtualAgentsFS();
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
 * Creates an in-memory virtual scratch sandbox directory for agents tests.
 * Zero physical disk writes occur.
 */
export function scratchRoot(callerPath = "agents-test", label = "test"): string {
  const vfs = setupVirtualAgentsFS();
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const dirName = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  const root = `/virtual/agents-scratch/${dirName}`;
  vfs.mkdirSync(root, { recursive: true });
  vfs.mkdirSync(path.join(root, ".git"), { recursive: true });
  vfs.mkdirSync(path.join(root, ".olt"), { recursive: true });
  return root;
}

export function getVirtualAgentsFS(): VirtualMemoryFS {
  return currentVfs;
}
