import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { recoverProjection, verifyIntegrity, loadRun } from "../../engine/store/index.ts";
import { recoverStale } from "../../workflow/lease/recover-stale.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { systemClock } from "../../workflow/types.ts";
import { atomicWriteBytes } from "../../core/durable-write.ts";
import { createSha256Hash } from "../../mind/defects/core/discriminator.ts";
import { cleanseDanglingLocks } from "./lock-cleaner.ts";
import { autoHealGitState } from "./git-index-engine.ts";
import { cleanupVestigialDefectsFile } from "../../mind/defects/sync/lifecycle-sync.ts";
import type { AutoHealOptions, DoctorAutoHealResult } from "./types.ts";

export type { AutoHealOptions };

const STATE_PROJECTION_ISSUE_CODE = "STATE_PROJECTION";
const TORN_EVENT_TAIL_CODE = "TORN_EVENT_TAIL";

/**
 * Quarantines torn trailing bytes into `.olt/quarantine/<timestamp>-torn-tail-<sha256>.json`.
 */
export function quarantineTornTail(runRoot: string, tornBytes: Buffer): string {
  const quarantineDir = join(runRoot, "quarantine");
  if (!existsSync(quarantineDir)) {
    mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });
  }
  const hash = createSha256Hash(tornBytes.toString("utf-8")).slice(0, 12);
  const fileName = `${Date.now()}-torn-tail-${hash}.json`;
  const targetPath = join(quarantineDir, fileName);
  atomicWriteBytes(targetPath, tornBytes);
  return fileName;
}

/**
 * Automatically inspects the capsule for state projection mismatches,
 * torn event tails, stale leases, dangling locks, vestigial ledgers, and git index locks.
 */
export function autoHealCapsule(
  runRoot: string,
  options: AutoHealOptions = {},
): DoctorAutoHealResult {
  const actor = options.actor ?? "doctor-auto-heal";
  const autoHealed: string[] = [];
  const recoveredLeases: string[] = [];
  const quarantinedFragments: string[] = [];
  const danglingLocksCleared: string[] = [];
  const migratedLedgers: string[] = [];
  let projectionRecovered = false;
  let gitIndexHealed = false;
  const gitArtifactsStaged: string[] = [];

  const repoRoot = options.repoRoot ?? resolve(runRoot, "..", "..");

  // 1. Clean dangling locks
  const clearedLocks = cleanseDanglingLocks({ repoRoot });
  if (clearedLocks.length > 0) {
    danglingLocksCleared.push(...clearedLocks);
    autoHealed.push(
      `Cleared ${clearedLocks.length} dangling flock lock(s): ${clearedLocks.join(", ")}`,
    );
  }

  // 2. Clean vestigial runtime ledgers in static package root
  try {
    const vestigialOlt = join(repoRoot, "olt", "defects.jsonl");
    if (existsSync(vestigialOlt)) {
      cleanupVestigialDefectsFile();
      migratedLedgers.push("olt/defects.jsonl -> .olt/defects.jsonl");
      autoHealed.push(
        "Migrated vestigial ledger olt/defects.jsonl to canonical .olt/defects.jsonl",
      );
    }
  } catch {
    // Best effort migration
  }

  // 3. Git index healing & auto-staging
  try {
    const gitHeal = autoHealGitState({ repoRoot, cleanIndexLock: true, stageModified: false });
    if (gitHeal.indexLockCleaned) {
      gitIndexHealed = true;
      autoHealed.push("Healed stale .git/index.lock");
    }
    if (gitHeal.stagedFiles.length > 0) {
      gitArtifactsStaged.push(...gitHeal.stagedFiles);
      autoHealed.push(`Auto-staged ${gitHeal.stagedFiles.length} file(s) for reflog safety`);
    }
  } catch {
    // Best effort git healing
  }

  // 4. Check for state projection mismatch, torn event tail, or state corruption
  let needsProjectionRecovery = false;
  try {
    const integrityIssues = verifyIntegrity(runRoot);
    if (
      integrityIssues.some(
        (issue) =>
          issue.code === STATE_PROJECTION_ISSUE_CODE ||
          issue.code === TORN_EVENT_TAIL_CODE ||
          issue.code === "STATE_JSON" ||
          issue.code.startsWith("EVENT_") ||
          issue.code === "EVENT_PATH",
      )
    ) {
      needsProjectionRecovery = true;
    }
  } catch {
    // If verifyIntegrity threw or failed, attempt recovery
    needsProjectionRecovery = true;
  }

  if (needsProjectionRecovery) {
    try {
      const recoveredState = recoverProjection(runRoot, actor);
      projectionRecovered = true;
      const quarantineDir = join(runRoot, "quarantine");
      if (existsSync(quarantineDir)) {
        try {
          const files = readdirSync(quarantineDir);
          quarantinedFragments.push(...files);
        } catch {
          // ignore directory read error
        }
      }
      autoHealed.push(
        `Recovered state projection from event chain (event_sequence=${recoveredState.event_sequence}) and quarantined torn fragments under quarantine/`,
      );
    } catch {
      // Auto-heal best-effort; failures will remain as integrity issues
    }
  }

  // 5. Check for stale leases or torn ledger states
  try {
    const loaded = loadRun(runRoot);
    const tasks = (loaded.state?.tasks ?? {}) as Record<string, Record<string, unknown>>;
    const now = systemClock.now().getTime();
    const hasStaleTasks = Object.values(tasks).some((task) => {
      const lease = task["lease"] as Record<string, unknown> | undefined;
      if (lease && typeof lease["expires_at"] === "string") {
        const expires = Date.parse(lease["expires_at"]);
        return !Number.isNaN(expires) && expires < now;
      }
      return false;
    });

    if (hasStaleTasks) {
      const port = workflowPort(runRoot);
      const beforeState = port.read();
      const leasedBefore = Object.values(beforeState.tasks)
        .filter((t) => t.lease !== undefined)
        .map((t) => t.id);

      const afterState = recoverStale(port, actor, systemClock, {
        graceSeconds: options.graceSeconds ?? 0,
      });

      const reclaimed = leasedBefore.filter((id) => afterState.tasks[id]?.lease === undefined);
      if (reclaimed.length > 0) {
        recoveredLeases.push(...reclaimed);
        autoHealed.push(
          `Auto-recovered ${reclaimed.length} stale task lease(s): ${reclaimed.join(", ")}`,
        );
      }
    }
  } catch {
    // Best-effort stale lease recovery
  }

  return {
    autoHealed,
    recoveredLeases,
    projectionRecovered,
    quarantinedFragments,
    danglingLocksCleared,
    migratedLedgers,
    gitIndexHealed,
    gitArtifactsStaged,
  };
}
