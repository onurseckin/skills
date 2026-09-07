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
const runnerSpies: Array<{ mockRestore: () => void }> = [];

export function getRunnerVfs(): VirtualMemoryFS {
  if (!activeSession) {
    activeSession = createVirtualFSSession(new VirtualMemoryFS());
    runnerSpies.push(spyOn(os, "tmpdir").mockReturnValue("/virtual/tmp"));
    const activePids = new Set<number>([999999]);
    const origKill = process.kill;
    try {
      runnerSpies.push(
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
        }) as never),
      );
      const origProcessSnapshot = processTree.processSnapshot;
      runnerSpies.push(
        spyOn(processTree, "processSnapshot").mockImplementation(async (spawnSnapshot) => {
          if (spawnSnapshot) {
            return origProcessSnapshot(spawnSnapshot);
          }
          const snap = new Map([
            [process.pid, { pid: process.pid, parent: 1, group: process.pid }],
          ]);
          if (activePids.has(999999)) {
            snap.set(999999, { pid: 999999, parent: process.pid, group: 999999 });
          }
          return snap;
        }),
      );
      const origReadProcessIdentity = processIdentity.readProcessIdentity;
      runnerSpies.push(
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
        ),
      );
      const origDarwinProcessIdentity = darwinPipes.darwinProcessIdentity;
      runnerSpies.push(
        spyOn(darwinPipes, "darwinProcessIdentity").mockImplementation((pid: number) => {
          if (pid === 999999 && activePids.has(999999)) {
            return { pid: 999999, parent: process.pid, group: 999999, birth: "virtual-birth" };
          }
          if (pid === process.pid) {
            try {
              return origDarwinProcessIdentity(pid);
            } catch {
              return {
                pid: process.pid,
                parent: 1,
                group: process.pid,
                birth: "virtual-self-birth",
              };
            }
          }
          return undefined;
        }),
      );
      runnerSpies.push(
        spyOn(attemptIntentValidation, "probeAttemptProcess").mockImplementation((expected) => {
          return activePids.has(expected.pid) ? "live" : "absent";
        }),
      );
      runnerSpies.push(
        spyOn(attemptIntent, "probeAttemptProcess").mockImplementation((expected) => {
          return activePids.has(expected.pid) ? "live" : "absent";
        }),
      );
      runnerSpies.push(
        spyOn(darwinPipes, "darwinTokenOwnerIdentities").mockImplementation(() => []),
      );
      runnerSpies.push(spyOn(darwinPipes, "darwinPipeOwners").mockImplementation(() => new Set()));
      runnerSpies.push(spyOn(darwinPipes, "darwinPipeHandles").mockImplementation(() => new Set()));
      runnerSpies.push(
        spyOn(pipeOwnership, "ownershipTokenIdentities").mockImplementation(() => []),
      );
      runnerSpies.push(
        spyOn(pipeOwnership, "ownedProcessPids").mockImplementation(() => new Set()),
      );
      runnerSpies.push(
        spyOn(pipeOwnership, "runnerPipeHandles").mockImplementation(() => new Set()),
      );
      runnerSpies.push(
        spyOn(pipeOwnership, "addedPipeHandles").mockImplementation(() => new Set()),
      );
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
 * Creates an in-memory virtual symlink in the active runner virtual session.
 */
export function createVirtualSymlink(target: string, linkPath: string): void {
  getRunnerVfs();
  if (activeSession) {
    activeSession.symlinkSync(target, linkPath);
  }
}

/**
 * Removes an in-memory virtual symlink in the active runner virtual session.
 */
export function removeVirtualSymlink(linkPath: string): void {
  const vfs = getRunnerVfs();
  if (activeSession) {
    activeSession.symlinks.delete(linkPath.replace(/\\/g, "/"));
  }
  try {
    vfs.rmSync(linkPath, { force: true });
  } catch {}
}

/**
 * Opens an in-memory virtual file descriptor in the active runner virtual session.
 */
export function openVirtualFile(filePath: string, flags?: number | string): number {
  getRunnerVfs();
  if (!activeSession) {
    throw new Error("No active virtual session");
  }
  return activeSession.openSync(filePath, (flags ?? "r") as string | number);
}

/**
 * Gets virtual stats with full dev/ino/mode properties from the active runner session.
 */
export function statVirtualFile(filePath: string): import("node:fs").Stats {
  getRunnerVfs();
  if (!activeSession) {
    throw new Error("No active virtual session");
  }
  return activeSession.statSync(filePath) as import("node:fs").Stats;
}

/**
 * Changes mode permissions for a file or directory in the active runner virtual session.
 */
export function chmodVirtualFile(filePath: string, mode: number): void {
  getRunnerVfs();
  if (activeSession) {
    activeSession.chmodSync(filePath, mode);
  }
}

/**
 * Closes an in-memory virtual file descriptor in the active runner virtual session.
 */
export function closeVirtualFile(fd: number): void {
  getRunnerVfs();
  if (!activeSession) {
    throw new Error("No active virtual session");
  }
  activeSession.closeSync(fd);
}

/**
 * Reads from an in-memory virtual file descriptor in the active runner virtual session.
 */
export function readVirtualFile(
  fd: number,
  buffer: NodeJS.ArrayBufferView,
  offset: number,
  length: number,
  position?: number | bigint | null,
): number {
  getRunnerVfs();
  if (!activeSession) {
    throw new Error("No active virtual session");
  }
  return activeSession.readSync(fd, buffer, offset, length, position);
}

/**
 * Resolves the canonical realpath of an in-memory virtual path.
 */
export function realpathVirtual(filePath: string): string {
  getRunnerVfs();
  if (!activeSession) {
    throw new Error("No active virtual session");
  }
  return activeSession.realpathSync(filePath);
}

export const closeSync = closeVirtualFile;
export const readSync = readVirtualFile;
export const realpathSync = realpathVirtual;

export interface StatsLike {
  dev?: number;
  ino?: number;
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink?: () => boolean;
}

/**
 * Deterministically removes all active temporary roots and resets virtual memory.
 */
export function cleanupTempRoots(): void {
  while (activeRoots.length > 0) {
    const root = activeRoots.pop();
    if (root && activeSession) {
      try {
        activeSession.vfs.rmSync(root, { recursive: true, force: true });
      } catch {
        // Ignore teardown errors
      }
    }
  }
  while (runnerSpies.length > 0) {
    try {
      runnerSpies.pop()?.mockRestore();
    } catch {
      // Ignore restore errors
    }
  }
  if (activeSession) {
    activeSession.cleanup();
    activeSession = null;
  }
}
