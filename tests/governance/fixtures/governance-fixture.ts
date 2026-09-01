/**
 * @file governance-fixture.ts
 * In-memory virtual test sandbox fixture for tests/governance domain.
 * 100% zero disk writes, backed by VirtualMemoryFS and virtual descriptor session.
 */

import { afterEach } from "bun:test";
import { createHash } from "node:crypto";
import * as path from "node:path";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

let currentSession: VirtualFSSession | null = null;
let currentVfs: VirtualMemoryFS = new VirtualMemoryFS();
let counter = 0;

function normPath(p: string): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

export function setupVirtualGovernanceFS(): VirtualMemoryFS {
  if (!currentSession) {
    currentVfs = new VirtualMemoryFS();
    const repoRoot = normPath(process.cwd());
    currentVfs.mkdirSync(repoRoot, { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".olt", "capsules"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".olt", "scratch"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".olt", "runs"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".tmp"), { recursive: true });
    currentVfs.mkdirSync("/virtual/governance-scratch", { recursive: true });
    currentSession = createVirtualFSSession(currentVfs);
  }
  return currentVfs;
}

export function cleanupVirtualGovernanceFS(): void {
  if (currentSession) {
    currentSession.cleanup();
    currentSession = null;
  }
  currentVfs = new VirtualMemoryFS();
}

afterEach(() => {
  cleanupVirtualGovernanceFS();
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

export function scratchRoot(callerPath = "gov-test", label = "test"): string {
  const vfs = setupVirtualGovernanceFS();
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const raw = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
  const dirName = raw.slice(0, 50).replace(/-+$/, "");
  const root = `/virtual/governance-scratch/${dirName}`;
  vfs.mkdirSync(root, { recursive: true });
  return root;
}

export function createSandboxDir(label = "sandbox"): string {
  return scratchRoot("sandbox", label);
}

export function getVirtualGovernanceFS(): VirtualMemoryFS {
  return currentVfs;
}
