import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

let currentSession: VirtualFSSession | null = null;
let currentVfs: VirtualMemoryFS = new VirtualMemoryFS();
let counter = 0;

function normPath(p: string): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

const ORCHESTRATOR_MANIFEST_YAML = `name: "orchestrator"
role: "orchestrator"
tier: 1
permissions:
  commands:
    - "worktree:create"
    - "worktree:land"
    - "worktree:list"
    - "worktree:clean"
    - "worktree:status"
    - "worktree:reclaim"
`;

const COORDINATOR_MANIFEST_YAML = `name: "coordinator"
role: "coordinator"
tier: 2
permissions:
  commands:
    - "worktree:create"
    - "worktree:land"
    - "worktree:list"
    - "worktree:clean"
    - "worktree:status"
    - "worktree:reclaim"
`;

export function setupVirtualTracksFS(): VirtualMemoryFS {
  cleanupVirtualTracksFS();
  currentVfs = new VirtualMemoryFS();
  const repoRoot = normPath(process.cwd());

  currentVfs.mkdirSync(repoRoot, { recursive: true });
  currentVfs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  currentVfs.mkdirSync(path.join(repoRoot, ".olt"), { recursive: true });
  currentVfs.mkdirSync(path.join(repoRoot, ".olt", "worktrees"), { recursive: true });
  currentVfs.mkdirSync(path.join(repoRoot, ".olt", "worktrees", "locks"), { recursive: true });
  currentVfs.mkdirSync(path.join(repoRoot, ".olt", "scratch"), { recursive: true });
  currentVfs.mkdirSync(path.join(repoRoot, "olt", "agents"), { recursive: true });
  currentVfs.mkdirSync("/olt/agents", { recursive: true });

  currentVfs.writeFileSync(
    path.join(repoRoot, "olt", "agents", "orchestrator.yaml"),
    ORCHESTRATOR_MANIFEST_YAML,
  );
  currentVfs.writeFileSync(
    path.join(repoRoot, "olt", "agents", "coordinator.yaml"),
    COORDINATOR_MANIFEST_YAML,
  );
  currentVfs.writeFileSync("/olt/agents/orchestrator.yaml", ORCHESTRATOR_MANIFEST_YAML);
  currentVfs.writeFileSync("/olt/agents/coordinator.yaml", COORDINATOR_MANIFEST_YAML);

  const virtualRoot = "/virtual/worktree-repo";
  currentVfs.mkdirSync(virtualRoot, { recursive: true });
  currentVfs.mkdirSync(path.join(virtualRoot, ".git"), { recursive: true });
  currentVfs.mkdirSync(path.join(virtualRoot, ".olt", "worktrees", "locks"), { recursive: true });

  currentVfs.chdir(repoRoot);
  currentSession = createVirtualFSSession(currentVfs);
  return currentVfs;
}

export function cleanupVirtualTracksFS(): void {
  if (currentSession) {
    currentSession.cleanup();
    currentSession = null;
  }
  currentVfs.reset();
}

export function getVirtualTracksFS(): VirtualMemoryFS {
  return currentVfs;
}

export function scratchRoot(callerPath = "tracks-test", label = "test"): string {
  const vfs = setupVirtualTracksFS();
  counter += 1;
  const digest = createHash("sha256")
    .update(`${callerPath}:${label}:${counter}`)
    .digest("hex")
    .slice(0, 8);
  const root = `/virtual/tracks-scratch/${callerPath}-${label}-${counter}-${digest}`;
  vfs.mkdirSync(root, { recursive: true });
  vfs.mkdirSync(path.join(root, ".olt", "worktrees", "locks"), { recursive: true });
  return root;
}
