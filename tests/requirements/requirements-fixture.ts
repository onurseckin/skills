/**
 * @file requirements-fixture.ts
 * In-memory test sandbox fixture and harness for tests/requirements domain.
 * Provides 100% in-memory virtual filesystem mocking with zero disk writes.
 */

import { createHash } from "node:crypto";
import * as path from "node:path";
import { VirtualMemoryFS } from "../../olt/scripts/src/testing/virtual-fs/index.ts";
import { createRequirementsFsSpies, type VirtualRequirementsState } from "./session/index.ts";

const VIRTUAL_SCRATCH_BASE = "/virtual/requirements-scratch";

const vfs = new VirtualMemoryFS();
const state: VirtualRequirementsState = {
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

export function resetVirtualRequirementsStore(): void {
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

export function setupVirtualRequirementsFS(): VirtualMemoryFS {
  cleanupVirtualRequirementsFS();
  activeSpies = createRequirementsFsSpies(state);
  resetVirtualRequirementsStore();
  return vfs;
}

export function cleanupVirtualRequirementsFS(): void {
  for (const s of activeSpies) {
    try {
      s.mockRestore();
    } catch {}
  }
  activeSpies = [];
  resetVirtualRequirementsStore();
}

export function getVirtualRequirementsFS(): VirtualMemoryFS {
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
 * Creates an isolated in-memory scratch sandbox directory for testing requirements.
 * 100% RAM resident with zero disk writes.
 */
export function scratchRoot(callerPath = "requirements-test", label = "test"): string {
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
