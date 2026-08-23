import { HarnessError } from "../../core/errors/harness-error.ts";
import { readAgentLedger } from "../agents/ledger.ts";
import type { WorkflowState } from "../types.ts";

export function assertPlanValidatorIndependent(state: WorkflowState, validatorId: string): void {
  const authored = readAgentLedger(state).some(
    (grant) =>
      grant.id === validatorId && (grant.role === "coordinator" || grant.role === "planner"),
  );
  if (authored) {
    throw new HarnessError(
      "INVALID_STATE",
      "plan validator must be independent from the coordinator or planner that produced the plan",
    );
  }
}
