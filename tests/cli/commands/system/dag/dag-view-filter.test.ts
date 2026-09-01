import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import {
  executeDagViewCommand,
  type DagViewResult,
} from "../../../../../olt/scripts/src/cli/commands/dag-view.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
  roots.length = 0;
});

async function createBaseRun(name: string): Promise<{ repo: string; run: string }> {
  const repo = realpathSync(await mkdtemp(join(tmpdir(), `harness-dag-filter-${name}-`)));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(
    promptPath,
    "Build multi-tier system with backend, frontend, database, and documentation components.",
  );

  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    name,
    "--prompt-file",
    promptPath,
  ]);
  return { repo, run: init.run_root as string };
}

describe("dag:view CLI command execution - Flags & Filters", () => {
  test("reports active agents and subagent lease allocations in matrix table", async () => {
    const { run, repo } = await createBaseRun("active-agent-matrix");

    await mkdir(join(repo, "src/core"), { recursive: true });
    await writeFile(join(repo, "gate.ts"), "console.log('gate');\n");

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-core",
      "--label",
      "Core Logic",
      "--scope",
      "src/core",
      "--gate",
      "bun gate.ts",
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
      "bun test tests",
    ]);

    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "implementer-worker-1",
      "--role",
      "implementer",
      "--host",
      "antigravity",
    ]);

    await execute([
      "queue:pop",
      "--run",
      run,
      "--agent",
      "implementer-worker-1",
      "--lease-duration",
      "1200",
    ]);

    const result = (await execute(["dag", "--run", run])) as unknown as DagViewResult;

    expect(result.active_agents.length).toBe(1);
    expect(result.active_agents[0]?.id).toBe("implementer-worker-1");
    expect(result.active_agents[0]?.role).toBe("implementer");
    expect(result.active_agents[0]?.host).toBe("antigravity");
    expect(result.active_agents[0]?.taskId).toBe("task-core");
    expect(result.active_agents[0]?.attempt).toBe(1);

    expect(result.markdown).toContain("Active Subagents & Lease Matrix");
    expect(result.markdown).toContain("`implementer-worker-1`");
    expect(result.markdown).toContain("`task-core`");
  });

  test("canonical dag execution and rejection of retired aliases", async () => {
    const { run } = await createBaseRun("alias-check");

    const resDag = (await execute(["dag", "--run", run])) as unknown as DagViewResult;
    expect(resDag.total_tasks).toBe(0);
    await expect(execute(["graph:ascii", "--run", run])).rejects.toThrow(
      "unknown command: graph:ascii",
    );
    await expect(execute(["status:dag", "--run", run])).rejects.toThrow(
      "unknown command: status:dag",
    );
    await expect(execute(["dag:view", "--run", run])).rejects.toThrow("unknown command: dag:view");
  });

  test("honours --all flag and --recommendations flag", async () => {
    const { run } = await createBaseRun("flag-options");

    const result = (await execute([
      "dag",
      "--run",
      run,
      "--all",
      "--recommendations",
    ])) as unknown as DagViewResult;

    expect(result.markdown).toBeDefined();
    expect(result.markdown).toContain("Algorithmic Parallelization Recommendations");
  });

  test("fails with INVALID_ARGUMENT when --run is missing in empty directory", async () => {
    const emptyRepo = realpathSync(await mkdtemp(join(tmpdir(), "harness-empty-repo-")));
    roots.push(emptyRepo);
    await expect(execute(["dag", "--repo", emptyRepo])).rejects.toThrow("no active capsule found");
  });

  test("defaults to latest capsule in .capsules when --run is omitted", async () => {
    const { repo, run } = await createBaseRun("default-capsule");
    const result = (await execute(["dag", "--repo", repo])) as unknown as DagViewResult;
    expect(result.run_root).toBe(run);
    expect(result.total_tasks).toBe(0);
  });

  test("executeDagViewCommand executes directly with argv and flags", async () => {
    const { run } = await createBaseRun("direct-exec");
    const report1 = executeDagViewCommand(["--run", run]);
    expect(report1.total_tasks).toBe(0);
    expect(report1.is_compiled).toBe(false);

    const report2 = executeDagViewCommand({ run });
    expect(report2.total_tasks).toBe(0);
    expect(report2.is_compiled).toBe(false);
  });

  test("fails when run capsule does not exist", async () => {
    await expect(execute(["dag", "--run", "/tmp/does-not-exist-capsule-12345"])).rejects.toThrow();
  });
});
