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
      packet.attempt === attempt,
  );
  if (!authorized)
    throw new HarnessError(
      "INVALID_STATE",
      `${role} action requires a matching durably published packet`,
    );
}
