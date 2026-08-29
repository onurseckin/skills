import { basename } from "node:path";
import { loadRun } from "../../../../engine/store/index.ts";
import { workflowPort } from "../../../../integration/store-ports.ts";
import { readAgentLedger } from "../../../../workflow/agents/ledger.ts";
import { runSupervisionTick } from "../../../../orchestrator/supervision-tick.ts";
import type { Clock } from "../../../../workflow/types.ts";
import type { Rung1Result } from "../types.ts";

export function executeRung1(params: {
  readonly liveRunRoots: readonly string[];
  readonly actor: string;
  readonly graceSeconds: number;
  readonly clock: Clock;
  readonly actionsTaken: string[];
}): Rung1Result {
  const { liveRunRoots, actor, graceSeconds, clock, actionsTaken } = params;

  let supervisionTicksRun = 0;
  const skippedDueToActiveCoordinator: string[] = [];
  let reclaimedLeasesCount = 0;
  let escalatedTasksCount = 0;

  for (const runPath of liveRunRoots) {
    try {
      const loadedRun = loadRun(runPath, false);
      const ledger = readAgentLedger(loadedRun.state);
      const hasActiveCoordinator = ledger.some(
        (grant) =>
          grant.status === "active" &&
          (grant.role === "coordinator" || grant.role === "orchestrator"),
      );

      if (hasActiveCoordinator) {
        skippedDueToActiveCoordinator.push(runPath);
        actionsTaken.push(
          `Rung 1: skipped supervision tick for ${basename(runPath)} (active coordinator grant holds single writer lease)`,
        );
      } else {
        const tickResult = runSupervisionTick(workflowPort(runPath), actor, {
          recoveryEnabled: true,
          graceSeconds,
          clock,
        });
        supervisionTicksRun++;
        reclaimedLeasesCount += tickResult.reclaimed.length;
        escalatedTasksCount += tickResult.escalatedNow.length;

        if (tickResult.reclaimed.length > 0) {
          actionsTaken.push(
            `Rung 1: reclaimed ${tickResult.reclaimed.length} dead lease(s) in ${basename(runPath)}`,
          );
        }
        if (tickResult.escalatedNow.length > 0) {
          actionsTaken.push(
            `Rung 1: escalated ${tickResult.escalatedNow.length} deterministically dead task(s) in ${basename(runPath)}`,
          );
        }
      }
    } catch {
      // ignore
    }
  }

  return {
    liveRunsChecked: liveRunRoots.length,
    supervisionTicksRun,
    skippedDueToActiveCoordinator,
    reclaimedLeasesCount,
    escalatedTasksCount,
  };
}
