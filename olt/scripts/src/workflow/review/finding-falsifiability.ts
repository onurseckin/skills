import type { JsonObject } from "../../core/contracts/index.ts";
import { gateFalsifiabilityStatuses } from "./pass-preconditions.ts";
import type { TaskRecord, WorkflowState } from "../types.ts";

export interface FindingFalsifiabilityVerdict extends JsonObject {
  checked: boolean;
  proven: boolean;
  gate_ids: string[];
  base: string | null;
}

export function findingFalsifiabilityVerdict(
  state: WorkflowState,
  task: TaskRecord,
): FindingFalsifiabilityVerdict {
  const statuses = gateFalsifiabilityStatuses(state, task);
  if (statuses.length === 0) {
    return { checked: false, proven: false, gate_ids: [], base: null };
  }
  return {
    checked: true,
    proven: statuses.every((status) => status.proven),
    gate_ids: statuses.map((status) => status.gate_id),
    base: statuses.find((status) => status.proof !== undefined)?.proof?.base ?? null,
  };
}
