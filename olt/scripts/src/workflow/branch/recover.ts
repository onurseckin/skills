import { isBranchOpen } from "../../core/contracts/branch.ts";
import type { JsonObject } from "../../core/contracts/json.ts";
import { leaseIsExpired } from "../lease/suspension.ts";
import { readBranchLedger, writeBranchLedger } from "./ledger.ts";

export interface RecoveredSubTask {
  branch_id: string;
  sub_task_id: string;
  expired_agent_id: string;
}

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
