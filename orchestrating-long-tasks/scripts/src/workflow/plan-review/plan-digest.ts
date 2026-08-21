import { HarnessError } from "../../errors/harness-error.ts";
import { jsonDigest } from "../completion/completion-review-digest.ts";
import type { WorkflowState } from "../types.ts";

export function currentPlanDigest(state: WorkflowState): string {
  const revision = state.graph_revision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) {
    throw new HarnessError("INVALID_STATE", "plan is not compiled");
  }
  return jsonDigest({
    graph_revision: revision as number,
    tasks: state.tasks,
    requirements: state.requirements,
    gates: state.gates,
  });
}
