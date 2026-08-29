import { dirname } from "node:path";
import type { Clock } from "../../../workflow/types.ts";
import { findRepoRoot } from "../../../core/shared/paths.ts";
import { loadRun } from "../../../engine/store/index.ts";
import type { RescueLaneOptions, RescueLaneResult } from "./types.ts";
import { parseNowMs, findLiveRunRoots } from "./helpers.ts";
import { executeRung0 } from "./rungs/rung0.ts";
import { executeRung1 } from "./rungs/rung1.ts";
import { executeRung2 } from "./rungs/rung2.ts";
import { executeRung3 } from "./rungs/rung3.ts";
import { executeRung4 } from "./rungs/rung4.ts";
import { executeRung5 } from "./rungs/rung5.ts";

export async function executeRescueLane(
  mindRunRoot: string,
  options: RescueLaneOptions = {},
): Promise<RescueLaneResult> {
  const nowMs = parseNowMs(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const clock: Clock = options.clock ?? { now: () => new Date(nowMs) };

  const loadedMind = loadRun(mindRunRoot, false);
  const actualMindRunRoot = loadedMind?.runRoot ?? mindRunRoot;
  const repoRoot = findRepoRoot(actualMindRunRoot);
  const capsulesDir = dirname(actualMindRunRoot);

  const actor =
    options.actor ??
    (typeof loadedMind.state.mind === "object" &&
    loadedMind.state.mind !== null &&
    typeof (loadedMind.state.mind as Record<string, unknown>).actor === "string"
      ? ((loadedMind.state.mind as Record<string, unknown>).actor as string)
      : "mind-1");

  const grantIdleSeconds = options.grantIdleSeconds ?? 1800;
  const graceSeconds = options.graceSeconds ?? 30;

  const actionsTaken: string[] = [];
  const escalations: string[] = [];

  const rung0 = await executeRung0({
    mindRunRoot,
    loadedMind,
    repoRoot,
    actor,
    nowMs,
    nowIso,
    options,
    actionsTaken,
    escalations,
  });

  if (rung0.halted) {
    return {
      outcome: "halted",
      rungs: {
        rung0,
        rung1: {
          liveRunsChecked: 0,
          supervisionTicksRun: 0,
          skippedDueToActiveCoordinator: [],
          reclaimedLeasesCount: 0,
          escalatedTasksCount: 0,
        },
        rung2: { abandonedAttempts: [], orphanEvidenceEscalated: [], worktreesReclaimed: [] },
        rung3: { deadAgentsReleased: [] },
        rung4: { deadPulseReclaimed: false, consecutiveCrashes: 0, halted: false },
        rung5: { gapExceeded: false, notified: false },
      },
      halted: true,
      ...(rung0.haltReason ? { haltReason: rung0.haltReason } : {}),
      actionsTaken,
      escalations,
      summary: `RESCUE halted at Rung 0: ${rung0.haltReason}`,
    };
  }

  const liveRunRoots =
    options.targetRunRoots !== undefined && options.targetRunRoots.length > 0
      ? [...options.targetRunRoots]
      : findLiveRunRoots(capsulesDir, mindRunRoot);

  const rung1 = executeRung1({
    liveRunRoots,
    actor,
    graceSeconds,
    clock,
    actionsTaken,
  });

  const rung2 = executeRung2({
    liveRunRoots,
    actor,
    nowMs,
    nowIso,
    clock,
    actionsTaken,
    escalations,
  });

  const rung3 = executeRung3({
    liveRunRoots,
    mindRunRoot,
    actor,
    nowMs,
    grantIdleSeconds,
    clock,
    actionsTaken,
  });

  const rung4 = executeRung4({
    mindRunRoot,
    loadedMind,
    actor,
    nowMs,
    nowIso,
    actionsTaken,
    escalations,
  });

  if (rung4.halted) {
    return {
      outcome: "halted",
      rungs: {
        rung0,
        rung1,
        rung2,
        rung3,
        rung4,
        rung5: { gapExceeded: false, notified: false },
      },
      halted: true,
      ...(rung4.haltReason ? { haltReason: rung4.haltReason } : {}),
      actionsTaken,
      escalations,
      summary: `RESCUE halted at Rung 4: ${rung4.haltReason}`,
    };
  }

  const rung5 = executeRung5({
    mindRunRoot,
    loadedMind,
    actor,
    nowMs,
    nowIso,
    actionsTaken,
    escalations,
  });

  const hasAction = actionsTaken.length > 0;
  const outcome = hasAction ? "rescued" : "quiescent";

  const summary = hasAction
    ? `RESCUE executed successfully (${actionsTaken.length} action(s) taken)`
    : "RESCUE checked all 6 rungs; no recovery actions needed (quiescent)";

  return {
    outcome,
    rungs: { rung0, rung1, rung2, rung3, rung4, rung5 },
    halted: false,
    actionsTaken,
    escalations,
    summary,
  };
}
