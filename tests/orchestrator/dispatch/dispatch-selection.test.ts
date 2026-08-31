import { describe, expect, test } from "bun:test";
import { selectDispatchable } from "../../../olt/scripts/src/orchestrator/dispatch-selection.ts";
import type { DispatchLogEvent } from "../../../olt/scripts/src/orchestrator/dispatch-log.ts";
import { schedulerState } from "../../scheduler/fixtures.ts";
import { createSampleDispatchLogEvent } from "./fixture.ts";
import { DISPATCH_SUITES } from "./index.ts";
import { ORCHESTRATOR_DOMAINS } from "../index.ts";

describe("selectDispatchable (B28.3 — what is safe to dispatch right now)", () => {
  test("with no capacity, nothing is selected regardless of what is ready", () => {
    const selection = selectDispatchable(
      schedulerState(),
      [],
      0,
      new Date("2026-08-19T00:00:00.000Z"),
    );
    expect(selection.dispatchable).toEqual([]);
    expect(selection.backingOff).toEqual([]);
  });

  test("with capacity and no backoff history, the top-ranked ready task is dispatchable", () => {
    const selection = selectDispatchable(
      schedulerState(),
      [],
      1,
      new Date("2026-08-19T00:00:00.000Z"),
    );
    expect(selection.dispatchable.map((entry) => entry.task_id)).toEqual(["priority"]);
    expect(selection.backingOff).toEqual([]);
  });

  test("a task still backing off from a transient dispatch failure is excluded and reported separately", () => {
    const events: DispatchLogEvent[] = [
      {
        kind: "supervisor-dispatch-outcome",
        payload: { task_id: "priority", outcome: "failed", retry_at: "2026-08-19T00:10:00.000Z" },
        timestamp: "2026-08-19T00:00:00.000Z",
      },
    ];
    const selection = selectDispatchable(
      schedulerState(),
      events,
      1,
      new Date("2026-08-19T00:05:00.000Z"),
    );
    expect(selection.dispatchable).toEqual([]);
    expect(selection.backingOff).toEqual([
      { taskId: "priority", retryAt: "2026-08-19T00:10:00.000Z" },
    ]);
  });

  test("becomes dispatchable again once the backoff clock has passed", () => {
    const events: DispatchLogEvent[] = [
      {
        kind: "supervisor-dispatch-outcome",
        payload: { task_id: "priority", outcome: "failed", retry_at: "2026-08-19T00:10:00.000Z" },
        timestamp: "2026-08-19T00:00:00.000Z",
      },
    ];
    const selection = selectDispatchable(
      schedulerState(),
      events,
      1,
      new Date("2026-08-19T00:15:00.000Z"),
    );
    expect(selection.dispatchable.map((entry) => entry.task_id)).toEqual(["priority"]);
    expect(selection.backingOff).toEqual([]);
  });

  test("dispatch fixture, suite registry, and root orchestrator domains are valid", () => {
    const event = createSampleDispatchLogEvent({ kind: "supervisor-dispatch-outcome" });
    expect(event.kind).toBe("supervisor-dispatch-outcome");
    expect(event.payload.task_id).toBe("T-sample-dispatch");

    expect(DISPATCH_SUITES.length).toBe(7);
    expect(ORCHESTRATOR_DOMAINS).toEqual([
      "lifecycle",
      "concurrency",
      "stragglers",
      "dispatch",
      "supervision",
    ]);
  });
});
