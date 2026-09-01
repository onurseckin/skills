import * as fs from "node:fs";
import * as path from "node:path";
import type { ReclamationReport, SymlinkCacheResult, WorktreeLease } from "./types.ts";
import { DEFAULT_CACHE_DIRECTORIES, DEFAULT_LEASE_DURATION_MS } from "./types.ts";

function getWorktreeDir(repoRoot: string): string {
  return path.join(repoRoot, ".olt", "worktrees");
}

function getLeasesDir(repoRoot: string): string {
  return path.join(repoRoot, ".olt", "locks", "leases");
}

function getBackupsDir(repoRoot: string): string {
  return path.join(repoRoot, ".olt", "scratch", "backups");
}

function ensureDirExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export async function symlinkDependencyCache(
  repoRoot: string,
  worktreePath: string,
  cacheDirectories: readonly string[] = DEFAULT_CACHE_DIRECTORIES,
): Promise<SymlinkCacheResult> {
  ensureDirExists(worktreePath);
  const symlinked: string[] = [];
  let savedBytesEstimate = 0;

  for (const item of cacheDirectories) {
    const sourcePath = path.join(repoRoot, item);
    const targetPath = path.join(worktreePath, item);

    if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
      try {
        const stat = fs.statSync(sourcePath);
        if (stat.isDirectory()) {
          fs.symlinkSync(sourcePath, targetPath, "junction");
          savedBytesEstimate += 150 * 1024 * 1024;
        } else {
          fs.symlinkSync(sourcePath, targetPath, "file");
          savedBytesEstimate += stat.size;
        }
        symlinked.push(item);
      } catch {
        // Skip
      }
    }
  }

  return {
    symlinked,
    savedBytesEstimate: Math.max(savedBytesEstimate, symlinked.length * 10 * 1024 * 1024),
  };
}

export function isLeaseExpired(lease: WorktreeLease, now = Date.now()): boolean {
  if (lease.status !== "active") return true;
  return now >= lease.expiresAt;
}

export async function createWorktreeLease(
  repoRoot: string,
  params: {
    worktreeId?: string;
    branch: string;
    agentId: string;
    role: string;
    taskId: string;
    shardType?: "remediation" | "read-only-forensic" | "execution";
    customDurationMs?: number;
  },
): Promise<WorktreeLease> {
  const leasesDir = getLeasesDir(repoRoot);
  const worktreeDir = getWorktreeDir(repoRoot);
  ensureDirExists(leasesDir);
  ensureDirExists(worktreeDir);

  const now = Date.now();
  const duration = params.customDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const worktreeId =
    params.worktreeId ?? `wt-${params.taskId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${now}`;
  const worktreePath = path.join(worktreeDir, worktreeId);
  ensureDirExists(worktreePath);

  const lease: WorktreeLease = {
    worktreeId,
    worktreePath,
    branch: params.branch,
    agentId: params.agentId,
    role: params.role,
    taskId: params.taskId,
    shardType: params.shardType ?? "execution",
    createdAt: now,
    expiresAt: now + duration,
    lastHeartbeatAt: now,
    status: "active",
  };

  const leaseFilePath = path.join(leasesDir, `${worktreeId}.json`);
  fs.writeFileSync(leaseFilePath, JSON.stringify(lease, null, 2), "utf-8");

  return lease;
}

export async function getWorktreeLease(
  repoRoot: string,
  worktreeId: string,
): Promise<WorktreeLease | null> {
  const leasesDir = getLeasesDir(repoRoot);
  const leaseFilePath = path.join(leasesDir, `${worktreeId}.json`);
  if (!fs.existsSync(leaseFilePath)) return null;

  try {
    const raw = fs.readFileSync(leaseFilePath, "utf-8");
    return JSON.parse(raw) as WorktreeLease;
  } catch {
    return null;
  }
}

