import { describe, expect, it } from "bun:test";
import { NotificationDispatcher } from "../../../olt/scripts/src/liaison/daemon/notification.ts";
import type {
  HeartbeatLapseEvent,
  StateProjection,
  TaskStateChangeEvent,
  TransitionEvent,
} from "../../../olt/scripts/src/liaison/daemon/types.ts";

function createMockProjection(
  taskStates: Record<string, string>,
  runState = "active",
): StateProjection {
  return {
    run_id: "test-run",
    projected_at: "2026-09-06T00:00:00.000Z",
    run_state: runState,
    task_states: taskStates,
    tasks: Object.entries(taskStates).map(([id, status]) => ({
      id,
      status,
      lease_holder: status === "leased" ? "implementer_1" : null,
    })),
    lease_holders: [],
    distinct_implementer_identities: ["implementer_1"],
    concurrency: {
      lane_count: Object.keys(taskStates).length,
      distinct_implementer_count: 1,
      distinct_implementers: ["implementer_1"],
      ratio: 1,
    },
    capsule_event_count: 10,
    last_event_timestamp: "2026-09-06T00:00:00.000Z",
    last_event_sequence: 10,
    git: { head: "sha", branch: "main", dirty_count: 0, ahead: 0, behind: 0, available: true },
    metrics: [],
  };
}

describe("NotificationDispatcher", () => {
  it("delivers events to subscribers with wildcard or specific filters", async () => {
    const dispatcher = new NotificationDispatcher();
    const receivedWildcard: TransitionEvent[] = [];
    const receivedTaskChange: TransitionEvent[] = [];
    const receivedLapse: TransitionEvent[] = [];

    dispatcher.subscribe((e) => {
      receivedWildcard.push(e);
    });

    dispatcher.subscribe((e) => {
      receivedTaskChange.push(e);
    }, "task_state_changed");

    dispatcher.subscribe((e) => {
      receivedLapse.push(e);
    }, "heartbeat_lapse");

    const taskEvent: TaskStateChangeEvent = {
      type: "task_state_changed",
      timestamp: "2026-09-06T00:00:00.000Z",
      run_id: "run-1",
      task_id: "task-1",
      from_state: "ready",
      to_state: "leased",
    };

    const lapseEvent: HeartbeatLapseEvent = {
      type: "heartbeat_lapse",
      timestamp: "2026-09-06T00:00:01.000Z",
      peer_id: "peer-b",
      missed_beats: 3,
      declared_interval_ms: 1000,
    };

    await dispatcher.dispatch(taskEvent);
    await dispatcher.dispatch(lapseEvent);

    expect(receivedWildcard.length).toBe(2);
    expect(receivedTaskChange.length).toBe(1);
    expect(receivedTaskChange[0]).toEqual(taskEvent);
    expect(receivedLapse.length).toBe(1);
    expect(receivedLapse[0]).toEqual(lapseEvent);
  });

  it("unsubscribes cleanly using returned unsubscribe function", async () => {
    const dispatcher = new NotificationDispatcher();
    let count = 0;

    const unsubscribe = dispatcher.subscribe(() => {
      count++;
    });

    const event: HeartbeatLapseEvent = {
      type: "heartbeat_lapse",
      timestamp: new Date().toISOString(),
      peer_id: "peer-x",
      missed_beats: 2,
      declared_interval_ms: 1000,
    };

    await dispatcher.dispatch(event);
    expect(count).toBe(1);

    unsubscribe();
    await dispatcher.dispatch(event);
    expect(count).toBe(1);
  });

  it("contains subscriber errors without interrupting other subscribers", async () => {
    const dispatcher = new NotificationDispatcher();
    let secondSubscriberCalled = false;

    dispatcher.subscribe(() => {
      throw new Error("Subscriber crash!");
    });

    dispatcher.subscribe(() => {
      secondSubscriberCalled = true;
    });

    const event: HeartbeatLapseEvent = {
      type: "heartbeat_lapse",
      timestamp: new Date().toISOString(),
      peer_id: "p",
      missed_beats: 2,
      declared_interval_ms: 1000,
    };

    // Should not throw
    await dispatcher.dispatch(event);
    expect(secondSubscriberCalled).toBe(true);
  });

  it("detects transitions between state projections", () => {
    const dispatcher = new NotificationDispatcher();

    const prev = createMockProjection({ "task-1": "ready", "task-2": "leased" }, "active");
    const curr = createMockProjection({ "task-1": "leased", "task-2": "done" }, "completed");

    const transitions = dispatcher.detectTransitions(prev, curr);

    // Expected:
    // 1. task-1 state changed from ready to leased
    // 2. task-2 state changed from leased to done
    // 3. task-2 verdict recorded (done -> passed: true)
    // 4. run completed
    expect(transitions.length).toBe(4);

    const task1Change = transitions.find(
      (t) => t.type === "task_state_changed" && (t as TaskStateChangeEvent).task_id === "task-1",
    ) as TaskStateChangeEvent;
    expect(task1Change).toBeDefined();
    expect(task1Change.from_state).toBe("ready");
    expect(task1Change.to_state).toBe("leased");

    const task2Verdict = transitions.find((t) => t.type === "verdict_recorded");
    expect(task2Verdict).toBeDefined();

    const runCompleted = transitions.find((t) => t.type === "run_completed");
    expect(runCompleted).toBeDefined();
  });
});
