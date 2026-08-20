import { recoverSuspendedChains } from "../branch/chain-recovery.ts";
import { recoverBranchSubTasks } from "../branch/recover.ts";
import { isLeaseSuspended } from "./suspension.ts";
import { taskIn, transition, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";

export interface RecoveryOptions {
  graceSeconds?: number;
}

export function recoverStale(
  port: TransactionPort,
  actor: string,
  clock: Clock = systemClock,
  options: RecoveryOptions = {},
) {
  const now = clock.now();
  const graceSeconds = options.graceSeconds ?? 30;
  if (!Number.isSafeInteger(graceSeconds) || graceSeconds < 0 || graceSeconds > 86_400) {
    throw new TypeError("grace_seconds must be an integer from 0 to 86400");
  }
  return port.transact(actor, "stale-recovery", { now: utc(now) }, (draft) => {
    for (const taskId of Object.keys(draft.tasks).sort()) {
      const task = taskIn(draft, taskId);
      // A branched parent is alive but blocked on its children, so its frozen lease is not stale.
      if (
        task.lease &&
        !isLeaseSuspended(task.lease) &&
        Date.parse(task.lease.expires_at) + graceSeconds * 1_000 <= now.valueOf()
      ) {
        const repair = task.attempts.at(-1)?.kind === "repair";
        const attempt = task.attempts.at(-1);
        if (attempt)
          Object.assign(attempt, {
            stale_at: utc(now),
            result: "stale",
            expired_agent_id: task.lease.agent_id,
            expired_token_digest: task.lease.token_digest,
          });
        delete task.lease;
        transition(task, repair ? "changes_requested" : "retry_ready", actor, now, "lease expired");
      }
      // B12.2: several domains can be validating at once. Only an attempt still awaiting a verdict
      // can go stale — a domain that already recorded one is settled, however old its deadline —
      // and pruning it frees just that domain's slot; the task only falls back to "submitted" once
      // nothing at all is left open, the same as a single validator going stale always did.
      if (task.status === "validating" && task.validations) {
        const stillOpen = task.validations.filter(
          (entry) => entry.verdict !== undefined || Date.parse(entry.deadline_at) > now.valueOf(),
        );
        if (stillOpen.length !== task.validations.length) {
          if (stillOpen.length > 0) task.validations = stillOpen;
          else {
            delete task.validations;
            transition(task, "submitted", actor, now, "validation interrupted");
          }
        }
      }
    }
    // Leaves first: reclaiming a dead sub-agent re-opens work, which is what tells the level above
    // it that it is still needed rather than stuck behind a corpse.
    recoverBranchSubTasks(draft, now, graceSeconds * 1_000);
    recoverSuspendedChains(draft, actor, now, graceSeconds * 1_000);
    const critic = draft.completion_critic;
    if (
      critic &&
      (critic.status === "assigned" || critic.status === "packet_published") &&
      Date.parse(critic.deadline_at) + graceSeconds * 1_000 <= now.valueOf()
    ) {
      critic.status = "expired";
      const historical = draft.completion_critic_history?.find(
        (entry) => entry.attempt === critic.attempt && entry.critic_id === critic.critic_id,
      );
      if (historical) historical.status = "expired";
    }
  });
}
