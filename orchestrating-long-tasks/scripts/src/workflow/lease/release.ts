import { HarnessError } from "../../errors/harness-error.ts";
import { requireText, taskIn, transition, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";
import { closeAttemptAsAbandoned } from "./attempt-state.ts";
import { tokenMatches } from "./token.ts";

export function releaseLease(
  port: TransactionPort,
  taskId: string,
  agentId: string,
  token: string,
  clock: Clock = systemClock,
) {
  agentId = requireText(agentId, "agent_id");
  const now = clock.now();
  return port.transact(agentId, "lease-released", { task_id: taskId }, (draft) => {
    const task = taskIn(draft, taskId);
    const lease = task.lease;
    if (!lease || lease.agent_id !== agentId || !tokenMatches(token, lease.token_digest)) {
      throw new HarnessError("INVALID_STATE", "lease identity or token is invalid");
    }
    if (Date.parse(lease.expires_at) <= now.valueOf()) {
      throw new HarnessError("INVALID_STATE", "lease has expired");
    }
    if (!["leased", "running"].includes(task.status)) {
      throw new HarnessError("INVALID_STATE", "task does not hold a releasable lease");
    }
    const attempt = task.attempts.at(-1);
    const repair = attempt?.kind === "repair";
    if (attempt) {
      Object.assign(attempt, { released_at: utc(now), result: "released" });
      closeAttemptAsAbandoned(attempt, agentId, "voluntary lease release", now);
    }
    delete task.lease;
    transition(task, repair ? "changes_requested" : "retry_ready", agentId, now, "lease released");
  });
}
