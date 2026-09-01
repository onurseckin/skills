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

const activeRoots: string[] = [];
let activeSession: VirtualFSSession | null = null;

export function getRunnerVfs(): VirtualMemoryFS {
  if (!activeSession) {
    activeSession = createVirtualFSSession(new VirtualMemoryFS());
    spyOn(os, "tmpdir").mockReturnValue("/virtual/tmp");
  }
  return activeSession.vfs;
}

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
