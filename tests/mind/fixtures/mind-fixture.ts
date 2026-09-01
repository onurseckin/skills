/**
 * @file mind-fixture.ts
 * In-memory test sandbox fixture and harness for tests/mind domain.
 * Provides 100% in-memory virtual filesystem mocking with zero disk writes.
 */

import { createHash } from "node:crypto";
import * as path from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  enableInMemorySessionStore,
  disableInMemorySessionStore,
} from "../../../olt/scripts/src/authority/session/paths.ts";
import {
  enableInMemoryAgentMetadata,
  disableInMemoryAgentMetadata,
} from "../../../olt/scripts/src/runtime/session.ts";

const VIRTUAL_SCRATCH_BASE = "/virtual/mind-scratch";

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | undefined;

export function resetVirtualMindStore(): void {
  if (session) {
    session.cleanup();
    session = undefined;
  }
  vfs.reset();
  vfs.mkdirSync(VIRTUAL_SCRATCH_BASE, { recursive: true });
}

export function setupVirtualMindFS(): VirtualMemoryFS {
  cleanupVirtualMindFS();
  enableInMemorySessionStore();
  enableInMemoryAgentMetadata();
  vfs = new VirtualMemoryFS();
  vfs.mkdirSync(VIRTUAL_SCRATCH_BASE, { recursive: true });
  const cwd = process.cwd();
  vfs.mkdirSync(cwd, { recursive: true });
  vfs.mkdirSync(path.join(cwd, ".olt"), { recursive: true });
  vfs.mkdirSync(path.join(cwd, ".olt", "capsules"), { recursive: true });
  vfs.mkdirSync(path.join(cwd, "olt", "agents"), { recursive: true });
  vfs.chdir(cwd);
  session = createVirtualFSSession(vfs);
  return vfs;
}

export function cleanupVirtualMindFS(): void {
  disableInMemorySessionStore();
  disableInMemoryAgentMetadata();
  if (session) {
    session.cleanup();
    session = undefined;
  }
  vfs.reset();
}

export function getVirtualMindFS(): VirtualMemoryFS {
  return vfs;
}

function slug(value: string): string {
  const cleaned = value
    .replace(/\.+/g, "-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const trimmed = cleaned.slice(0, 30).replace(/-+$/, "");
  return trimmed.length > 0 ? trimmed : "root";
}

function shortDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

let counter = 0;

export function scratchRoot(callerPath = "mind-test", label = "test"): string {
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const raw = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
  const dirName = raw.slice(0, 50).replace(/-+$/, "");
  const root = path.join(VIRTUAL_SCRATCH_BASE, dirName);

  vfs.mkdirSync(root, { recursive: true });
  return root;
}
