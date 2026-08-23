import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { transact } from "../../../olt/scripts/src/store/index.ts";
import { runSupervisionWatch } from "../../../olt/scripts/src/orchestrator/supervision-watch.ts";
import { fakeClock, supervisedRun } from "./supervised-run-fixture.ts";

function markDone(run: string, taskId: string): void {
  transact(run, "supervisor", "force-done", {}, (draft) => {
    const tasks = draft.tasks as Record<string, { status: string }>;
    tasks[taskId]!.status = "done";
  });
}

describe("runSupervisionWatch", () => {
  test("structural: supervision-watch source code does not call unref on timers", async () => {
    const sourcePath = join(
      import.meta.dir,
      "..",
      "..",
      "..",
      "olt",
      "scripts",
      "src",
      "orchestrator",
      "supervision-watch.ts",
    );
    const source = await Bun.file(sourcePath).text();
    expect(source).not.toContain("unref");
  });

  test("process lifetime smoke test: supervision-watch keeps the process event loop alive across ticks without premature exit", async () => {
    const run = supervisedRun("process-lifetime-smoke");
    const childScript = `
      import { runSupervisionWatch } from "./olt/scripts/src/orchestrator/supervision-watch.ts";
      import { transact } from "./olt/scripts/src/store/index.ts";

      const run = ${JSON.stringify(run)};
      let observed = 0;
      const result = await runSupervisionWatch({
        runRoot: run,
        actor: "supervisor",
        intervalMs: 50,
        onTick: (_, tickNumber) => {
          observed = tickNumber;
          if (tickNumber === 1) {
            transact(run, "supervisor", "force-done", {}, (draft) => {
              const tasks = draft.tasks as Record<string, { status: string }>;
              tasks["t-1"]!.status = "done";
            });
          }
        },
      });
      console.log(JSON.stringify({ stopReason: result.stopReason, ticks: result.ticks, observed }));
    `;

    const repoRoot = join(import.meta.dir, "..", "..", "..");
    const proc = Bun.spawn(["bun", "-e", childScript], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeoutPromise = new Promise<{ timeout: true }>((resolve) =>
      setTimeout(() => resolve({ timeout: true }), 3_000),
    );

    const completionPromise = (async () => {
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      return { timeout: false as const, exitCode, stdout, stderr };
    })();

    const result = await Promise.race([completionPromise, timeoutPromise]);
    if (result.timeout) {
      proc.kill();
      throw new Error("Process lifetime smoke test timed out after 3000ms");
    }

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim()) as {
      stopReason: string;
      ticks: number;
      observed: number;
    };
    expect(parsed.stopReason).toBe("terminal");
    expect(parsed.ticks).toBe(2);
    expect(parsed.observed).toBe(2);
  }, 3_000);

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
