/**
 * @file fixture.ts
 * In-memory virtual test sandbox fixture and harness for tests/roles domain.
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
  origExists,
  origRead,
  origReaddir,
  origStat,
} from "../../olt/scripts/src/testing/virtual-fs/handlers.ts";

let currentSession: VirtualFSSession | null = null;
let currentVfs: VirtualMemoryFS = new VirtualMemoryFS();
let counter = 0;

function normPath(p: string): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

export function setupVirtualRolesFS(): VirtualMemoryFS {
  if (!currentSession) {
    currentVfs = new VirtualMemoryFS();
    const repoRoot = normPath(process.cwd());
    currentVfs.mkdirSync(repoRoot, { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".olt"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".olt", "capsules"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".olt", "scratch"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".olt", "runs"), { recursive: true });
    currentVfs.mkdirSync(path.join(repoRoot, ".tmp"), { recursive: true });
    currentVfs.mkdirSync("/virtual/roles-scratch", { recursive: true });

    const agentsDir = path.join(repoRoot, "olt", "agents");
    if (origExists(agentsDir)) {
      currentVfs.mkdirSync(agentsDir, { recursive: true });
      for (const f of origReaddir(agentsDir)) {
        const fullPath = path.join(agentsDir, f);
        try {
          if (origStat(fullPath).isFile()) {
            currentVfs.writeFileSync(fullPath, origRead(fullPath, "utf8"));
          }
        } catch {}
      }
    }

    const rolesDir = path.join(repoRoot, "olt", "scripts", "src", "packets", "roles");
    if (origExists(rolesDir)) {
      currentVfs.mkdirSync(rolesDir, { recursive: true });
      for (const f of origReaddir(rolesDir)) {
        const fullPath = path.join(rolesDir, f);
        try {
          if (origStat(fullPath).isFile()) {
            currentVfs.writeFileSync(fullPath, origRead(fullPath, "utf8"));
          }
        } catch {}
      }
    }

    const checklistsDir = path.join(repoRoot, "olt", "checklists");
    if (origExists(checklistsDir)) {
      currentVfs.mkdirSync(checklistsDir, { recursive: true });
      for (const f of origReaddir(checklistsDir)) {
        const fullPath = path.join(checklistsDir, f);
        try {
          if (origStat(fullPath).isFile()) {
            currentVfs.writeFileSync(fullPath, origRead(fullPath, "utf8"));
          }
        } catch {}
      }
    }

    const docFiles = [
      path.join(repoRoot, "AGENTS.md"),
      path.join(repoRoot, "olt", "SKILL.md"),
      path.join(repoRoot, "olt/scripts/src/cli/commands/smart-task-ops.ts"),
      path.join(repoRoot, "olt/scripts/src/graph/parallel-decoupler.ts"),
      path.join(repoRoot, "olt/scripts/src/graph/topology.ts"),
      path.join(repoRoot, "olt/scripts/src/packets/role-contract.ts"),
      path.join(repoRoot, "olt/scripts/src/cli/commands/task-check.ts"),
    ];
    for (const doc of docFiles) {
      if (origExists(doc)) {
        currentVfs.mkdirSync(path.dirname(doc), { recursive: true });
        currentVfs.writeFileSync(doc, origRead(doc, "utf8"));
      }
    }

    currentVfs.chdir(repoRoot);
    currentSession = createVirtualFSSession(currentVfs);
  }
  return currentVfs;
}

export function cleanupVirtualRolesFS(): void {
  if (currentSession) {
    currentSession.cleanup();
    currentSession = null;
  }
  currentVfs = new VirtualMemoryFS();
}

afterEach(() => {
  cleanupVirtualRolesFS();
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
 * Creates an in-memory virtual scratch sandbox directory for roles tests.
 * Zero physical disk writes occur.
 */
export function scratchRoot(callerPath = "roles-test", label = "test"): string {
  const vfs = setupVirtualRolesFS();
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const dirName = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  const root = `/virtual/roles-scratch/${dirName}`;
  vfs.mkdirSync(root, { recursive: true });
  return root;
}

export function getVirtualRolesFS(): VirtualMemoryFS {
  return currentVfs;
}
