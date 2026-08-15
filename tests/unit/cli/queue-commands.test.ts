import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("CLI queue commands", () => {
  test("queue:next, queue:list, and queue:pop flow", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-queue-cmd-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Core task\n\nCLI task\nIntegration task");

    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run",
      "queue-run",
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-core",
      "--label",
      "Core tests",
      "--scope",
      "tests/core",
      "--gate",
      "bun test tests/core",
      "--priority",
      "90",
      "--actor",
      "planner",
    ]);

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-cli",
      "--label",
      "CLI tests",
      "--scope",
      "tests/cli",
      "--gate",
      "bun test tests/cli",
      "--deps",
      "task-core",
      "--priority",
      "50",
      "--actor",
      "planner",
    ]);

    await execute(["plan:compile", "--run", run, "--actor", "planner"]);

    const next1 = await execute(["queue:next", "--run", run]);
    expect(next1.task).toBeObject();
    expect((next1.task as { id: string }).id).toBe("task-core");
    expect(String(next1.markdown)).toContain("### Ready Task: task-core");

    const list1 = await execute(["queue:list", "--run", run]);
    expect(list1.partitions).toBeObject();
    expect(String(list1.markdown)).toContain("### Execution Queue Summary");

    const pop1 = await execute(["queue:pop", "--run", run, "--agent", "worker-core"]);
    expect(pop1.token).toBeString();
    expect((pop1.task as { id: string }).id).toBe("task-core");
    expect(String(pop1.markdown)).toContain("### Task Popped & Leased: task-core");

    // Once task-core is leased, task-cli is blocked on it, so queue:next has no ready task
    const next2 = await execute(["queue:next", "--run", run]);
    expect(next2.task).toBeNull();
    expect(String(next2.markdown)).toContain("### Queue Status: queue-run");
  });

  test("queue:pop throws when queue is empty", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-queue-empty-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "One prompt");

    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run",
      "empty-q-run",
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "t1",
      "--label",
      "T1",
      "--scope",
      "tests/t1",
      "--gate",
      "bun test tests/t1",
      "--actor",
      "planner",
    ]);
    await execute(["plan:compile", "--run", run, "--actor", "planner"]);
    await execute(["queue:pop", "--run", run, "--agent", "w1"]);

    await expect(execute(["queue:pop", "--run", run, "--agent", "w2"])).rejects.toThrow(
      "no ready tasks available in queue to pop",
    );
  });
});
