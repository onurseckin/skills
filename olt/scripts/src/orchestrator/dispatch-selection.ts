import { readySet, type ReadyEntry } from "../engine/scheduler/index.ts";
import { readDispatchHistory, type DispatchLogEvent } from "./dispatch-log.ts";

export interface BackingOffTask {
  readonly taskId: string;
  readonly retryAt: string;
}

export interface DispatchSelection {
  readonly dispatchable: readonly ReadyEntry[];
  readonly backingOff: readonly BackingOffTask[];
}

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
