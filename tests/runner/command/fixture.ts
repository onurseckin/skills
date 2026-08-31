/**
 * Runner Virtual Test Fixtures.
 * Provides in-memory virtual directory management, clean temp directories,
 * and deterministic teardown for runner tests.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const activeRoots: string[] = [];

/**
 * Creates a unique clean temp root for runner unit testing.
 * Automatically tracked for cleanup in afterAll / afterEach hooks.
 */
export function tempRoot(prefix = "runner"): string {
  const dir = mkdtempSync(join(tmpdir(), `skills-runner-${prefix}-`));
  activeRoots.push(dir);
  return dir;
}

/**
 * Creates a tree of files inside a base directory in-memory/temp.
 */
export function writeTree(base: string, files: Record<string, string>): string {
  for (const [rel, content] of Object.entries(files)) {
    const target = join(base, rel);
    const parent = join(target, "..");
    mkdirSync(parent, { recursive: true });
    writeFileSync(target, content, "utf8");
  }
  return base;
}

/**
 * Deterministically removes all active temporary roots.
 */
export function cleanupTempRoots(): void {
  while (activeRoots.length > 0) {
    const root = activeRoots.pop();
    if (root) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // Ignore teardown errors
      }
    }
  }
}
