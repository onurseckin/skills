/**
 * @file fixture.ts
 * In-memory virtual test sandbox fixture and harness for tests/agents domain.
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

import {
  disableInMemorySessionStore,
  enableInMemorySessionStore,
} from "../../olt/scripts/src/authority/session/paths.ts";

let currentSession: VirtualFSSession | null = null;
let currentVfs: VirtualMemoryFS = new VirtualMemoryFS();
let counter = 0;

function normPath(p: string): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

let cachedFiles: Array<{ path: string; content: string }> | null = null;

function getCachedFiles(): Array<{ path: string; content: string }> {
  if (!cachedFiles) {
    cachedFiles = [];
    const repoRoot = normPath(process.cwd());
    const realAgentsDir = path.join(repoRoot, "olt", "agents");
    try {
      const realFs = require("node:fs");
      if (realFs.existsSync(realAgentsDir)) {
        for (const file of realFs.readdirSync(realAgentsDir)) {
          if (file.endsWith(".yaml") || file.endsWith(".yml")) {
            const fullPath = path.join(realAgentsDir, file);
            const content = realFs.readFileSync(fullPath, "utf8");
            cachedFiles.push({ path: fullPath, content });
            cachedFiles.push({ path: path.join(repoRoot, "agents", file), content });
            cachedFiles.push({ path: path.join(repoRoot, ".olt", "agents", file), content });
          }
        }
      }
      const threadIndex = path.join(repoRoot, "olt/scripts/src/authority/thread/index.ts");
      if (realFs.existsSync(threadIndex)) {
        cachedFiles.push({ path: threadIndex, content: realFs.readFileSync(threadIndex, "utf8") });
      }
      const threadNaming = path.join(repoRoot, "olt/scripts/src/authority/thread/naming.ts");
      if (realFs.existsSync(threadNaming)) {
        cachedFiles.push({
          path: threadNaming,
          content: realFs.readFileSync(threadNaming, "utf8"),
        });
      }
      const hierarchyTest = path.join(
        repoRoot,
        "tests/agents/identity/agent-naming-hierarchy.test.ts",
      );
      if (realFs.existsSync(hierarchyTest)) {
        cachedFiles.push({
          path: hierarchyTest,
          content: realFs.readFileSync(hierarchyTest, "utf8"),
        });
      }
    } catch {}
  }
  return cachedFiles;
}

export function seedAgentManifests(vfs: VirtualMemoryFS = currentVfs): void {
  const files = getCachedFiles();
  for (const item of files) {
    vfs.mkdirSync(path.dirname(item.path), { recursive: true });
    vfs.writeFileSync(item.path, item.content);
  }
}

export const SCRATCH_BASE = "/virtual/agents-scratch";

export function setupVirtualAgentsFS(): VirtualMemoryFS {
  enableInMemorySessionStore();
  if (currentSession) {
    currentSession.cleanup();
    currentSession = null;
  }
  currentVfs = new VirtualMemoryFS();
  const repoRoot = normPath(process.cwd());
  currentVfs.mkdirSync(repoRoot, { recursive: true });
  currentVfs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  currentVfs.mkdirSync(path.join(repoRoot, ".olt"), { recursive: true });
  currentVfs.mkdirSync(path.join(repoRoot, ".olt", "capsules"), { recursive: true });
  currentVfs.mkdirSync(path.join(repoRoot, ".olt", "scratch"), { recursive: true });
  currentVfs.mkdirSync(path.join(repoRoot, ".olt", "runs"), { recursive: true });
  currentVfs.mkdirSync(path.join(repoRoot, ".tmp"), { recursive: true });
  currentVfs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({ name: "@onurseckin/skills" }),
  );
  currentVfs.mkdirSync(SCRATCH_BASE, { recursive: true });
  currentVfs.mkdirSync("/virtual/.git", { recursive: true });
  currentVfs.mkdirSync("/virtual/.olt", { recursive: true });
  currentVfs.chdir(repoRoot);
  currentSession = createVirtualFSSession(currentVfs);
  return currentVfs;
}

export function cleanupVirtualAgentsFS(): void {
  disableInMemorySessionStore();
  if (currentSession) {
    currentSession.cleanup();
    currentSession = null;
  }
  currentVfs = new VirtualMemoryFS();
}

afterEach(() => {
  cleanupVirtualAgentsFS();
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
 * Creates an in-memory virtual scratch sandbox directory for agents tests.
 * Zero physical disk writes occur.
 */
export function scratchRoot(callerPath = "agents-test", label = "test"): string {
  const vfs = setupVirtualAgentsFS();
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const dirName = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  const root = path.join(SCRATCH_BASE, dirName);
  vfs.mkdirSync(root, { recursive: true });
  vfs.mkdirSync(path.join(root, ".git"), { recursive: true });
  vfs.mkdirSync(path.join(root, ".olt"), { recursive: true });
  return root;
}

export function getVirtualAgentsFS(): VirtualMemoryFS {
  return currentVfs;
}
