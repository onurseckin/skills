import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { initRun, transact } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import {
  RunSupervisor,
  type TaskDispatchInput,
  type TaskDispatchResult,
  type TaskDispatcher,
} from "../../../orchestrating-long-tasks/scripts/src/orchestrator/supervisor.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

/**
 * One ready, dependency-free task ("t-1") with its requirement pre-authorized, plus enough of a
 * graph/requirements/tasks shape for proposeBatch/taskExecutionState to treat it as dispatchable —
 * the same recipe tests/unit/scheduler/fixtures.ts's schedulerState() uses, written through a real
 * capsule (initRun/transact) instead of a bare object, since RunSupervisor reads/writes a real run.
 */
function supervisedRun(label: string, taskCount = 1): string {
  const root = scratchRoot(import.meta.path, label);
  const repo = join(root, "repo");
  mkdirSync(repo);
  const run = initRun(repo, "supervisor-run", new TextEncoder().encode("prompt"), "file", true);

  const taskIds = Array.from({ length: taskCount }, (_, index) => `t-${index + 1}`);
  transact(run, "planner", "seed-graph", {}, (draft) => {
    draft.graph = {
      schema: "harness.graph",
      version: 1,
      revision: 1,
      nodes: [
        { id: "requirement-1", type: "requirement", label: "R-001", requirement_id: "R-001" },
        ...taskIds.map((id) => ({
          id,
          type: "task",
          label: id,
          requirement_ids: ["R-001"],
          write_scope: [`src/${id}`],
          resource_scope: [],
          status: "ready",
          priority: 1,
          created_order: 1,
          effort: 1,
        })),
      ],
      edges: [],
      gates: [],
    };
    draft.requirements = {
      schema: "harness.requirements",
      version: 1,
      prompt_sha256: "0".repeat(64),
      requirements: [{ id: "R-001", disposition: "actionable", dependencies: [] }],
      dispositions: [],
    };
    draft.tasks = Object.fromEntries(
      taskIds.map((id) => [
        id,
        {
          id,
          status: "ready",
          requirement_ids: ["R-001"],
          write_scope: [`src/${id}`],
          resource_scope: [],
          // proposeBatch's own ScheduledTask guard (not the graph node's copy) is what
          // readySet/RunSupervisor actually reads these three from.
          priority: 1,
          created_order: 1,
          effort: 1,
          dependencies: [],
          attempts: [],
          history: [],
          repair_round: 0,
        },
      ]),
    );
  });
  return run;
}

function fakeClock(startIso: string) {
  let now = new Date(startIso).valueOf();
  return {
    clock: { now: () => new Date(now) },
    sleep: async (ms: number): Promise<void> => {
      now += ms;
    },
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

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
});

describe("RunSupervisor — default sleep", () => {
  test("without an injected sleep, the real setTimeout-backed default still lets the loop reach a terminal run", async () => {
    // maxParallel: 1 forces the two tasks to dispatch one tick apart, so the loop has to pass
    // through its real (non-injected) sleepFn at least once between them — the one function this
    // suite otherwise never exercises, since every other test injects a fake sleep.
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
      // Marking the task done directly (out of band) is the simplest way to make the run go
      // terminal on the very next tick, without re-deriving the whole submission/gate pipeline.
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
    // Blocking the only task's write scope against itself is awkward; simplest deterministic
    // stall is a run with zero tasks at all, so proposeBatch/readySet always yield nothing.
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
    // A dispatcher that never finishes the task and never fails it — the run stays open forever,
    // so only the wall-clock budget can end it.
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
    // A deterministic dispatch failure escalates the task synchronously, inside the same tick
    // (recordAndClassifyFailure -> escalateTask) — "escalated" is one of isRunTerminal's terminal
    // statuses, so the run loop sees a terminal run on its very next iteration.
    expect(result.stopReason).toBe("terminal");
  });
});
