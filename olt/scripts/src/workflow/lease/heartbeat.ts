import { HarnessError } from "../../errors/harness-error.ts";
import { isLeaseSuspended } from "./suspension.ts";
import { tokenMatches } from "./token.ts";
import { requireText, taskIn, transition, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";

export function heartbeat(
  port: TransactionPort,
  taskId: string,
  agentId: string,
  token: string,
  clock: Clock = systemClock,
) {
  agentId = requireText(agentId, "agent_id");
  const now = clock.now();
  return port.transact(agentId, "lease-heartbeat", { task_id: taskId }, (draft) => {
    const task = taskIn(draft, taskId);
    const lease = task.lease;
    if (!lease || lease.agent_id !== agentId || !tokenMatches(token, lease.token_digest)) {
      throw new HarnessError("INVALID_STATE", "lease identity or token is invalid");
    }
    if (isLeaseSuspended(lease)) {
      throw new HarnessError(
        "INVALID_STATE",
        "lease clock is suspended while a branch is open; collect or abandon the branch first",
      );
    }
    if (Date.parse(lease.expires_at) <= now.valueOf()) {
      throw new HarnessError("INVALID_STATE", "lease has expired");
    }
    lease.heartbeat_at = utc(now);
    lease.expires_at = utc(new Date(now.valueOf() + lease.duration_seconds * 1_000));
    if (task.status === "leased") transition(task, "running", agentId, now, "first heartbeat");
  });
}