export async function listWorktreeLeases(repoRoot: string): Promise<readonly WorktreeLease[]> {
  const leasesDir = getLeasesDir(repoRoot);
  if (!fs.existsSync(leasesDir)) return [];

  const files = fs.readdirSync(leasesDir);
  const leases: WorktreeLease[] = [];

  for (const file of files) {
    if (file.endsWith(".json")) {
      try {
        const raw = fs.readFileSync(path.join(leasesDir, file), "utf-8");
        leases.push(JSON.parse(raw) as WorktreeLease);
      } catch {
        // Skip corrupt lease files
      }
    }
  }

  return leases;
}

export async function renewWorktreeHeartbeat(
  repoRoot: string,
  worktreeId: string,
  extensionSeconds = 900,
): Promise<{ success: boolean; newExpiry: number; lease?: WorktreeLease }> {
  const lease = await getWorktreeLease(repoRoot, worktreeId);
  if (!lease || lease.status !== "active") {
    return { success: false, newExpiry: 0 };
  }

  const now = Date.now();
  const newExpiry = now + extensionSeconds * 1000;
  const updatedLease: WorktreeLease = {
    ...lease,
    lastHeartbeatAt: now,
    expiresAt: newExpiry,
  };

  const leasesDir = getLeasesDir(repoRoot);
  const leaseFilePath = path.join(leasesDir, `${worktreeId}.json`);
  fs.writeFileSync(leaseFilePath, JSON.stringify(updatedLease, null, 2), "utf-8");

  return { success: true, newExpiry, lease: updatedLease };
}

export async function releaseWorktreeLease(repoRoot: string, worktreeId: string): Promise<boolean> {
  const lease = await getWorktreeLease(repoRoot, worktreeId);
  if (!lease) return false;

  const updatedLease: WorktreeLease = {
    ...lease,
    status: "released",
  };

  const leasesDir = getLeasesDir(repoRoot);
  const leaseFilePath = path.join(leasesDir, `${worktreeId}.json`);
  fs.writeFileSync(leaseFilePath, JSON.stringify(updatedLease, null, 2), "utf-8");

  return true;
}

function copyRecursiveSync(src: string, dest: string): void {
  ensureDirExists(dest);
  if (!fs.existsSync(src)) return;

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyRecursiveSync(srcPath, destPath);
    } else if (entry.isFile()) {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch {
        // Skip unreadable files
      }
    }
  }
}

export async function reclaimOrphanedWorktrees(
  repoRoot: string,
  options?: { now?: number; maxAgeMs?: number },
): Promise<ReclamationReport> {
  const now = options?.now ?? Date.now();
  const leases = await listWorktreeLeases(repoRoot);
  const backupsDir = getBackupsDir(repoRoot);
  const leasesDir = getLeasesDir(repoRoot);
  ensureDirExists(backupsDir);

  const reclaimedWorktreeIds: string[] = [];
  const backupPaths: string[] = [];
  let reclaimedCount = 0;
  let backedUpCount = 0;

  for (const lease of leases) {
    const isExpired = isLeaseExpired(lease, now);
    const isExplicitlyReleased = lease.status === "released";

    if (isExpired || isExplicitlyReleased) {
      const worktreePath = lease.worktreePath;
      if (fs.existsSync(worktreePath)) {
        const backupId = `${lease.worktreeId}-${now}`;
        const backupDest = path.join(backupsDir, backupId);
        try {
          copyRecursiveSync(worktreePath, backupDest);
          backupPaths.push(backupDest);
          backedUpCount++;
        } catch {
          // Continue
        }

        try {
          fs.rmSync(worktreePath, { recursive: true, force: true });
          reclaimedCount++;
          reclaimedWorktreeIds.push(lease.worktreeId);
        } catch {
          // Ignore removal locks
        }
      }

      const updatedLease: WorktreeLease = {
        ...lease,
        status: "reclaimed",
      };
      const leaseFilePath = path.join(leasesDir, `${lease.worktreeId}.json`);
      fs.writeFileSync(leaseFilePath, JSON.stringify(updatedLease, null, 2), "utf-8");
    }
  }

  return {
    reclaimedCount,
    backedUpCount,
    backupPaths,
    reclaimedWorktreeIds,
  };
}
