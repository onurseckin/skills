import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import type { OrchestratorCommandContext } from "../../../../../olt/scripts/src/cli/commands/orchestrator-ops.ts";
import type { TaskDispatcher } from "../../../../../olt/scripts/src/orchestrator/supervisor.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("orchestrator:supervise", () => {
  test("without injected dispatcher, performs one tick and reports single_tick", async () => {
    const { run } = await setupCompiledRun("supervise-single-tick", roots);
    const result = await execute(
      ["orchestrator:supervise", "--run", run, "--actor", "coordinator"],
      {},
    );
    expect(result.stop_reason).toBe("single_tick");
    expect(result.ticks).toBe(1);
    expect(String(result.markdown).length).toBeGreaterThan(0);
    expect(result.max_parallel_source).toBeDefined();
  });

  test("with injected dispatcher that fails, loops until stalled", async () => {
    const { run } = await setupCompiledRun("supervise-dispatcher", roots);
    const dispatcher: TaskDispatcher = {
      async dispatch() {
        return { status: "failed", failure: { signal: "unknown", detail: "simulated failure" } };
      },
    };
    const result = await execute(
      [
        "orchestrator:supervise",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--max-total-elapsed-ms",
        "1000",
        "--poll-interval-ms",
        "100",
      ],
      { dispatcher },
    );
    expect(result.stop_reason).toBe("stalled");
    expect(result.ticks as number).toBeGreaterThan(1);
  });

  test("honours --gate-max-parallel and --no-recover", async () => {
    const { run } = await setupCompiledRun("supervise-flags", roots);
    const result = await execute(
      [
        "orchestrator:supervise",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--gate-max-parallel",
        "2",
        "--no-recover",
      ],
      {},
    );
    expect(result.recovery_enabled).toBe(false);
    expect(result.gate_max_parallel).toBe(2);
    expect(result.watch).toBe(false);
  });

  test("without --watch, --interval is refused", async () => {
    const { run } = await setupCompiledRun("supervise-interval-without-watch", roots);
    await expect(
      execute(
        ["orchestrator:supervise", "--run", run, "--actor", "coordinator", "--interval", "5"],
        {},
      ),
    ).rejects.toThrow("--interval only applies with --watch");
  });
});

describe("orchestrator:supervise --watch", () => {
  test("re-ticks on injected sleep/signal until stopped", async () => {
    const { run } = await setupCompiledRun("supervise-watch-stopped", roots);
    const controller = new AbortController();
    let sleepCalls = 0;
    const context: OrchestratorCommandContext = {
      signal: controller.signal,
      sleep: async () => {
        sleepCalls += 1;
        controller.abort();
      },
    };

    const result = await execute(
      [
        "orchestrator:supervise",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--watch",
        "--interval",
        "1",
      ],
      context,
    );

    expect(result.watch).toBe(true);
    expect(result.stop_reason).toBe("stopped");
    expect(result.interval_seconds).toBe(1);
    expect(result.ticks).toBe(1);
    expect(sleepCalls).toBe(1);
    expect(Array.isArray(result.changes_requested)).toBe(true);
    expect(String(result.markdown).length).toBeGreaterThan(0);
  });

  test("defaults tick interval to 30s when --interval omitted", async () => {
    const { run } = await setupCompiledRun("supervise-watch-default-interval", roots);
    const controller = new AbortController();
    controller.abort();
    const context: OrchestratorCommandContext = {
      signal: controller.signal,
      sleep: async () => {},
    };

    const result = await execute(
      ["orchestrator:supervise", "--run", run, "--actor", "coordinator", "--watch"],
      context,
    );

    expect(result.interval_seconds).toBe(30);
    expect(result.stop_reason).toBe("stopped");
    expect(result.ticks).toBe(1);
  });

  test("SIGTERM delivered mid-watch stops loop", async () => {
    const { run } = await setupCompiledRun("supervise-watch-sigterm", roots);
    const sigtermBefore = process.listenerCount("SIGTERM");
    const context: OrchestratorCommandContext = {
      sleep: async () => {
        process.emit("SIGTERM");
      },
    };

    const result = await execute(
      [
        "orchestrator:supervise",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--watch",
        "--interval",
        "1",
      ],
      context,
    );

    expect(result.stop_reason).toBe("stopped");
    expect(result.ticks).toBe(1);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
  });

  test("cleans up SIGINT/SIGTERM listeners once watch loop returns", async () => {
    const { run } = await setupCompiledRun("supervise-watch-listener-cleanup", roots);
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");
    const controller = new AbortController();
    controller.abort();

    await execute(["orchestrator:supervise", "--run", run, "--actor", "coordinator", "--watch"], {
      signal: controller.signal,
      sleep: async () => {},
    } satisfies OrchestratorCommandContext);

    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
  });
});
