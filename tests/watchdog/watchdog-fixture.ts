/**
 * @file watchdog-fixture.ts
 * In-memory test sandbox fixture and harness for tests/watchdog domain.
 * Provides 100% in-memory virtual filesystem mocking with zero disk writes.
 */

import { createHash } from "node:crypto";
import * as path from "node:path";
import { VirtualMemoryFS } from "../../olt/scripts/src/testing/virtual-fs/index.ts";
import { createWatchdogFsSpies, type VirtualWatchdogState } from "./session/index.ts";

const VIRTUAL_SCRATCH_BASE = "/virtual/watchdog-scratch";

const vfs = new VirtualMemoryFS();
const state: VirtualWatchdogState = {
  vfs,
  openDescriptors: new Map(),
  customModes: new Map(),
  customMtimes: new Map(),
  inodeMap: new Map(),
  symlinks: new Map(),
  hardlinks: new Map(),
  nextFd: 1000,
  nextInode: 50000,
};

export function resetVirtualWatchdogStore(): void {
  state.openDescriptors.clear();
  state.customModes.clear();
  state.customMtimes.clear();
  state.inodeMap.clear();
  state.symlinks.clear();
  state.hardlinks.clear();
  state.nextFd = 1000;
  state.nextInode = 50000;
  vfs.reset();
  vfs.mkdirSync(VIRTUAL_SCRATCH_BASE, { recursive: true });
}

let activeSpies: Array<{ mockRestore: () => void }> = [];

export function setupVirtualWatchdogFS(): VirtualMemoryFS {
  cleanupVirtualWatchdogFS();
  activeSpies = createWatchdogFsSpies(state);
  resetVirtualWatchdogStore();
  return vfs;
}

export function cleanupVirtualWatchdogFS(): void {
  for (const s of activeSpies) {
    try {
      s.mockRestore();
    } catch {}
  }
  activeSpies = [];
  resetVirtualWatchdogStore();
}

export function getVirtualWatchdogFS(): VirtualMemoryFS {
  return vfs;
}

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
 * Creates an isolated in-memory scratch sandbox directory for testing watchdogs.
 * 100% RAM resident with zero disk writes.
 */
export function scratchRoot(callerPath = "watchdog-test", label = "test"): string {
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

export function createSandboxDir(label = "sandbox"): string {
  return scratchRoot("sandbox", label);
}
