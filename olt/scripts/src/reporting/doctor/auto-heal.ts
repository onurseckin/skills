import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { recoverProjection, verifyIntegrity, loadRun } from "../../engine/store/index.ts";
import { recoverStale } from "../../workflow/lease/recover-stale.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { systemClock } from "../../workflow/types.ts";
import type { DoctorAutoHealResult } from "./types.ts";

const STATE_PROJECTION_ISSUE_CODE = "STATE_PROJECTION";
const TORN_EVENT_TAIL_CODE = "TORN_EVENT_TAIL";

export interface AutoHealOptions {
  readonly actor?: string | undefined;
  readonly graceSeconds?: number | undefined;
}

/**
 * Automatically inspects the capsule for state projection mismatches,
 * torn event tails, and stale leases, applying self-healing repairs.
 */
export function autoHealCapsule(
  runRoot: string,
  options: AutoHealOptions = {},
): DoctorAutoHealResult {
  const actor = options.actor ?? "doctor-auto-heal";
  const autoHealed: string[] = [];
  const recoveredLeases: string[] = [];
  const quarantinedFragments: string[] = [];
  let projectionRecovered = false;

  // 1. Check for state projection mismatch, torn event tail, or state corruption
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

  // 2. Check for stale leases or torn ledger states
  try {
    const loaded = loadRun(runRoot);
    const tasks = (loaded.state?.tasks ?? {}) as Record<string, Record<string, unknown>>;
    const now = systemClock.now().getTime();
    const hasStaleTasks = Object.values(tasks).some((task) => {
      const lease = task.lease as Record<string, unknown> | undefined;
      if (lease && typeof lease.expires_at === "string") {
        const expires = Date.parse(lease.expires_at);
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
  };
}
