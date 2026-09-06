/**
 * Transition push notification dispatcher and subscriber registry.
 *
 * Pushes events on transitions:
 * - Task state changes
 * - Run completion
 * - Verdict recorded
 * - Heartbeat lapses
 * - Freeze state changes
 *
 * Delivers events to registered subscribers so peers react in seconds without polling.
 */

import type {
  RunCompletedEvent,
  StateProjection,
  SubscriberCallback,
  TaskStateChangeEvent,
  TransitionEvent,
  TransitionEventType,
  UnsubscribeFunction,
  VerdictRecordedEvent,
} from "./types.ts";

interface RegisteredSubscriber {
  readonly callback: SubscriberCallback;
  readonly filter: TransitionEventType | "*";
}

export class NotificationDispatcher {
  private readonly subscribers: RegisteredSubscriber[] = [];

  public subscribe(
    callback: SubscriberCallback,
    filter: TransitionEventType | "*" = "*",
  ): UnsubscribeFunction {
    const entry: RegisteredSubscriber = { callback, filter };
    this.subscribers.push(entry);

    return () => {
      this.unsubscribe(callback);
    };
  }

  public unsubscribe(callback: SubscriberCallback): void {
    const idx = this.subscribers.findIndex((s) => s.callback === callback);
    if (idx !== -1) {
      this.subscribers.splice(idx, 1);
    }
  }

  public subscriberCount(filter?: TransitionEventType | "*"): number {
    if (filter === undefined) return this.subscribers.length;
    return this.subscribers.filter((s) => s.filter === filter || s.filter === "*").length;
  }

  public clearSubscribers(): void {
    this.subscribers.length = 0;
  }

  public async dispatch(event: TransitionEvent): Promise<void> {
    const targets = this.subscribers.filter((s) => s.filter === "*" || s.filter === event.type);

    for (const target of targets) {
      try {
        await Promise.resolve(target.callback(event));
      } catch {
        // Isolate subscriber exceptions so one listener cannot disrupt others
      }
    }
  }

  public async dispatchAll(events: readonly TransitionEvent[]): Promise<void> {
    for (const ev of events) {
      await this.dispatch(ev);
    }
  }

  public detectTransitions(
    prev: StateProjection | null,
    curr: StateProjection,
  ): readonly TransitionEvent[] {
    if (!prev) {
      return [];
    }

    const transitions: TransitionEvent[] = [];
    const timestamp = curr.projected_at;

    for (const [taskId, toState] of Object.entries(curr.task_states)) {
      const fromState = prev.task_states[taskId];
      if (fromState !== undefined && fromState !== toState) {
        const taskObj = curr.tasks.find((t) => t.id === taskId);
        const stateChangeEvent: TaskStateChangeEvent = {
          type: "task_state_changed",
          timestamp,
          run_id: curr.run_id,
          task_id: taskId,
          from_state: fromState,
          to_state: toState,
          lease_holder: taskObj?.lease_holder ?? null,
        };
        transitions.push(stateChangeEvent);

        if (toState === "done" || toState === "failed") {
          const verdictEvent: VerdictRecordedEvent = {
            type: "verdict_recorded",
            timestamp,
            run_id: curr.run_id,
            task_id: taskId,
            verdict: toState,
            passed: toState === "done",
            actor: taskObj?.lease_holder ?? "unknown",
          };
          transitions.push(verdictEvent);
        }
      }
    }

    if (prev.run_state !== "completed" && curr.run_state === "completed") {
      const runCompletedEvent: RunCompletedEvent = {
        type: "run_completed",
        timestamp,
        run_id: curr.run_id,
        final_state: curr.run_state,
      };
      transitions.push(runCompletedEvent);
    }

    return transitions;
  }
}
