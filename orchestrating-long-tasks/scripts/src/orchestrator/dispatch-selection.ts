import { readySet, type ReadyEntry } from "../scheduler/index.ts";
import { readDispatchHistory, type DispatchLogEvent } from "./dispatch-log.ts";

/**
 * What is safe to dispatch right now, split from `supervision-tick.ts`'s reclaim/escalate work
 * because it needs a different shape of state: the scheduler's `readySet` walks the capsule's full
 * dependency graph (`state.graph`), not the narrower `WorkflowState` a lease mutation operates on.
 * Production always has both — `loadRun(runRoot).state` for this, `workflowPort(runRoot)` for
 * mutations — so the split costs nothing there and keeps this half a pure function to test.
 */
export interface BackingOffTask {
  readonly taskId: string;
  readonly retryAt: string;
}

export interface DispatchSelection {
  /** Ready right now, with nothing owed on a backoff clock (B28.3) and capacity free to take it. */
  readonly dispatchable: readonly ReadyEntry[];
  /** Ready by dependency and scope, but still waiting out a transient-failure backoff. */
  readonly backingOff: readonly BackingOffTask[];
}

/**
 * `rawState` must be the full capsule state (e.g. `loadRun(runRoot).state`), taken AFTER any
 * reclaim/escalation mutation this tick already applied — a task escalated moments ago must not
 * still appear ready here.
 */
export function selectDispatchable(
  rawState: unknown,
  events: readonly DispatchLogEvent[],
  freeSlots: number,
  now: Date,
): DispatchSelection {
  const entries: readonly ReadyEntry[] = freeSlots > 0 ? readySet(rawState, freeSlots).entries : [];
  const backingOff: BackingOffTask[] = [];
  const dispatchable = entries.filter((entry) => {
    const history = readDispatchHistory(events, entry.task_id);
    if (history.retryAt === undefined || Date.parse(history.retryAt) <= now.valueOf()) return true;
    backingOff.push({ taskId: entry.task_id, retryAt: history.retryAt });
    return false;
  });
  return { dispatchable, backingOff };
}
