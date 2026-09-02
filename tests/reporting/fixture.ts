/**
 * @file fixture.ts
 * In-memory virtual test sandbox fixture for tests/reporting domain.
 * 100% zero physical disk writes, backed by VirtualMemoryFS and createVirtualFSSession.
 */

import { afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";

import {
  disableInMemorySessionStore,
  enableInMemorySessionStore,
} from "../../olt/scripts/src/authority/session/paths.ts";

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | null = null;
let counter = 0;

export const SCRATCH_BASE = "/virtual/reporting-scratch";

function normPath(p: string): string {
  return p.replace(/\\/g, "/");
}

export function setupVirtualReportingFS(): VirtualMemoryFS {
  enableInMemorySessionStore();
  if (session) {
    session.cleanup();
    session = null;
  }
  vfs = new VirtualMemoryFS();
  const repoRoot = normPath(process.cwd());
  vfs.mkdirSync(repoRoot, { recursive: true });
  vfs.mkdirSync(join(repoRoot, ".git"), { recursive: true });
  vfs.mkdirSync(join(repoRoot, ".olt"), { recursive: true });
  vfs.mkdirSync(join(repoRoot, ".olt", "capsules"), { recursive: true });
  vfs.mkdirSync(join(repoRoot, ".olt", "scratch"), { recursive: true });
  vfs.mkdirSync(join(repoRoot, ".olt", "runs"), { recursive: true });
  vfs.mkdirSync(join(repoRoot, ".tmp"), { recursive: true });
  vfs.writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "@onurseckin/skills" }));
  vfs.mkdirSync(SCRATCH_BASE, { recursive: true });
  vfs.chdir(repoRoot);
  session = createVirtualFSSession(vfs);
  return vfs;
}

export function cleanupVirtualReportingFS(): void {
  disableInMemorySessionStore();
  if (session) {
    session.cleanup();
    session = null;
  }
  vfs = new VirtualMemoryFS();
}

export function getVirtualReportingFS(): VirtualMemoryFS {
  return vfs;
}

afterEach(() => {
  cleanupVirtualReportingFS();
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
 * Creates an isolated in-memory scratch sandbox directory for reporting testing.
 * Automatically provisions virtual directory inside VirtualMemoryFS.
 */
export function scratchRoot(callerPath = "reporting-test", label = "test"): string {
  if (!session) {
    setupVirtualReportingFS();
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

export function createReportingSandbox(label = "sandbox"): string {
  return scratchRoot("reporting", label);
}

export function tempDir(label = "test"): string {
  return scratchRoot("reporting", label);
}
