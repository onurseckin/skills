import { describe, expect, test } from "bun:test";
import { transact } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  RunSupervisor,
  type TaskDispatchInput,
  type TaskDispatchResult,
  type TaskDispatcher,
} from "../../../olt/scripts/src/orchestrator/supervisor.ts";
import { fakeClock, supervisedRun } from "./index.ts";

function stubDispatcher(
  respond: (input: TaskDispatchInput) => TaskDispatchResult,
): TaskDispatcher & { calls: TaskDispatchInput[] } {
  const calls: TaskDispatchInput[] = [];
  return {
    calls,
    dispatch: async (input) => {
      calls.push(input);
      return respond(input);
    },
  };
}

describe("RunSupervisor — without a dispatcher", () => {
  test("a single tick reports what's dispatchable and stops, without touching the run", async () => {
    const run = supervisedRun("single-tick");
    const { clock } = fakeClock("2026-08-19T00:00:00.000Z");
    const supervisor = new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      clock,
    });

    const result = await supervisor.run();
    expect(result.stopReason).toBe("single_tick");
    expect(result.ticks).toBe(1);
    expect(result.lastTick.dispatchable.map((e) => e.task_id)).toEqual(["t-1"]);
    expect(result.lastTick.occupied).toBe(0);
    expect(result.report.ceilings.maxParallel).toBe(4);
  });

  test("surfaces a task awaiting repair alongside what's dispatchable, instead of dropping it silently", async () => {
    const run = supervisedRun("changes-requested-visibility", 2);
    transact(run, "validator", "reject-t-2", {}, (draft) => {
      const task = draft.tasks["t-2"] as {
        status: string;
        original_implementer?: string;
        history: {
          at: string;
          actor: string;
          from: string;
          to: string;
          reason: string;
          attempt: number;
        }[];
      };
      task.status = "changes_requested";
      task.original_implementer = "impl-1";
      task.history.push({
        at: "2026-08-19T00:00:00.000Z",
        actor: "validator-1",
        from: "validating",
        to: "changes_requested",
        reason: "missing test coverage for the new branch",
        attempt: 1,
      });
    });
    const { clock } = fakeClock("2026-08-19T00:00:00.000Z");
    const supervisor = new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      clock,
    });

    const result = await supervisor.run();
    expect(result.lastTick.changesRequested).toEqual([
      {
        taskId: "t-2",
        reason: "missing test coverage for the new branch",
        originalImplementer: "impl-1",
      },
    ]);
    expect(result.lastTick.dispatchable.map((e) => e.task_id)).toEqual(["t-1"]);
  });
});

describe("RunSupervisor — default sleep", () => {
  test("without an injected sleep, the real setTimeout-backed default still lets the loop reach a terminal run", async () => {
    const run = supervisedRun("default-sleep", 2);
    const { clock } = fakeClock("2026-08-19T00:00:00.000Z");
    const dispatcher = stubDispatcher((input) => {
      transact(run, "supervisor", "force-done", {}, (draft) => {
        const tasks = draft.tasks as Record<string, { status: string }>;
        tasks[input.taskId]!.status = "done";
      });
      return { status: "dispatched" };
    });

    const supervisor = new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 1,
      dispatcher,
      clock,
      pollIntervalMs: 1,
    });

    const result = await supervisor.run();
    expect(result.stopReason).toBe("terminal");
    expect(dispatcher.calls.map((c) => c.taskId).sort()).toEqual(["t-1", "t-2"]);
  });
});

describe("RunSupervisor — with a dispatcher, driving the run loop", () => {
  test("records a dispatched task and keeps polling until the run goes terminal", async () => {
    const run = supervisedRun("dispatch-to-terminal");
    const { clock, sleep } = fakeClock("2026-08-19T00:00:00.000Z");
    const dispatcher = stubDispatcher((input) => {
      transact(run, "supervisor", "force-done", {}, (draft) => {
        const tasks = draft.tasks as Record<string, { status: string }>;
        tasks[input.taskId]!.status = "done";
      });
      return { status: "dispatched", agentId: "agent-1" };
    });

    const supervisor = new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      dispatcher,
      clock,
      sleep,
      pollIntervalMs: 1000,
    });

    const result = await supervisor.run();
    expect(result.stopReason).toBe("terminal");
    expect(dispatcher.calls).toHaveLength(1);
    expect(dispatcher.calls[0]?.taskId).toBe("t-1");
  });

  test("stops as stalled when nothing is dispatchable, nothing is occupied, and nothing is backing off", async () => {
    const run = supervisedRun("stalled", 1);
    transact(run, "planner", "clear-tasks", {}, (draft) => {
      draft.tasks = {};
      const graph = draft.graph as { nodes: { type: string }[] };
      graph.nodes = graph.nodes.filter((node) => node.type !== "task");
    });
    const { clock, sleep } = fakeClock("2026-08-19T00:00:00.000Z");
    const dispatcher = stubDispatcher(() => ({ status: "dispatched" }));

    const supervisor = new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      dispatcher,
      clock,
      sleep,
    });

    const result = await supervisor.run();
    expect(result.stopReason).toBe("stalled");
    expect(dispatcher.calls).toEqual([]);
  });

  test("stops once the total elapsed-time budget is exhausted, even with a task still dispatchable", async () => {
    const run = supervisedRun("elapsed-budget");
    const { clock, sleep, advance } = fakeClock("2026-08-19T00:00:00.000Z");
    const dispatcher = stubDispatcher(() => {
      advance(2000);
      return { status: "dispatched" };
    });

    const supervisor = new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      dispatcher,
      clock,
      sleep,
      pollIntervalMs: 10,
      maxTotalElapsedMs: 1000,
    });

    const result = await supervisor.run();
    expect(result.stopReason).toBe("elapsed_budget_exhausted");
  });

  test("classifies a transient dispatch failure as backing off, then dispatches again once retryAt has passed", async () => {
    const run = supervisedRun("transient-backoff");
    const { clock, sleep } = fakeClock("2026-08-19T00:00:00.000Z");
    let attempt = 0;
    const dispatcher = stubDispatcher((input) => {
      attempt += 1;
      if (attempt === 1) {
        return { status: "failed", failure: { signal: "rate_limit", detail: "429" } };
      }
      transact(run, "supervisor", "force-done", {}, (draft) => {
        const tasks = draft.tasks as Record<string, { status: string }>;
        tasks[input.taskId]!.status = "done";
      });
      return { status: "dispatched" };
    });

    const supervisor = new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      dispatcher,
      clock,
      sleep,
      pollIntervalMs: 60_000,
      backoff: { initialDelayMs: 1000, maxDelayMs: 1000, random: () => 1 },
    });

    const result = await supervisor.run();
    expect(result.stopReason).toBe("terminal");
    expect(attempt).toBe(2);
  });

  test("escalates a task whose dispatch failure classifies as deterministic", async () => {
    const run = supervisedRun("deterministic-escalation");
    const { clock, sleep } = fakeClock("2026-08-19T00:00:00.000Z");
    const dispatcher = stubDispatcher(() => ({
      status: "failed",
      failure: { signal: "auth", detail: "invalid credentials" },
    }));

    const supervisor = new RunSupervisor({
      runRoot: run,
      actor: "supervisor",
      maxParallel: 4,
      dispatcher,
      clock,
      sleep,
      deterministicRepeatThreshold: 1,
    });

    const result = await supervisor.run();
    expect(result.stopReason).toBe("terminal");
  });
});
