import { isBranchOpen } from "../../contracts/branch.ts";
import type { JsonObject } from "../../contracts/json.ts";
import { leaseIsExpired } from "../lease/suspension.ts";
import { readBranchLedger, writeBranchLedger } from "./ledger.ts";

export interface RecoveredSubTask {
  branch_id: string;
  sub_task_id: string;
  expired_agent_id: string;
}

/**
 * Reclaims sub-tasks whose sub-agent died holding the lease. Without this the branch can never
 * collect — every sub-task must be terminal — and the parent stays frozen forever, which is exactly
 * how a dead sub-agent used to block a run. A reclaimed sub-task returns to `open` for a fresh claim.
 */
export function recoverBranchSubTasks(
  draft: JsonObject,
  now: Date,
  graceMs: number,
): RecoveredSubTask[] {
  const ledger = readBranchLedger(draft);
  if (ledger.length === 0) return [];
  const recovered: RecoveredSubTask[] = [];
  for (const branch of ledger) {
    if (!isBranchOpen(branch)) continue;
    for (const subTask of branch.sub_tasks) {
      const lease = subTask.lease;
      if (!lease || subTask.status !== "claimed") continue;
      if (!leaseIsExpired(lease, now, graceMs)) continue;
      subTask.recovery = {
        recovered_at: now.toISOString(),
        expired_agent_id: lease.agent_id,
        expired_at: lease.expires_at,
      };
      delete subTask.lease;
      delete subTask.agent_id;
      subTask.status = "open";
      recovered.push({
        branch_id: branch.id,
        sub_task_id: subTask.id,
        expired_agent_id: subTask.recovery.expired_agent_id,
      });
    }
  }
  if (recovered.length > 0) writeBranchLedger(draft, ledger);
  return recovered;
}
