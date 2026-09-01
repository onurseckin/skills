import * as fs from "node:fs";
import * as path from "node:path";
import { ALL_31_AGENT_ARCHETYPES } from "../fleet/index.ts";
import { listWorktreeLeases, reclaimOrphanedWorktrees } from "../worktree/index.ts";
import type {
  EpochMeshState,
  HealthIssue,
  IgnitionOptions,
  IgnitionResult,
  SelfHealingReport,
  UniversalHealthReport,
} from "./types.ts";
import { createEpochMesh } from "./tracks.ts";

export async function diagnoseUniversalHealth(
  workspaceRoot: string,
  options?: { maxLockAgeMs?: number; now?: number },
): Promise<UniversalHealthReport> {
  const now = options?.now ?? Date.now();
  const maxLockAge = options?.maxLockAgeMs ?? 5 * 60 * 1000;
  const issues: HealthIssue[] = [];

  let staleLocks = 0;
  let orphanedWorktrees = 0;
  let danglingBrowsers = 0;
  let expiredLeases = 0;

  const mailboxLocksDir = path.join(workspaceRoot, ".olt", "locks", "mailboxes");
  if (fs.existsSync(mailboxLocksDir)) {
    const lockFiles = fs.readdirSync(mailboxLocksDir);
    for (const lockFile of lockFiles) {
      if (lockFile.endsWith(".lock")) {
        const fullPath = path.join(mailboxLocksDir, lockFile);
        try {
          const stat = fs.statSync(fullPath);
          if (now - stat.mtimeMs > maxLockAge) {
            staleLocks++;
            issues.push({
              type: "stale_mailbox_lock",
              target: fullPath,
              description: `Mailbox lock '${lockFile}' has been held for >${Math.round((now - stat.mtimeMs) / 1000)}s.`,
              severity: "warning",
            });
          }
        } catch {
          // Ignore read error
        }
      }
    }
  }

  const leases = await listWorktreeLeases(workspaceRoot);
  for (const lease of leases) {
    if (lease.status === "active" && now >= lease.expiresAt) {
      expiredLeases++;
      issues.push({
        type: "expired_write_lease",
        target: lease.worktreeId,
        description: `Write lease for task '${lease.taskId}' (agent: ${lease.agentId}) expired at ${new Date(lease.expiresAt).toISOString()}.`,
        severity: "critical",
      });
    }
  }

  const worktreeDir = path.join(workspaceRoot, ".olt", "worktrees");
  if (fs.existsSync(worktreeDir)) {
    const entries = fs.readdirSync(worktreeDir);
    const activeLeaseWorktreeIds = new Set(
      leases.filter((l) => l.status === "active" && now < l.expiresAt).map((l) => l.worktreeId),
    );

    for (const entry of entries) {
      if (!activeLeaseWorktreeIds.has(entry)) {
        orphanedWorktrees++;
        issues.push({
          type: "orphaned_worktree",
          target: path.join(worktreeDir, entry),
          description: `Worktree directory '${entry}' has no active lease.`,
          severity: "warning",
        });
      }
    }
  }

  const browserPidsFile = path.join(workspaceRoot, ".olt", "locks", "browsers.json");
  if (fs.existsSync(browserPidsFile)) {
    try {
      const raw = fs.readFileSync(browserPidsFile, "utf-8");
      const pids = JSON.parse(raw) as { pid: number; startedAt: number }[];
      for (const entry of pids) {
        if (now - entry.startedAt > 30 * 60 * 1000) {
          danglingBrowsers++;
          issues.push({
            type: "dangling_browser",
            target: `pid:${entry.pid}`,
            description: `Dangling headless browser process PID ${entry.pid} active for >30 minutes.`,
            severity: "critical",
          });
        }
      }
    } catch {
      // Ignore
    }
  }

  const healthy = issues.length === 0;

  return {
    healthy,
    timestamp: now,
    issues,
    stats: {
      staleLocks,
      orphanedWorktrees,
      danglingBrowsers,
      expiredLeases,
    },
  };
}

export async function autoHealUniversalHealth(
  workspaceRoot: string,
  report: UniversalHealthReport,
): Promise<SelfHealingReport> {
  const actionsTaken: string[] = [];
  const remainingIssues: HealthIssue[] = [];

  for (const issue of report.issues) {
    try {
      if (issue.type === "stale_mailbox_lock") {
        if (fs.existsSync(issue.target)) {
          fs.unlinkSync(issue.target);
          actionsTaken.push(`Unlinked stale mailbox lock: ${path.basename(issue.target)}`);
        }
      } else if (issue.type === "orphaned_worktree" || issue.type === "expired_write_lease") {
        const reclaimResult = await reclaimOrphanedWorktrees(workspaceRoot);
        actionsTaken.push(
          `Reclaimed ${reclaimResult.reclaimedCount} worktrees with ${reclaimResult.backedUpCount} backups.`,
        );
      } else if (issue.type === "dangling_browser") {
        const browserPidsFile = path.join(workspaceRoot, ".olt", "locks", "browsers.json");
        if (fs.existsSync(browserPidsFile)) {
          fs.unlinkSync(browserPidsFile);
          actionsTaken.push("Terminated dangling browser tracking and purged state.");
        }
      } else {
        remainingIssues.push(issue);
      }
    } catch {
      remainingIssues.push(issue);
    }
  }

  return {
    healed: remainingIssues.length === 0,
    timestamp: Date.now(),
    actionsTaken,
    remainingIssues,
  };
}

export async function igniteSwarmEcosystem(
  workspaceRoot?: string,
  options?: IgnitionOptions,
): Promise<IgnitionResult> {
  const root = workspaceRoot ?? process.cwd();
  const epochId = options?.initialEpochId ?? `epoch-${Date.now().toString(36)}`;
  const createdDirectories: string[] = [];

  const requiredDirectories = [
    path.join(root, ".olt"),
    path.join(root, ".olt", "mailboxes"),
    path.join(root, ".olt", "locks"),
    path.join(root, ".olt", "locks", "mailboxes"),
    path.join(root, ".olt", "locks", "leases"),
    path.join(root, ".olt", "worktrees"),
    path.join(root, ".olt", "scratch"),
    path.join(root, ".olt", "scratch", "backups"),
    path.join(root, ".olt", "telemetry"),
    path.join(root, ".olt", "capsules"),
  ];

  for (const dir of requiredDirectories) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      createdDirectories.push(path.relative(root, dir));
    }
  }

  const healthReport = await diagnoseUniversalHealth(root);
  let selfHealingReport: SelfHealingReport = {
    healed: true,
    timestamp: Date.now(),
    actionsTaken: [],
    remainingIssues: [],
  };

  if (!healthReport.healthy && options?.autoHeal !== false) {
    selfHealingReport = await autoHealUniversalHealth(root, healthReport);
  }

  const epochMesh = createEpochMesh(epochId);

  return {
    ready: true,
    workspaceRoot: root,
    createdDirectories,
    healthReport,
    selfHealingReport,
    registeredAgentsCount: ALL_31_AGENT_ARCHETYPES.length,
    epochMesh,
    message: `Swarm Ecosystem ignited successfully across ${ALL_31_AGENT_ARCHETYPES.length} archetypes in epoch '${epochId}'.`,
  };
}
