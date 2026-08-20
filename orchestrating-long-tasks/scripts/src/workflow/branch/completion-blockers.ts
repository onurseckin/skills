import { isBranchOpen } from "../../contracts/branch.ts";
import type { JsonObject } from "../../contracts/json.ts";
import { readBranchLedger } from "./ledger.ts";

/**
 * An uncollected branch means a working agent is still blocked on children it never took back. The
 * run cannot be complete while that is true, whatever the plan tasks say. Depth is named because a
 * branch buried several levels down is the one nobody remembers is still open.
 */
export function openBranchIssues(state: JsonObject): string[] {
  return readBranchLedger(state)
    .filter(isBranchOpen)
    .map(
      (branch) =>
        `branch ${branch.id} on ${branch.parent_task_id} at depth ${branch.depth} is ${branch.status}, not collected`,
    );
}
