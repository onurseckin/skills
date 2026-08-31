import { HarnessError } from "../core/errors/index.ts";
import type { WorkflowState } from "./types.ts";

export function assertPublishedTaskPacket(
  state: WorkflowState,
  taskId: string,
  role: string,
  agentId: string,
  attempt: number,
): void {
  const authorized = Object.values(state.packets ?? {}).some(
    (packet) =>
      packet.status === "published" &&
      packet.task_id === taskId &&
      packet.role === role &&
      packet.agent_id === agentId &&
      (packet.attempt === attempt ||
        (attempt > 1 &&
          ((Array.isArray(state.tasks[taskId]?.micro_cycles) &&
            state.tasks[taskId].micro_cycles.length > 0) ||
            (typeof state.tasks[taskId]?.micro_cycle_round === "number" &&
              state.tasks[taskId].micro_cycle_round > 0)) &&
          packet.attempt <= attempt)),
  );
  if (!authorized)
    throw new HarnessError(
      "INVALID_STATE",
      `${role} action requires a matching durably published packet`,
    );
}
