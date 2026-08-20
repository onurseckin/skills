import { describe, expect, test } from "bun:test";
import {
  DISPATCH_OUTCOME_KIND,
  readDispatchHistory,
  recordDispatchOutcome,
  type DispatchLogEvent,
} from "../../../orchestrating-long-tasks/scripts/src/orchestrator/dispatch-log.ts";
import { TestPort, workflowState } from "../workflow/test-port.ts";

function asEvents(port: TestPort): DispatchLogEvent[] {
  return port.events.map((event, index) => ({
    kind: event.kind,
    payload: event.payload,
    timestamp: `2026-08-19T00:0${index}:00.000Z`,
  }));
}

describe("recordDispatchOutcome / readDispatchHistory (B28.3 durable backoff bookkeeping)", () => {
  test("a task with no history has no failures and nothing to wait for", () => {
    const history = readDispatchHistory([], "T-1");
    expect(history.failures).toEqual([]);
    expect(history.retryAt).toBeUndefined();
  });

  test("round-trips a recorded failure into a classifiable prior-failure record", () => {
    const port = new TestPort(workflowState());
    recordDispatchOutcome(port, "supervisor", {
      taskId: "T-1",
      outcome: "failed",
      failure: { signal: "rate_limit", detail: "429" },
      retryAt: "2026-08-19T00:05:00.000Z",
    });
    const history = readDispatchHistory(asEvents(port), "T-1");
    expect(history.failures).toEqual([{ signal: "rate_limit", detail: "429", at: "2026-08-19T00:00:00.000Z" }]);
    expect(history.retryAt).toBe("2026-08-19T00:05:00.000Z");
  });

  test("records with kind supervisor-dispatch-outcome so the report can find them by name", () => {
    const port = new TestPort(workflowState());
    recordDispatchOutcome(port, "supervisor", { taskId: "T-1", outcome: "dispatched", agentId: "a-1" });
    expect(port.events[0]?.kind).toBe(DISPATCH_OUTCOME_KIND);
  });

  test("a successful dispatch resets the streak — the task made progress since the last failure", () => {
    const port = new TestPort(workflowState());
    recordDispatchOutcome(port, "supervisor", {
      taskId: "T-1",
      outcome: "failed",
      failure: { signal: "network", detail: "dns" },
      retryAt: "2026-08-19T00:05:00.000Z",
    });
    recordDispatchOutcome(port, "supervisor", { taskId: "T-1", outcome: "dispatched", agentId: "a-2" });
    recordDispatchOutcome(port, "supervisor", {
      taskId: "T-1",
      outcome: "failed",
      failure: { signal: "timeout", detail: "slow" },
      retryAt: "2026-08-19T00:20:00.000Z",
    });
    const history = readDispatchHistory(asEvents(port), "T-1");
    expect(history.failures).toHaveLength(1);
    expect(history.failures[0]?.signal).toBe("timeout");
  });

  test("ignores events belonging to a different task", () => {
    const port = new TestPort(workflowState());
    recordDispatchOutcome(port, "supervisor", {
      taskId: "T-2",
      outcome: "failed",
      failure: { signal: "rate_limit", detail: "429" },
      retryAt: "2026-08-19T00:05:00.000Z",
    });
    const history = readDispatchHistory(asEvents(port), "T-1");
    expect(history.failures).toEqual([]);
  });
});
