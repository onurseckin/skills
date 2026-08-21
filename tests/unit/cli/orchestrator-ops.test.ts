import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import type { OrchestratorCommandContext } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/orchestrator-ops.ts";
import type { RoundExecutionResult } from "../../../orchestrating-long-tasks/scripts/src/orchestrator/types.ts";
import type { TaskDispatcher } from "../../../orchestrating-long-tasks/scripts/src/orchestrator/supervisor.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

const stubExecutor: NonNullable<OrchestratorCommandContext["executor"]> = {
  async executeRound(input): Promise<RoundExecutionResult> {
    return {
      runId: input.runId,
      round: input.round,
      status: "completed",
      criticDecision: "approve",
      tasks: [{ id: "task-1", status: "done", writeScope: ["src"] }],
      findings: [],
      gateResults: [{ gate_id: "g-1", command_id: "c-1", status: "passed" }],
      summary: "Round complete.",
    };
  },
};

async function repoWithPrompt(
  name: string,
  prompt: string,
): Promise<{ repo: string; promptPath: string }> {
  const repo = await mkdtemp(join(tmpdir(), `harness-orchestrator-ops-${name}-`));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, prompt);
  return { repo, promptPath };
}

describe("orchestrator:run", () => {
  test("refuses a repository path that does not exist", async () => {
    await expect(
      execute(["orchestrator:run", "--repo", "/does/not/exist/at/all", "--prompt", "x"], {
        executor: stubExecutor,
      }),
    ).rejects.toThrow(/repository path does not exist/);
  });

  test("refuses without any prompt source at all", async () => {
    const { repo } = await repoWithPrompt("no-prompt", "unused");
    await expect(
      execute(["orchestrator:run", "--repo", repo], { executor: stubExecutor }),
    ).rejects.toThrow(/must provide prompt via/);
  });

  test("reads the prompt from --prompt-file", async () => {
    const { repo, promptPath } = await repoWithPrompt(
      "prompt-file",
      "Implement the feature via file",
    );
    const result = await execute(
      ["orchestrator:run", "--repo", repo, "--prompt-file", promptPath, "--max-rounds", "1"],
      { executor: stubExecutor },
    );
    expect(result.final_status).toBeDefined();
    expect(String(result.markdown).length).toBeGreaterThan(0);
  });

  test("a missing --prompt-file is refused with the underlying read error", async () => {
    const { repo } = await repoWithPrompt("prompt-file-missing", "unused");
    await expect(
      execute(["orchestrator:run", "--repo", repo, "--prompt-file", join(repo, "missing.txt")], {
        executor: stubExecutor,
      }),
    ).rejects.toThrow(/failed to read prompt file/);
  });

  test("reads the prompt from stdin via context", async () => {
    const { repo } = await repoWithPrompt("prompt-stdin", "unused");
    const result = await execute(
      ["orchestrator:run", "--repo", repo, "--prompt-stdin", "--max-rounds", "1"],
      {
        executor: stubExecutor,
        stdin: new TextEncoder().encode("Implement the feature via stdin"),
      },
    );
    expect(result.final_status).toBeDefined();
  });

  test("refuses stdin bytes that are not valid UTF-8", async () => {
    const { repo } = await repoWithPrompt("prompt-stdin-badutf8", "unused");
    await expect(
      execute(["orchestrator:run", "--repo", repo, "--prompt-stdin"], {
        executor: stubExecutor,
        stdin: new Uint8Array([0xff, 0xfe, 0xfd]),
      }),
    ).rejects.toThrow(/failed to decode stdin prompt/);
  });

  test("refuses without a stdin prompt when --prompt-stdin is given but no prompt was ever piped", async () => {
    const { repo } = await repoWithPrompt("prompt-stdin-empty", "unused");
    await expect(
      execute(["orchestrator:run", "--repo", repo, "--prompt-stdin"], { executor: stubExecutor }),
    ).rejects.toThrow(/must provide prompt via/);
  });

  test("refuses to run without a host-injected round executor", async () => {
    const { repo } = await repoWithPrompt("no-executor", "unused");
    await expect(
      execute(["orchestrator:run", "--repo", repo, "--prompt", "Implement the feature"], {}),
    ).rejects.toThrow(/requires a host-injected round executor/);
  });

  test("honours --actor, --capsules-dir and clamps --max-rounds into 1-10", async () => {
    const { repo } = await repoWithPrompt("actor-capsules-dir", "unused");
    const capsulesDir = join(repo, "custom-capsules");
    const result = await execute(
      [
        "orchestrator:run",
        "--repo",
        repo,
        "--prompt",
        "Implement the feature",
        "--actor",
        "coordinator-1",
        "--capsules-dir",
        capsulesDir,
        "--max-rounds",
        "99",
      ],
      { executor: stubExecutor },
    );
    expect(result.max_rounds_configured).toBe(10);
    expect(String(result.capsules_dir)).toBe(capsulesDir);
  });
});

describe("orchestrator:supervise", () => {
  test("without an injected dispatcher, performs exactly one tick and reports single_tick", async () => {
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

  test("with an injected dispatcher that always fails, loops until nothing is left to do", async () => {
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

  test("without --watch, --interval is refused outright rather than silently ignored", async () => {
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
  test("re-ticks on the host's injected sleep/signal until told to stop, instead of returning after one pass", async () => {
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

  test("defaults the tick interval to 30 seconds when --interval is omitted", async () => {
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

  test("cleans up its SIGINT/SIGTERM listeners once the watch loop returns", async () => {
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
