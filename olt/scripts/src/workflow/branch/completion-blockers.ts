import { isBranchOpen } from "../../core/contracts/index.ts";
import type { JsonObject } from "../../core/contracts/index.ts";
import { readBranchLedger } from "./ledger.ts";

export function openBranchIssues(state: JsonObject): string[] {
  return readBranchLedger(state)
    .filter(isBranchOpen)
    .map(
      (branch) =>
        `branch ${branch.id} on ${branch.parent_task_id} at depth ${branch.depth} is ${branch.status}, not collected`,
    );
}
