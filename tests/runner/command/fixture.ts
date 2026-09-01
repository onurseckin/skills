/**
 * @file fixture.ts
 * Runner Virtual Test Fixtures.
 * Provides in-memory virtual directory management, clean temp directories,
 * and deterministic teardown for runner tests.
 */

import { spyOn } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import {
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";

import * as darwinPipes from "../../../olt/scripts/src/engine/runner/process/darwin/darwin-pipes.ts";
import * as pipeOwnership from "../../../olt/scripts/src/engine/runner/core/pipe-ownership.ts";

import * as processTree from "../../../olt/scripts/src/engine/runner/process/process-tree.ts";

import * as processIdentity from "../../../olt/scripts/src/engine/runner/process/process-identity.ts";

import * as attemptIntent from "../../../olt/scripts/src/engine/runner/execution/attempt-intent.ts";
import * as attemptIntentValidation from "../../../olt/scripts/src/engine/runner/execution/attempt-intent-validation.ts";

const activeRoots: string[] = [];
let activeSession: VirtualFSSession | null = null;

export function getRunnerVfs(): VirtualMemoryFS {
  if (!activeSession) {
    activeSession = createVirtualFSSession(new VirtualMemoryFS());
    spyOn(os, "tmpdir").mockReturnValue("/virtual/tmp");
    const activePids = new Set<number>([999999]);
    const origKill = process.kill;
    try {
      spyOn(process, "kill").mockImplementation(((pid: number, signal?: string | number) => {
        const absPid = Math.abs(pid);
        if (activePids.has(absPid)) {
          activePids.delete(absPid);
          const handlers = (globalThis as unknown as Record<string, unknown>)
            .__virtualFsKillHandlers as Map<number, () => void> | undefined;
          handlers?.get(absPid)?.();
          return true;
        }
        return origKill.call(process, pid, signal as never);
      }) as never);
      const origProcessSnapshot = processTree.processSnapshot;
      spyOn(processTree, "processSnapshot").mockImplementation(async (spawnSnapshot) => {
        if (spawnSnapshot) {
          return origProcessSnapshot(spawnSnapshot);
        }
        const snap = new Map([[process.pid, { pid: process.pid, parent: 1, group: process.pid }]]);
        if (activePids.has(999999)) {
          snap.set(999999, { pid: 999999, parent: process.pid, group: 999999 });
        }
        return snap;
      });
      const origReadProcessIdentity = processIdentity.readProcessIdentity;
      spyOn(processIdentity, "readProcessIdentity").mockImplementation(
        (pid: number, platform?: string) => {
          if (platform && platform !== process.platform) {
            return origReadProcessIdentity(pid, platform);
          }
          if (pid === 999999 && activePids.has(999999)) {
            return { pid: 999999, parent: process.pid, group: 999999, birth: "virtual-birth" };
          }
          if (pid === process.pid) {
            return origReadProcessIdentity(pid, platform);
          }
          return undefined;
        },
      );
      const origDarwinProcessIdentity = darwinPipes.darwinProcessIdentity;
      spyOn(darwinPipes, "darwinProcessIdentity").mockImplementation((pid: number) => {
        if (pid === 999999 && activePids.has(999999)) {
          return { pid: 999999, parent: process.pid, group: 999999, birth: "virtual-birth" };
        }
        if (pid === process.pid) {
          try {
            return origDarwinProcessIdentity(pid);
          } catch {
            return { pid: process.pid, parent: 1, group: process.pid, birth: "virtual-self-birth" };
          }
        }
        return undefined;
      });
      spyOn(attemptIntentValidation, "probeAttemptProcess").mockImplementation((expected) => {
        return activePids.has(expected.pid) ? "live" : "absent";
      });
      spyOn(attemptIntent, "probeAttemptProcess").mockImplementation((expected) => {
        return activePids.has(expected.pid) ? "live" : "absent";
      });
      spyOn(darwinPipes, "darwinTokenOwnerIdentities").mockImplementation(() => []);
      spyOn(darwinPipes, "darwinPipeOwners").mockImplementation(() => new Set());
      spyOn(darwinPipes, "darwinPipeHandles").mockImplementation(() => new Set());
      spyOn(pipeOwnership, "ownershipTokenIdentities").mockImplementation(() => []);
      spyOn(pipeOwnership, "ownedProcessPids").mockImplementation(() => new Set());
      spyOn(pipeOwnership, "runnerPipeHandles").mockImplementation(() => new Set());
      spyOn(pipeOwnership, "addedPipeHandles").mockImplementation(() => new Set());
    } catch {
      // ignore if on non-darwin
    }
  }
  return activeSession.vfs;
}

export const setupVirtualRunnerFS = getRunnerVfs;
export const cleanupVirtualRunnerFS = cleanupTempRoots;

/**
 * Creates a unique clean virtual temp root for runner unit testing.
 * Automatically tracked for cleanup in afterAll / afterEach hooks.
 */
export function tempRoot(prefix = "runner"): string {
  const vfs = getRunnerVfs();
  const dir = `/virtual/skills-runner-${prefix}-${crypto.randomUUID()}`;
  vfs.mkdirSync(dir, { recursive: true });
  activeRoots.push(dir);
  return dir;
}

/**
 * Creates a tree of files inside a base directory in-memory virtual filesystem.
 */
export function writeTree(base: string, files: Record<string, string>): string {
  const vfs = getRunnerVfs();
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(base, rel);
    const parent = path.dirname(target);
    vfs.mkdirSync(parent, { recursive: true });
    vfs.writeFileSync(target, content);
  }
  return base;
}

/**
 * Deterministically removes all active temporary roots and resets virtual memory.
 */
export function cleanupTempRoots(): void {
  const vfs = getRunnerVfs();
  while (activeRoots.length > 0) {
    const root = activeRoots.pop();
    if (root) {
      try {
        vfs.rmSync(root, { recursive: true, force: true });
      } catch {
        // Ignore teardown errors
      }
    }
  }
}

// Auto-initialize runner virtual filesystem on module import
getRunnerVfs();
