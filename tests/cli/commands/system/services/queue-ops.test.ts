import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import {
  establishSupervisorChain,
  registerUnderChain,
} from "../../../../shared/chains/agent-supervisor-chain.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";

const roots: string[] = [];
beforeEach(() => {
  setupVirtualCliFS();
});
afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

async function setupTwoIndependentTasks(
  name: string,
  roots2: string[],
): Promise<{ repo: string; run: string }> {
  const repo = `/virtual/cli/harness-queue-independent-${name}-${Date.now()}`;
  roots2.push(repo);
  await mkdir(repo, { recursive: true });
  await mkdir(join(repo, ".git"), { recursive: true });
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Do task one\n\nDo task two");
  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    name,
    "--prompt-file",
    promptPath,
  ]);
  const run = init.run_root as string;
  await execute([
    "plan:add",
    "--run",
    run,
    "--id",
    "task-alpha",
    "--label",
    "Alpha",
    "--scope",
    "src/alpha",
    "--gate",
    "bun test src/alpha",
    "--priority",
    "40",
    "--actor",
    "planner",
  ]);
  await execute([
    "plan:add",
    "--run",
    run,
    "--id",
    "task-beta",
    "--label",
    "Beta",
    "--scope",
    "src/beta",
    "--gate",
    "bun test src/beta",
    "--priority",
    "90",
    "--actor",
    "planner",
  ]);
  await execute(["plan:brainstorm", "--run", run, "--actor", "planner"]);
  await execute([
    "plan:compile",
    "--run",
    run,
    "--actor",
    "planner",
    "--completion-gate",
    "bun test src",
  ]);
  const chain = await establishSupervisorChain(run);
  for (const agent of ["worker-1", "worker-2"]) {
    await registerUnderChain(run, chain, agent, "implementer");
  }
  return { repo, run };
}

describe("queue:next / queue:list / queue:wave / queue:pop", () => {
  test("queue:next reports highest-priority ready task, or empty markdown", async () => {
    const { run } = await setupCompiledRun("queue-next", roots);
    const next = await execute(["queue:next", "--run", run]);
    expect((next.task as { id: string }).id).toBe("task-core");
    expect(String(next.markdown)).toContain("task-core");
  });

  test("with two ready tasks, queue:next ranks by priority", async () => {
    const { run } = await setupTwoIndependentTasks("queue-next-two-ready", roots);
    const next = await execute(["queue:next", "--run", run]);
    expect((next.task as { id: string }).id).toBe("task-beta");
  });

  test("queue:next reports empty queue once every task is leased", async () => {
    const { repo, run } = await setupCompiledRun("queue-next-empty", roots);
    void repo;
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    const next = await execute(["queue:next", "--run", run]);
    expect(next.task).toBeNull();
    expect(String(next.markdown).length).toBeGreaterThan(0);
  });

  test("queue:list partitions ready, leased, validating and blocked tasks", async () => {
    const { run } = await setupCompiledRun("queue-list", roots);
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    const listed = await execute(["queue:list", "--run", run]);
    const partitions = listed.partitions as {
      ready: string[];
      leased: { id: string; agent: string }[];
      blocked: { id: string; waitingOn: string[] }[];
    };
    expect(partitions.leased).toEqual([{ id: "task-core", agent: "worker-1" }]);
    expect(partitions.blocked).toEqual([{ id: "task-sec", waitingOn: ["task-core"] }]);
  });

  test("queue:list reports validating and done tasks in their own partitions", async () => {
    const { run } = await setupTwoIndependentTasks("queue-list-validating-done", roots);
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-alpha",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    transact(run, "test-seed", "seed-validating-status-for-test", {}, (state) => {
      const task = (state.tasks as Record<string, { status: string }>)["task-alpha"]!;
      task.status = "validating";
    });
    transact(run, "test-seed", "seed-done-status-for-test", {}, (state) => {
      const task = (state.tasks as Record<string, { status: string }>)["task-beta"]!;
      task.status = "done";
    });
    const listed = await execute(["queue:list", "--run", run]);
    const partitions = listed.partitions as { validating: string[]; satisfied: string[] };
    expect(partitions.validating).toEqual(["task-alpha"]);
    expect(partitions.satisfied).toEqual(["task-beta"]);
  });

  test("queue:wave reports claimable tasks ranked by topology and capped by --max-parallel", async () => {
    const { run } = await setupCompiledRun("queue-wave", roots);
    const wave = await execute(["queue:wave", "--run", run, "--max-parallel", "1"]);
    expect((wave.wave as unknown[]).length).toBe(1);
    expect(wave.max_parallel).toBe(1);
  });

  test("queue:wave reports empty markdown once nothing is claimable", async () => {
    const { run } = await setupCompiledRun("queue-wave-empty", roots);
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    const wave = await execute(["queue:wave", "--run", run]);
    expect(wave.wave).toEqual([]);
    expect(String(wave.markdown).length).toBeGreaterThan(0);
  });

  test("with two ready tasks, queue:pop ranks by priority", async () => {
    const { run } = await setupTwoIndependentTasks("queue-pop-two-ready", roots);
    const popped = await execute(["queue:pop", "--run", run, "--agent", "worker-1"]);
    expect((popped.task as { id: string }).id).toBe("task-beta");
  });

  test("queue:pop atomically claims highest-priority ready task", async () => {
    const { run } = await setupCompiledRun("queue-pop", roots);
    const popped = await execute(["queue:pop", "--run", run, "--agent", "worker-1"]);
    expect(typeof popped.token).toBe("string");
    expect((popped.task as { id: string }).id).toBe("task-core");
    expect(popped.packet_id).toBeDefined();
  });

  test("queue:pop refuses when no task is ready", async () => {
    const { run } = await setupCompiledRun("queue-pop-empty", roots);
    await execute(["queue:pop", "--run", run, "--agent", "worker-1"]);
    await expect(execute(["queue:pop", "--run", run, "--agent", "worker-2"])).rejects.toThrow(
      /no ready tasks available in queue to pop/,
    );
  });

  test("queue:pop honours explicit --lease-duration", async () => {
    const { run } = await setupCompiledRun("queue-pop-lease", roots);
    const popped = await execute([
      "queue:pop",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--lease-duration",
      "600",
    ]);
    expect(typeof popped.token).toBe("string");
  });
});
