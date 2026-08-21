import { describe, expect, test } from "bun:test";
import { transact } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { runSupervisionWatch } from "../../../orchestrating-long-tasks/scripts/src/orchestrator/supervision-watch.ts";
import { fakeClock, supervisedRun } from "./supervised-run-fixture.ts";

function markDone(run: string, taskId: string): void {
  transact(run, "supervisor", "force-done", {}, (draft) => {
    const tasks = draft.tasks as Record<string, { status: string }>;
    tasks[taskId]!.status = "done";
  });
}

describe("runSupervisionWatch", () => {
  test("keeps ticking on the real timer until the run goes terminal, with no dispatcher involved", async () => {
    const run = supervisedRun("watch-terminal");
    const { clock } = fakeClock("2026-08-19T00:00:00.000Z");
    let observedTicks = 0;

    const result = await runSupervisionWatch({
      runRoot: run,
      actor: "supervisor",
      intervalMs: 1_000,
      clock,
      sleep: async () => {},
      onTick: (_, tickNumber) => {
        observedTicks = tickNumber;
        if (tickNumber === 1) markDone(run, "t-1");
      },
    });

    expect(result.stopReason).toBe("terminal");
    expect(result.ticks).toBe(2);
    expect(observedTicks).toBe(2);
    expect(result.lastTick.state.tasks["t-1"]!.status).toBe("done");
  });

  test("stops on an explicit signal mid-loop, without waiting for a terminal run", async () => {
    const run = supervisedRun("watch-stopped");
    const { clock } = fakeClock("2026-08-19T00:00:00.000Z");
    const controller = new AbortController();

    const result = await runSupervisionWatch({
      runRoot: run,
      actor: "supervisor",
      intervalMs: 1_000,
      clock,
      signal: controller.signal,
      sleep: async () => {},
      onTick: (_, tickNumber) => {
        if (tickNumber >= 3) controller.abort();
      },
    });

    expect(result.stopReason).toBe("stopped");
    expect(result.ticks).toBe(3);
    // The run was never touched into a terminal state — only the explicit stop ended the loop.
    expect(result.lastTick.state.tasks["t-1"]!.status).toBe("ready");
  });

  test("an already-aborted signal still lets the first heartbeat tick run before stopping", async () => {
    const run = supervisedRun("watch-preaborted");
    const { clock } = fakeClock("2026-08-19T00:00:00.000Z");
    const controller = new AbortController();
    controller.abort();

    const result = await runSupervisionWatch({
      runRoot: run,
      actor: "supervisor",
      intervalMs: 1_000,
      clock,
      signal: controller.signal,
      sleep: async () => {},
    });

    expect(result.stopReason).toBe("stopped");
    expect(result.ticks).toBe(1);
  });

  test("waits exactly the configured interval between ticks, not the internal dispatcher poll default", async () => {
    const run = supervisedRun("watch-interval-ms");
    const { clock } = fakeClock("2026-08-19T00:00:00.000Z");
    const controller = new AbortController();
    const waited: number[] = [];

    await runSupervisionWatch({
      runRoot: run,
      actor: "supervisor",
      intervalMs: 5_000,
      clock,
      signal: controller.signal,
      sleep: async (ms) => {
        waited.push(ms);
      },
      onTick: (_, tickNumber) => {
        if (tickNumber >= 2) controller.abort();
      },
    });

    expect(waited).toEqual([5_000]);
  });

  test("surfaces a task awaiting repair in the watch loop's own tick output, not only single-shot supervise", async () => {
    const run = supervisedRun("watch-changes-requested");
    transact(run, "validator", "reject-t-1", {}, (draft) => {
      const task = draft.tasks["t-1"] as {
        status: string;
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
      task.history.push({
        at: "2026-08-19T00:00:00.000Z",
        actor: "validator-1",
        from: "validating",
        to: "changes_requested",
        reason: "does not handle the empty-list case",
        attempt: 1,
      });
    });
    const { clock } = fakeClock("2026-08-19T00:00:00.000Z");
    const controller = new AbortController();

    const result = await runSupervisionWatch({
      runRoot: run,
      actor: "supervisor",
      intervalMs: 1_000,
      clock,
      signal: controller.signal,
      sleep: async () => {},
      onTick: () => controller.abort(),
    });

    expect(result.lastTick.changesRequested).toEqual([
      { taskId: "t-1", reason: "does not handle the empty-list case" },
    ]);
  });

  test("without an injected sleep, the real setTimeout-backed default still reaches a terminal run", async () => {
    const run = supervisedRun("watch-default-sleep");

    const result = await runSupervisionWatch({
      runRoot: run,
      actor: "supervisor",
      intervalMs: 1,
      onTick: (_, tickNumber) => {
        if (tickNumber === 1) markDone(run, "t-1");
      },
    });

    expect(result.stopReason).toBe("terminal");
    expect(result.ticks).toBe(2);
  });

  test("the default sleep resolves as soon as the signal aborts mid-wait, instead of waiting out the interval", async () => {
    const run = supervisedRun("watch-default-sleep-aborted");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);

    const result = await runSupervisionWatch({
      runRoot: run,
      actor: "supervisor",
      intervalMs: 60_000,
      signal: controller.signal,
    });

    expect(result.stopReason).toBe("stopped");
    expect(result.ticks).toBe(1);
  });

  test("the final report reflects the run at the moment the watch loop stopped", async () => {
    const run = supervisedRun("watch-report");
    const { clock } = fakeClock("2026-08-19T00:00:00.000Z");

    const result = await runSupervisionWatch({
      runRoot: run,
      actor: "supervisor",
      intervalMs: 1_000,
      clock,
      maxParallel: 4,
      gateMaxParallel: 2,
      sleep: async () => {},
      onTick: (_, tickNumber) => {
        if (tickNumber === 1) markDone(run, "t-1");
      },
    });

    expect(result.report.completed.map((task) => task.taskId)).toEqual(["t-1"]);
    expect(result.report.ceilings).toEqual({ maxParallel: 4, gateMaxParallel: 2 });
  });
});
