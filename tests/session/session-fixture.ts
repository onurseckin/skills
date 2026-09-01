/**
 * @file session-fixture.ts
 * In-memory test sandbox fixture and pure RAM session generator harness for tests/session domain
 */

import { afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedSessionAuth } from "../../olt/scripts/src/capture/runners/types.ts";

const SCRATCH_BASE = join(tmpdir(), "session-scratch");
const rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  rootsToClean.length = 0;
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

let counter = 0;

/**
 * Creates an isolated scratch sandbox directory for testing session and browser runners.
 * Automatically registered for cleanup in afterEach hooks.
 */
export function scratchRoot(callerPath = "session-test", label = "test"): string {
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const raw = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
  const dirName = raw.slice(0, 50).replace(/-+$/, "");
  const root = join(SCRATCH_BASE, dirName);

  try {
    rmSync(root, { recursive: true, force: true });
  } catch {}

  mkdirSync(root, { recursive: true });
  rootsToClean.push(root);
  return root;
}

export function createSandboxDir(label = "sandbox"): string {
  return scratchRoot("sandbox", label);
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
