/**
 * @file session-fixture.ts
 * In-memory virtual test sandbox fixture and pure RAM session generator harness for tests/session domain.
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
import type { ResolvedSessionAuth } from "../../olt/scripts/src/capture/runners/types.ts";

let currentSession: VirtualFSSession | null = null;
let currentVfs: VirtualMemoryFS = new VirtualMemoryFS();
let counter = 0;

function normPath(p: string): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

export function setupVirtualSessionFS(): VirtualMemoryFS {
  if (!currentSession) {
    currentVfs = new VirtualMemoryFS();
    const repoRoot = normPath(process.cwd());
    currentVfs.mkdirSync(repoRoot, { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
    currentVfs.writeFileSync(path.join(repoRoot, "package.json"), "{}");
    currentVfs.mkdirSync(path.join(repoRoot, ".olt", "sessions"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".olt", "scratch"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".tmp"), { recursive: true });
    currentVfs.mkdirSync("/virtual/session-scratch", { recursive: true });
    currentVfs.chdir(repoRoot);
    currentSession = createVirtualFSSession(currentVfs);
  }
  return currentVfs;
}

export function cleanupVirtualSessionFS(): void {
  if (currentSession) {
    currentSession.cleanup();
    currentSession = null;
  }
  currentVfs = new VirtualMemoryFS();
}

afterEach(() => {
  cleanupVirtualSessionFS();
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
 * Creates an in-memory virtual scratch sandbox directory for testing session and browser runners.
 * Zero physical disk writes occur.
 */
export function scratchRoot(callerPath = "session-test", label = "test"): string {
  const vfs = setupVirtualSessionFS();
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const raw = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
  const dirName = raw.slice(0, 50).replace(/-+$/, "");
  const root = `/virtual/session-scratch/${dirName}`;
  vfs.mkdirSync(root, { recursive: true });
  return root;
}

export function createSandboxDir(label = "sandbox"): string {
  return scratchRoot("sandbox", label);
}

export function getVirtualSessionFS(): VirtualMemoryFS {
  return currentVfs;
}

export function createInMemorySessionAuth(
  overrides: Partial<ResolvedSessionAuth> = {},
): ResolvedSessionAuth {
  return {
    userId: "in-memory-user-01",
    role: "implementer",
    name: "In-Memory Implementer",
    headers: {
      Authorization: "Bearer in-memory-auth-token-01",
    },
    cookies: [{ name: "session_token", value: "in-memory-cookie-01", path: "/" }],
    resolvedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function createInMemorySessionToken(prefix = "sess"): string {
  return `${prefix}-${createHash("sha256").update(String(++counter)).digest("hex").slice(0, 32)}`;
}

export function createInMemorySessionContext(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sessionId: "sess-in-memory-01",
    agentId: "agent-in-memory-01",
    role: "implementer",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
